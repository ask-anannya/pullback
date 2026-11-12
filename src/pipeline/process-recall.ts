import { and, eq, inArray, desc } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { DateRange } from "@/db/schema";
import { audit } from "@/audit/log";
import { contentHash } from "@/recalls/fingerprint";
import { parseRecall, type ParsedRecall } from "@/recalls/parse";
import { sourceUrlFor, type OpenFdaRecall } from "@/recalls/openfda";
import { matchRecallToProduct, fmtRange, type MatchResult } from "@/matching/identifiers";
import { fuzzyMatch } from "@/matching/fuzzy";
import { narrow, type NarrowItem } from "@/narrowing/narrow";
import { severityFor, SEVERITY_RESPONSE } from "@/severity/severity";
import { explainHazard } from "@/agents/hazard";
import { writeBrief } from "@/agents/brief-writer";
import { writeNotice } from "@/agents/notice-writer";

export type Change = "new" | "changed" | "unchanged";

export type Brief = {
  title: string;
  recall: {
    number: string;
    firm: string | null;
    description: string;
    reason: string;
    classification: string;
    reportDate: string | null;
    sourceUrl: string;
    isSimulated: boolean;
    codes: string;
  };
  severity: "urgent" | "standard" | "low";
  severityResponse: string;
  hazardType: string;
  hazardExplanation: string;
  hazardSource: "ai" | "template";
  match: {
    productId: string;
    productName: string;
    productSku: string;
    decision: string;
    confidence: string;
    method: string;
    reason: string;
    evidence: MatchResult["evidence"];
  };
  nearMisses: { productName: string; reason: string }[];
  summary: string;
  recommendation: string;
  briefSource: "ai" | "template";
  notice: { subject: string; body: string };
  noticeSource: "ai" | "template";
  needsReview: { orderItemId: string; orderId: string; reason: string }[];
  wholeProduct: boolean;
  expansion?: { newLots: string[]; newDateRanges: DateRange[] };
};

function rowToParsed(p: typeof schema.recallParsed.$inferSelect): ParsedRecall {
  return {
    upcs: p.upcs,
    brands: p.brands,
    productNames: p.productNames,
    sizes: p.sizes,
    lots: p.lots,
    dateRanges: p.dateRanges,
    hazardType: p.hazardType,
    parserVersion: p.parserVersion,
  };
}

/** Store or update a recall; parse it when it is new or its content changed. */
export async function ingestRecall(
  raw: OpenFdaRecall,
  opts: { isSimulated?: boolean; sourceUrl?: string } = {},
): Promise<{ recallId: string; change: Change; parsedId: string; prevParsedId: string | null }> {
  const db = await getDb();
  const hash = contentHash(raw);
  const existing = (await db.select().from(schema.recalls).where(eq(schema.recalls.sourceRecallId, raw.recall_number)))[0];

  const values = {
    sourceRecallId: raw.recall_number,
    eventId: raw.event_id ?? null,
    classification: raw.classification,
    status: raw.status ?? null,
    recallingFirm: raw.recalling_firm ?? null,
    productDescription: raw.product_description,
    reasonForRecall: raw.reason_for_recall ?? null,
    codeInfo: raw.code_info ?? null,
    reportDate: raw.report_date ?? null,
    raw: raw as unknown as Record<string, unknown>,
    contentHash: hash,
    sourceUrl: opts.sourceUrl ?? sourceUrlFor(raw.recall_number),
    isSimulated: opts.isSimulated ?? false,
  };

  let recallId: string;
  let change: Change;
  let prevParsedId: string | null = null;
  if (!existing) {
    recallId = (await db.insert(schema.recalls).values(values).returning({ id: schema.recalls.id }))[0].id;
    change = "new";
  } else if (existing.contentHash !== hash) {
    await db.update(schema.recalls).set(values).where(eq(schema.recalls.id, existing.id));
    recallId = existing.id;
    change = "changed";
    const prev = await db
      .select({ id: schema.recallParsed.id })
      .from(schema.recallParsed)
      .where(eq(schema.recallParsed.recallId, recallId))
      .orderBy(desc(schema.recallParsed.createdAt))
      .limit(1);
    prevParsedId = prev[0]?.id ?? null;
  } else {
    const cur = await db
      .select({ id: schema.recallParsed.id })
      .from(schema.recallParsed)
      .where(eq(schema.recallParsed.recallId, existing.id))
      .orderBy(desc(schema.recallParsed.createdAt))
      .limit(1);
    return { recallId: existing.id, change: "unchanged", parsedId: cur[0]?.id ?? "", prevParsedId: null };
  }

  const parsed = await parseRecall(raw);
  const parsedId = (
    await db
      .insert(schema.recallParsed)
      .values({
        recallId,
        contentHash: hash,
        upcs: parsed.upcs,
        brands: parsed.brands,
        productNames: parsed.productNames,
        sizes: parsed.sizes,
        lots: parsed.lots,
        dateRanges: parsed.dateRanges,
        hazardType: parsed.hazardType,
        parserVersion: parsed.parserVersion,
      })
      .returning({ id: schema.recallParsed.id })
  )[0].id;

  await audit({
    actor: "agent",
    eventType: change === "new" ? "recall_ingested" : "recall_changed",
    payload: { recallNumber: raw.recall_number, isSimulated: values.isSimulated, parsed },
  });
  return { recallId, change, parsedId, prevParsedId };
}

function codesText(p: { lots: string[]; dateRanges: DateRange[] }): string {
  const parts = [...p.lots.map((l) => `lot ${l}`), ...p.dateRanges.map((r) => `best by ${fmtRange(r)}`)];
  return parts.length ? parts.join(", ") : "all codes";
}

export type ProcessSummary = {
  recallNumber: string;
  change: Change;
  matched: string[];
  nearMisses: string[];
  needsReview: string[];
  incidentIds: string[];
  silent: boolean;
};

/** Match a recall against the store, narrow to affected orders, and open incidents (plan-core 8.3 to 8.6, 8.9). */
export async function processRecall(args: {
  recallId: string;
  parsedId: string;
  change: Change;
  prevParsedId: string | null;
}): Promise<ProcessSummary> {
  const db = await getDb();
  const recall = (await db.select().from(schema.recalls).where(eq(schema.recalls.id, args.recallId)))[0];
  const parsedRow = (await db.select().from(schema.recallParsed).where(eq(schema.recallParsed.id, args.parsedId)))[0];
  const parsed = rowToParsed(parsedRow);
  const prevParsed = args.prevParsedId
    ? rowToParsed((await db.select().from(schema.recallParsed).where(eq(schema.recallParsed.id, args.prevParsedId)))[0])
    : null;

  const summary: ProcessSummary = {
    recallNumber: recall.sourceRecallId,
    change: args.change,
    matched: [],
    nearMisses: [],
    needsReview: [],
    incidentIds: [],
    silent: true,
  };

  const store = (await db.select().from(schema.stores).limit(1))[0];
  if (!store) return summary;

  const products = await db.select().from(schema.products).where(eq(schema.products.storeId, store.id));
  const allBatches = await db.select().from(schema.batches);
  const batchesByProduct = new Map<string, (typeof allBatches)[number][]>();
  for (const b of allBatches) batchesByProduct.set(b.productId, [...(batchesByProduct.get(b.productId) ?? []), b]);

  const recallText = { productDescription: recall.productDescription, recallingFirm: recall.recallingFirm };
  const results: { product: (typeof products)[number]; result: MatchResult; matchId: string }[] = [];

  for (const product of products) {
    const batches = (batchesByProduct.get(product.id) ?? []).map((b) => ({ lotCode: b.lotCode, bestBy: b.bestBy }));
    let result = matchRecallToProduct(recallText, parsed, product, batches);
    if (result.needsLlm) result = await fuzzyMatch(recallText, parsed, product, batches, result);
    if (result.decision === "not_related") continue;
    const matchId = (
      await db
        .insert(schema.matches)
        .values({
          recallId: recall.id,
          recallParsedId: parsedRow.id,
          productId: product.id,
          method: result.method,
          confidence: result.confidence,
          evidence: result.evidence,
          decision: result.decision,
          reason: result.reason,
        })
        .returning({ id: schema.matches.id })
    )[0].id;
    results.push({ product, result, matchId });
  }

  const nearMisses = results.filter((r) => r.result.decision === "near_miss");
  for (const nm of nearMisses) {
    summary.nearMisses.push(nm.product.name);
    await audit({
      actor: "agent",
      eventType: "near_miss_ignored",
      storeId: store.id,
      payload: { recallNumber: recall.sourceRecallId, product: nm.product.name, reason: nm.result.reason },
    });
  }
  for (const r of results.filter((r) => r.result.decision === "needs_review")) {
    summary.needsReview.push(r.product.name);
    summary.silent = false;
    await audit({
      actor: "agent",
      eventType: "match_needs_review",
      storeId: store.id,
      payload: { recallNumber: recall.sourceRecallId, product: r.product.name, reason: r.result.reason },
    });
  }

  const matched = results.filter((r) => r.result.decision === "matched");
  if (!matched.length) {
    await audit({
      actor: "agent",
      eventType: "recall_checked_no_match",
      storeId: store.id,
      payload: { recallNumber: recall.sourceRecallId, productsChecked: products.length, nearMisses: summary.nearMisses },
    });
    return summary;
  }

  for (const m of matched) {
    summary.matched.push(m.product.name);
    summary.silent = false;
    const id = await openIncident({ store, recall, parsed, prevParsed, change: args.change, m, nearMisses });
    if (id) summary.incidentIds.push(id);
  }
  return summary;
}

async function openIncident(ctx: {
  store: typeof schema.stores.$inferSelect;
  recall: typeof schema.recalls.$inferSelect;
  parsed: ParsedRecall;
  prevParsed: ParsedRecall | null;
  change: Change;
  m: { product: typeof schema.products.$inferSelect; result: MatchResult; matchId: string };
  nearMisses: { product: typeof schema.products.$inferSelect; result: MatchResult }[];
}): Promise<string | null> {
  const db = await getDb();
  const { store, recall, parsed, m } = ctx;

  // Existing incidents for this recall and product (for expansions).
  const prior = await db
    .select({ id: schema.incidents.id, matchId: schema.incidents.matchId, parent: schema.incidents.parentIncidentId })
    .from(schema.incidents)
    .innerJoin(schema.matches, eq(schema.incidents.matchId, schema.matches.id))
    .where(and(eq(schema.incidents.recallId, recall.id), eq(schema.matches.productId, m.product.id)))
    .orderBy(schema.incidents.createdAt);

  const items = await db
    .select({
      orderItemId: schema.orderItems.id,
      orderId: schema.orderItems.orderId,
      quantity: schema.orderItems.quantity,
      unitPriceCents: schema.orderItems.unitPriceCents,
      refundedCents: schema.orderItems.refundedCents,
      lotCode: schema.batches.lotCode,
      bestBy: schema.batches.bestBy,
    })
    .from(schema.orderItems)
    .leftJoin(schema.batches, eq(schema.orderItems.batchId, schema.batches.id))
    .where(eq(schema.orderItems.productId, m.product.id));

  const narrowItems: NarrowItem[] = items.map((i) => ({
    orderItemId: i.orderItemId,
    orderId: i.orderId,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    refundedCents: i.refundedCents,
    batch: i.lotCode ? { lotCode: i.lotCode, bestBy: i.bestBy } : null,
  }));

  let codes: { lots: string[]; dateRanges: DateRange[] } = parsed;
  let skip = new Set<string>();
  let parentIncidentId: string | null = null;
  let expansion: Brief["expansion"];

  if (prior.length) {
    if (ctx.change !== "changed") return null; // already handled this version
    parentIncidentId = prior[0].parent ?? prior[0].id;
    const prev = ctx.prevParsed ?? { lots: [], dateRanges: [] };
    const prevLots = new Set(prev.lots);
    const prevRanges = new Set(prev.dateRanges.map((r) => `${r.from}|${r.to}`));
    codes = {
      lots: parsed.lots.filter((l) => !prevLots.has(l)),
      dateRanges: parsed.dateRanges.filter((r) => !prevRanges.has(`${r.from}|${r.to}`)),
    };
    expansion = { newLots: codes.lots, newDateRanges: codes.dateRanges };
    const handled = await db
      .select({ orderItemId: schema.affectedItems.orderItemId })
      .from(schema.affectedItems)
      .where(inArray(schema.affectedItems.incidentId, prior.map((p) => p.id)));
    skip = new Set(handled.map((h) => h.orderItemId));
    if (!codes.lots.length && !codes.dateRanges.length) {
      await audit({
        actor: "agent",
        eventType: "recall_changed_no_new_codes",
        storeId: store.id,
        payload: { recallNumber: recall.sourceRecallId, product: m.product.name },
      });
      return null;
    }
  }

  const n = narrow(codes, m.result.confidence, narrowItems, skip);
  if (parentIncidentId && n.affected.length === 0) {
    await audit({
      actor: "agent",
      eventType: "expansion_no_new_orders",
      storeId: store.id,
      payload: { recallNumber: recall.sourceRecallId, product: m.product.name, newCodes: codes },
    });
    return null;
  }

  const severity = severityFor(recall.classification, parsed.hazardType);
  const status = severity === "low" ? "logged_only" : "awaiting_owner";
  const hazard = await explainHazard({ classification: recall.classification, reason: recall.reasonForRecall ?? "", hazardType: parsed.hazardType });
  const brief = await writeBrief({
    recallNumber: recall.sourceRecallId,
    firm: recall.recallingFirm,
    recalledProduct: recall.productDescription,
    reason: recall.reasonForRecall ?? "",
    classification: recall.classification,
    severity,
    storeProduct: m.product.name,
    matchReason: m.result.reason,
    confidence: m.result.confidence,
    checkedOrderCount: n.checkedOrderCount,
    affectedOrderIds: [...new Set(n.affected.map((a) => a.orderId))],
    totalRefundCents: n.totalRefundCents,
    rulesUsed: [...new Set(n.affected.map((a) => a.rule))],
    isExpansion: Boolean(parentIncidentId),
  });
  const notice = await writeNotice({
    storeName: store.name,
    productName: m.product.name,
    sizeText: m.product.sizeText,
    codes: codesText(codes),
    reason: recall.reasonForRecall ?? "a safety issue",
    recallNumber: recall.sourceRecallId,
  });

  const title = parentIncidentId
    ? `Recall expanded: ${n.affectedOrderCount} more order${n.affectedOrderCount === 1 ? "" : "s"} affected`
    : `${m.product.name}: ${n.affectedOrderCount} of ${n.checkedOrderCount} orders affected`;

  const briefJson: Brief = {
    title,
    recall: {
      number: recall.sourceRecallId,
      firm: recall.recallingFirm,
      description: recall.productDescription,
      reason: recall.reasonForRecall ?? "",
      classification: recall.classification,
      reportDate: recall.reportDate,
      sourceUrl: recall.sourceUrl,
      isSimulated: recall.isSimulated,
      codes: codesText(codes),
    },
    severity,
    severityResponse: SEVERITY_RESPONSE[severity],
    hazardType: parsed.hazardType,
    hazardExplanation: hazard.text,
    hazardSource: hazard.source,
    match: {
      productId: m.product.id,
      productName: m.product.name,
      productSku: m.product.sku,
      decision: m.result.decision,
      confidence: m.result.confidence,
      method: m.result.method,
      reason: m.result.reason,
      evidence: m.result.evidence,
    },
    nearMisses: ctx.nearMisses.map((x) => ({ productName: x.product.name, reason: x.result.reason })),
    summary: brief.summary,
    recommendation: brief.recommendation,
    briefSource: brief.source,
    notice: { subject: notice.subject, body: notice.body },
    noticeSource: notice.source,
    needsReview: n.needsReview,
    wholeProduct: n.wholeProduct,
    expansion,
  };

  const incidentId = (
    await db
      .insert(schema.incidents)
      .values({
        recallId: recall.id,
        storeId: store.id,
        matchId: m.matchId,
        parentIncidentId,
        severity,
        status,
        checkedOrderCount: n.checkedOrderCount,
        affectedOrderCount: n.affectedOrderCount,
        totalRefundCents: n.totalRefundCents,
        brief: briefJson,
      })
      .returning({ id: schema.incidents.id })
  )[0].id;

  if (n.affected.length) {
    await db.insert(schema.affectedItems).values(
      n.affected.map((a) => ({ incidentId, orderItemId: a.orderItemId, rule: a.rule, refundCents: a.refundCents })),
    );
  }

  await audit({
    actor: "agent",
    eventType: parentIncidentId ? "incident_expansion_opened" : status === "logged_only" ? "incident_logged_only" : "incident_opened",
    storeId: store.id,
    incidentId,
    payload: {
      recallNumber: recall.sourceRecallId,
      product: m.product.name,
      severity,
      affected: n.affectedOrderCount,
      checked: n.checkedOrderCount,
      totalRefundCents: n.totalRefundCents,
      needsReview: n.needsReview.length,
      parentIncidentId,
    },
  });
  return incidentId;
}

/** Ingest one recall record and run the full pipeline on it. */
export async function ingestAndProcess(raw: OpenFdaRecall, opts: { isSimulated?: boolean; sourceUrl?: string } = {}) {
  const r = await ingestRecall(raw, opts);
  if (r.change === "unchanged") {
    return { recallNumber: raw.recall_number, change: r.change, matched: [], nearMisses: [], needsReview: [], incidentIds: [], silent: true } satisfies ProcessSummary;
  }
  return processRecall(r);
}
