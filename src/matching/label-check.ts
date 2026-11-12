import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { EvidenceRow } from "@/db/schema";
import type { LabelReading } from "@/agents/label-reader";
import { compareUpc, type ParsedRecall } from "@/recalls/parse";
import { matchRecallToProduct, type MatchResult } from "./identifiers";
import { brandEquals, brandInText, nameContainment, normalizeLot } from "./normalize";

export type LabelVerdict = "recalled" | "check_code" | "not_this_batch" | "no_recall" | "not_stocked" | "unreadable";

export type LabelCheck = {
  verdict: LabelVerdict;
  headline: string;
  reason: string;
  reading: LabelReading;
  product: { sku: string; name: string; brand: string; upc: string | null; sizeText: string | null; matchedBy: "barcode" | "brand and name" } | null;
  batch: { lotCode: string | null; bestBy: string | null; inStoreRecords: boolean } | null;
  recall: {
    number: string;
    classification: string;
    firm: string | null;
    reason: string | null;
    codeInfo: string | null;
    sourceUrl: string;
    isSimulated: boolean;
    incidentId: string | null;
  } | null;
  evidence: EvidenceRow[];
  sold: { orders: number; units: number; refundedOrders: number } | null;
  recallsChecked: number;
};

/**
 * Checks one package, read from a photo, against every recall Pullback has processed.
 * Reuses the same identifier-first matcher as the daily recall check, with the photo's lot and
 * best-by date as the only batch, so the answer is about this exact package.
 */
export async function checkLabel(reading: LabelReading): Promise<LabelCheck> {
  const db = await getDb();
  const base = { reading, product: null, batch: null, recall: null, evidence: [], sold: null, recallsChecked: 0 };

  if (reading.legibility === "unreadable" || (!reading.upc && !reading.brand && !reading.product_name)) {
    return { ...base, verdict: "unreadable", headline: "Could not read this package", reason: reading.notes || "Take a sharper photo of the front label and the lot / best-by stamp." };
  }

  // 1. Which store product is this? Barcode first, then brand and name.
  const products = await db.select().from(schema.products);
  let product = reading.upc ? products.find((p) => p.upc && compareUpc(reading.upc!, p.upc)) : undefined;
  let matchedBy: "barcode" | "brand and name" = "barcode";
  if (!product && reading.brand) {
    const text = `${reading.brand} ${reading.product_name ?? ""} ${reading.size ?? ""}`;
    const scored = products
      .filter((p) => brandEquals(p.brand, reading.brand!) || brandInText(p.brand, text))
      .map((p) => ({ p, s: nameContainment(p.name, text, p.brand) }))
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s);
    product = scored[0]?.p;
    matchedBy = "brand and name";
  }
  if (!product) {
    return {
      ...base,
      verdict: "not_stocked",
      headline: "This product is not in your catalog",
      reason: `Pullback found no product in your store with ${reading.upc ? `barcode ${reading.upc} or ` : ""}brand "${reading.brand ?? "unknown"}" and name "${reading.product_name ?? "unknown"}".`,
    };
  }

  // 2. Which batch? The photo's lot and best-by are the source of truth; store records add context.
  const batches = await db.select().from(schema.batches).where(eq(schema.batches.productId, product.id));
  const storeBatch =
    (reading.lot_code && batches.find((b) => normalizeLot(b.lotCode) === normalizeLot(reading.lot_code!))) ||
    (reading.best_by && batches.find((b) => b.bestBy === reading.best_by)) ||
    null;
  const lotCode = reading.lot_code ?? storeBatch?.lotCode ?? null;
  const bestBy = reading.best_by ?? storeBatch?.bestBy ?? null;
  const hasCode = Boolean(lotCode || bestBy);
  const labelBatches = hasCode ? [{ lotCode: lotCode ?? "", bestBy }] : [];

  // 3. Every processed recall, latest parse each.
  const recalls = await db.select().from(schema.recalls);
  const parsedRows = recalls.length
    ? await db.select().from(schema.recallParsed).where(inArray(schema.recallParsed.recallId, recalls.map((r) => r.id))).orderBy(desc(schema.recallParsed.createdAt))
    : [];
  const latest = new Map<string, (typeof parsedRows)[number]>();
  for (const p of parsedRows) if (!latest.has(p.recallId)) latest.set(p.recallId, p);

  type Hit = { recall: (typeof recalls)[number]; result: MatchResult };
  const hits: Hit[] = [];
  for (const r of recalls) {
    const p = latest.get(r.id);
    if (!p) continue;
    const parsed: ParsedRecall = { upcs: p.upcs, brands: p.brands, productNames: p.productNames, sizes: p.sizes, lots: p.lots, dateRanges: p.dateRanges, hazardType: p.hazardType, parserVersion: p.parserVersion };
    const result = matchRecallToProduct({ productDescription: r.productDescription, recallingFirm: r.recallingFirm }, parsed, product, labelBatches);
    if (result.decision !== "not_related") hits.push({ recall: r, result });
  }

  const matched = hits.find((h) => h.result.decision === "matched");
  const recallHasCodes = (h: Hit) => h.result.evidence.some((e) => e.field === "Lot / best-by" && e.recall);
  const lotMiss = hits.find((h) => h.result.decision === "near_miss" && h.result.method === "lot_date");
  const review = hits.find((h) => h.result.decision === "needs_review");
  const pick = matched ?? lotMiss ?? review ?? null;

  // 4. How much of this batch did the store sell?
  let sold: LabelCheck["sold"] = null;
  if (storeBatch) {
    const items = await db
      .select({ orderId: schema.orderItems.orderId, quantity: schema.orderItems.quantity, refundedCents: schema.orderItems.refundedCents })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.batchId, storeBatch.id));
    sold = {
      orders: new Set(items.map((i) => i.orderId)).size,
      units: items.reduce((s, i) => s + i.quantity, 0),
      refundedOrders: new Set(items.filter((i) => i.refundedCents > 0).map((i) => i.orderId)).size,
    };
  }

  let incidentId: string | null = null;
  if (pick) {
    const inc = await db.select({ id: schema.incidents.id }).from(schema.incidents).where(eq(schema.incidents.recallId, pick.recall.id)).orderBy(desc(schema.incidents.createdAt)).limit(1);
    incidentId = inc[0]?.id ?? null;
  }

  const recallInfo = pick
    ? {
        number: pick.recall.sourceRecallId,
        classification: pick.recall.classification,
        firm: pick.recall.recallingFirm,
        reason: pick.recall.reasonForRecall,
        codeInfo: pick.recall.codeInfo,
        sourceUrl: pick.recall.sourceUrl,
        isSimulated: pick.recall.isSimulated,
        incidentId,
      }
    : null;

  const productInfo = { sku: product.sku, name: product.name, brand: product.brand, upc: product.upc, sizeText: product.sizeText, matchedBy };
  const batchInfo = { lotCode, bestBy, inStoreRecords: Boolean(storeBatch) };
  const common = { reading, product: productInfo, batch: batchInfo, recall: recallInfo, evidence: pick?.result.evidence ?? [], sold, recallsChecked: latest.size };
  const code = [lotCode && `lot ${lotCode}`, bestBy && `best by ${bestBy}`].filter(Boolean).join(", ");

  if (matched && !hasCode && recallHasCodes(matched)) {
    return {
      ...common,
      verdict: "check_code",
      headline: `Recalled product. Check the code on this package`,
      reason: `${matched.recall.sourceRecallId} covers ${product.name}, but only some codes (${matched.recall.codeInfo ?? "see recall"}). The lot and best-by date could not be read from this photo.`,
    };
  }
  if (matched) {
    return {
      ...common,
      verdict: "recalled",
      headline: "Recalled. Pull this package from sale",
      reason: `${matched.result.reason}${code ? ` This package is ${code}.` : ""}`,
    };
  }
  if (review) {
    return { ...common, verdict: "check_code", headline: "Possible match. Needs a closer look", reason: review.result.reason };
  }
  if (lotMiss) {
    return {
      ...common,
      verdict: "not_this_batch",
      headline: "Safe to sell. This batch is not recalled",
      reason: `${lotMiss.recall.sourceRecallId} recalls ${product.name} (${lotMiss.recall.codeInfo ?? "specific codes"}), but this package is ${code || "outside those codes"}.`,
    };
  }
  return {
    ...common,
    verdict: "no_recall",
    headline: "No recall found for this product",
    reason: `None of the ${latest.size} recall${latest.size === 1 ? "" : "s"} Pullback has processed mention ${product.name}.`,
  };
}
