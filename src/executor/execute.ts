import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/audit/log";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { refundCapture, getRefund } from "@/paypal/refunds";
import { PayPalError } from "@/paypal/auth";
import { acceptClaim, buyerRequestedCents, provideEvidence, sandboxRequireEvidence, getDispute } from "@/paypal/disputes";
import { renderNotice } from "@/agents/notice-writer";
import { OPEN_DISPUTE, creditDisputeAccept, disputeAwaitingSeller, disputeRefundedCents, syncDisputes } from "@/disputes/sync";
import type { Brief } from "@/pipeline/process-recall";
import { checkCaps, overRefund, type CapCheck } from "./caps";
import { idempotencyKey } from "./idempotency";

export type PlannedRefund = {
  affectedItemId: string;
  orderItemId: string;
  orderId: string;
  paypalOrderId: string | null;
  captureId: string | null;
  isRealSandbox: boolean;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amountCents: number;
  currency: string;
  rule: string;
  /** refund: PayPal refund. dispute_accept: accept the open dispute instead. skip: see skipReason. */
  path: "refund" | "dispute_accept" | "skip";
  disputeId: string | null;
  skipReason?: string;
  /** Part of this item PayPal already refunded through a dispute (only the rest is refunded here). */
  coveredByDisputeCents?: number;
  /** Everything PayPal refunded on this order through disputes, for the over-refund guard. */
  orderDisputeRefundedCents?: number;
};

export type Plan = {
  incident: typeof schema.incidents.$inferSelect;
  brief: Brief;
  refunds: PlannedRefund[];
  disputeAccepts: { orderId: string; disputeId: string; amountCents: number; currency: string }[];
  disputeEvidence: { orderId: string; disputeId: string; refundIds: string[] }[];
  notices: { customerId: string; name: string; email: string; subject: string; body: string }[];
  listingFlag: { productId: string; productName: string } | null;
  caps: CapCheck;
  totals: { refundCents: number; realRefundCents: number; skippedCount: number };
};

/** Builds exactly what approval will do. No PayPal calls (uses the local dispute table). */
export async function buildPlan(incidentId: string): Promise<Plan> {
  const db = await getDb();
  const incident = (await db.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId)))[0];
  if (!incident) throw new Error("Incident not found");
  const brief = incident.brief as Brief;

  const rows = await db
    .select({
      affectedItemId: schema.affectedItems.id,
      orderItemId: schema.affectedItems.orderItemId,
      refundCents: schema.affectedItems.refundCents,
      rule: schema.affectedItems.rule,
      orderId: schema.orders.id,
      paypalOrderId: schema.orders.paypalOrderId,
      captureId: schema.orders.paypalCaptureId,
      isRealSandbox: schema.orders.isRealSandbox,
      currency: schema.orders.currency,
      customerId: schema.customers.id,
      customerName: schema.customers.name,
      customerEmail: schema.customers.email,
    })
    .from(schema.affectedItems)
    .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .where(eq(schema.affectedItems.incidentId, incidentId));

  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const disputes = orderIds.length
    ? await db.select().from(schema.disputes).where(inArray(schema.disputes.orderId, orderIds))
    : [];
  const openDisputeByOrder = new Map(disputes.filter((d) => disputeAwaitingSeller(d.status, d.raw)).map((d) => [d.orderId!, d.paypalDisputeId]));
  // Orders where PayPal already refunded the buyer through a dispute. That money counts toward the
  // recalled items; only what is left is refunded, so the buyer is never paid twice or short-changed.
  const disputeRefunded = new Map<string, { disputeId: string; cents: number }>();
  for (const d of disputes.filter((x) => !openDisputeByOrder.has(x.orderId!) && disputeRefundedCents(x.raw) > 0)) {
    const cur = disputeRefunded.get(d.orderId!) ?? { disputeId: d.paypalDisputeId, cents: 0 };
    cur.cents += disputeRefundedCents(d.raw);
    disputeRefunded.set(d.orderId!, cur);
  }
  const disputeCreditLeft = new Map([...disputeRefunded].map(([k, v]) => [k, v.cents]));

  // Disputes still open at PayPal where the seller has no action left (for example a partial-refund
  // offer waiting for the buyer). A separate refund now could pay the buyer twice.
  const disputeInProgress = new Map(
    disputes
      .filter((d) => !openDisputeByOrder.has(d.orderId!) && !disputeRefunded.has(d.orderId!) && OPEN_DISPUTE(d.status))
      .map((d) => [d.orderId!, d]),
  );

  const refunds: PlannedRefund[] = rows.map((r) => {
    const disputeId = openDisputeByOrder.get(r.orderId) ?? null;
    const refundedVia = disputeRefunded.get(r.orderId);
    const inProgress = disputeInProgress.get(r.orderId);
    if (!r.isRealSandbox || !r.captureId) return { ...r, amountCents: r.refundCents, path: "skip", disputeId, skipReason: "Not a real sandbox payment" };
    if (refundedVia) {
      const covered = Math.min(r.refundCents, disputeCreditLeft.get(r.orderId) ?? 0);
      disputeCreditLeft.set(r.orderId, (disputeCreditLeft.get(r.orderId) ?? 0) - covered);
      const base = { ...r, disputeId: refundedVia.disputeId, coveredByDisputeCents: covered, orderDisputeRefundedCents: refundedVia.cents };
      if (covered >= r.refundCents)
        return { ...base, amountCents: r.refundCents, path: "skip", skipReason: `Already refunded by PayPal through dispute ${refundedVia.disputeId}` };
      return { ...base, amountCents: r.refundCents - covered, path: "refund" };
    }
    if (inProgress)
      return {
        ...r,
        amountCents: r.refundCents,
        path: "skip",
        disputeId: inProgress.paypalDisputeId,
        skipReason: `Dispute ${inProgress.paypalDisputeId} is in progress at PayPal (${inProgress.status}); no separate refund while it is open`,
      };
    return { ...r, amountCents: r.refundCents, path: disputeId ? "dispute_accept" : "refund", disputeId };
  });

  const acceptMap = new Map<string, { orderId: string; disputeId: string; amountCents: number; currency: string }>();
  for (const r of refunds.filter((x) => x.path === "dispute_accept")) {
    const cur = acceptMap.get(r.orderId) ?? { orderId: r.orderId, disputeId: r.disputeId!, amountCents: 0, currency: r.currency };
    cur.amountCents += r.amountCents;
    acceptMap.set(r.orderId, cur);
  }

  // Evidence path: open disputes on orders in this incident that were already refunded before.
  const alreadyRefunded = await db
    .select({ orderId: schema.orderItems.orderId, refunded: sql<number>`sum(${schema.orderItems.refundedCents})` })
    .from(schema.orderItems)
    .where(orderIds.length ? inArray(schema.orderItems.orderId, orderIds) : sql`false`)
    .groupBy(schema.orderItems.orderId);
  const refundedOrders = new Set(alreadyRefunded.filter((r) => Number(r.refunded) > 0).map((r) => r.orderId));
  const disputeEvidence = [...openDisputeByOrder.entries()]
    .filter(([orderId]) => refundedOrders.has(orderId) && !acceptMap.has(orderId))
    .map(([orderId, disputeId]) => ({ orderId, disputeId, refundIds: [] as string[] }));
  // An order on the evidence path is not refunded again.
  for (const r of refunds)
    if (disputeEvidence.some((d) => d.orderId === r.orderId) && r.path === "refund") {
      r.path = "skip";
      r.skipReason = "Order is on the dispute evidence path";
    }

  const byCustomer = new Map<string, { name: string; email: string; cents: number; simulated: boolean }>();
  for (const r of refunds) {
    const c = byCustomer.get(r.customerId) ?? { name: r.customerName, email: r.customerEmail, cents: 0, simulated: false };
    c.cents += r.amountCents;
    c.simulated ||= r.path === "skip" && (!r.isRealSandbox || !r.captureId);
    byCustomer.set(r.customerId, c);
  }
  const notices = [...byCustomer.entries()].map(([customerId, c]) => ({
    customerId,
    name: c.name,
    email: c.email,
    subject: brief.notice.subject,
    body: renderNotice(
      brief.notice.body,
      c.name.split(" ")[0],
      c.simulated ? `${formatUsd(c.cents)} (simulated order: no real PayPal payment exists, so nothing was refunded)` : formatUsd(c.cents),
    ),
  }));

  const refundsByOrder = new Map<string, number>();
  for (const r of refunds.filter((x) => x.path !== "skip")) refundsByOrder.set(r.orderId, (refundsByOrder.get(r.orderId) ?? 0) + r.amountCents);
  const caps = checkCaps(refundsByOrder, { perOrderCents: env.capPerOrderCents(), perBatchCents: env.capPerBatchCents() });

  return {
    incident,
    brief,
    refunds,
    disputeAccepts: [...acceptMap.values()],
    disputeEvidence,
    notices,
    listingFlag: incident.severity === "urgent" ? { productId: brief.match.productId, productName: brief.match.productName } : null,
    caps,
    totals: {
      refundCents: refunds.reduce((s, r) => s + r.amountCents, 0),
      realRefundCents: refunds.filter((r) => r.path !== "skip").reduce((s, r) => s + r.amountCents, 0),
      skippedCount: refunds.filter((r) => r.path === "skip").length,
    },
  };
}

export async function approveIncident(incidentId: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  const updated = await db
    .update(schema.incidents)
    .set({ status: "approved", statusReason: null })
    .where(and(eq(schema.incidents.id, incidentId), inArray(schema.incidents.status, ["awaiting_owner"])))
    .returning({ id: schema.incidents.id, storeId: schema.incidents.storeId });
  if (!updated.length) return { ok: false, reason: "Incident is not awaiting approval." };
  await audit({ actor: "owner", eventType: "incident_approved", incidentId, storeId: updated[0].storeId, payload: {} });
  return { ok: true };
}

export async function declineIncident(incidentId: string, reason?: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  const updated = await db
    .update(schema.incidents)
    .set({ status: "declined", statusReason: reason ?? null })
    .where(and(eq(schema.incidents.id, incidentId), inArray(schema.incidents.status, ["awaiting_owner"])))
    .returning({ id: schema.incidents.id, storeId: schema.incidents.storeId });
  if (!updated.length) return { ok: false, reason: "Incident is not awaiting approval." };
  await audit({ actor: "owner", eventType: "incident_declined", incidentId, storeId: updated[0].storeId, payload: { reason } });
  return { ok: true };
}

async function upsertAction(v: typeof schema.actions.$inferInsert) {
  const db = await getDb();
  await db.insert(schema.actions).values(v).onConflictDoNothing({ target: schema.actions.idempotencyKey });
  return (await db.select().from(schema.actions).where(eq(schema.actions.idempotencyKey, v.idempotencyKey)))[0];
}

async function setAction(id: string, v: Partial<typeof schema.actions.$inferInsert>) {
  const db = await getDb();
  await db.update(schema.actions).set(v).where(eq(schema.actions.id, id));
}

function errText(e: unknown): string {
  if (e instanceof PayPalError) return `${e.message}${e.issue ? ` [${e.issue}]` : ""}${e.debugId ? ` debug_id=${e.debugId}` : ""}`;
  return (e as Error)?.message ?? String(e);
}

/**
 * Plan-core 8.7. Runs only on an approved (or failed, for retry) incident. Every PayPal write
 * carries a deterministic idempotency key, so running this twice cannot double-refund.
 */
export async function executeIncident(incidentId: string, opts: { syncDisputesFirst?: boolean } = {}): Promise<{ status: string; reason?: string }> {
  const db = await getDb();
  const claimed = await db
    .update(schema.incidents)
    .set({ status: "executing" })
    .where(and(eq(schema.incidents.id, incidentId), inArray(schema.incidents.status, ["approved", "failed"])))
    .returning({ id: schema.incidents.id, storeId: schema.incidents.storeId });
  if (!claimed.length) return { status: "not_executable", reason: "Incident must be approved before it can run." };
  const storeId = claimed[0].storeId;

  if (opts.syncDisputesFirst ?? env.paypalConfigured()) await syncDisputes(storeId);
  const plan = await buildPlan(incidentId);

  if (!plan.caps.ok) {
    await db.update(schema.incidents).set({ status: "awaiting_owner", statusReason: plan.caps.reason }).where(eq(schema.incidents.id, incidentId));
    await audit({ actor: "system", eventType: "caps_exceeded", incidentId, storeId, payload: { reason: plan.caps.reason } });
    return { status: "awaiting_owner", reason: plan.caps.reason };
  }

  await audit({ actor: "system", eventType: "execution_started", incidentId, storeId, payload: { refunds: plan.refunds.length } });
  const noteToPayer = `Recall ${plan.brief.recall.number}: ${plan.brief.match.productName}. Please stop using it. This refund is for the recalled item.`;
  let failures = 0;
  const refundIdsByOrder = new Map<string, string[]>();

  // 1. Refunds (one per affected order item).
  for (const r of plan.refunds) {
    const key = idempotencyKey(incidentId, r.orderItemId, "refund");
    if (r.path === "dispute_accept") continue;
    const action = await upsertAction({
      incidentId,
      affectedItemId: r.affectedItemId,
      type: "refund",
      idempotencyKey: key,
      status: "planned",
      request: { captureId: r.captureId, amountCents: r.amountCents, currency: r.currency },
    });
    if (action.status === "succeeded" || (action.status === "skipped" && r.path === "skip")) {
      if (action.paypalRef) refundIdsByOrder.set(r.orderId, [...(refundIdsByOrder.get(r.orderId) ?? []), action.paypalRef]);
      continue;
    }
    // Nothing sent to PayPal yet: the request must match the current plan (amounts can change when a
    // dispute refunds part of an item, and a previously skipped item can become refundable).
    if (!action.paypalRef)
      await setAction(action.id, { request: { captureId: r.captureId, amountCents: r.amountCents, currency: r.currency, coveredByDisputeCents: r.coveredByDisputeCents ?? 0 } });
    if (r.path === "skip") {
      await setAction(action.id, { status: "skipped", error: r.skipReason ?? "Skipped" });
      continue;
    }

    // A refund id is already recorded for this action: confirm it with PayPal instead of refunding again.
    if (action.paypalRef) {
      try {
        const existing = await getRefund(action.paypalRef, incidentId);
        const ok = existing.status === "COMPLETED" || existing.status === "PENDING";
        await setAction(action.id, { status: ok ? "succeeded" : "failed", response: existing, error: ok ? null : `Refund status ${existing.status}` });
        if (ok) refundIdsByOrder.set(r.orderId, [...(refundIdsByOrder.get(r.orderId) ?? []), existing.id]);
        else failures++;
      } catch (e) {
        failures++;
        await setAction(action.id, { status: "failed", error: errText(e) });
      }
      continue;
    }

    // Over-refund guard against the order's capture total.
    const order = (await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId)))[0];
    const refundedSoFar = Number(
      (
        await db
          .select({ s: sql<number>`coalesce(sum(${schema.orderItems.refundedCents}), 0)` })
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, r.orderId))
      )[0].s,
    );
    // Money returned through disputes is not in refunded_cents unless we accepted the claim ourselves; count it.
    if (overRefund({ orderTotalCents: order.totalCents, orderRefundedCents: refundedSoFar + (r.orderDisputeRefundedCents ?? 0), amountCents: r.amountCents })) {
      await setAction(action.id, { status: "failed", error: "Refund would exceed captured amount minus already refunded" });
      failures++;
      continue;
    }

    await setAction(action.id, { status: "sent" });
    try {
      const res = await refundCapture({
        captureId: r.captureId!,
        amountCents: r.amountCents,
        currency: r.currency,
        idempotencyKey: key,
        noteToPayer,
        invoiceId: `pullback-${incidentId.slice(0, 8)}-${r.orderItemId.slice(0, 8)}`,
        incidentId,
      });
      const ok = res.status === "COMPLETED" || res.status === "PENDING";
      await setAction(action.id, { status: ok ? "succeeded" : "failed", response: res, paypalRef: res.id, error: ok ? null : `Refund status ${res.status}` });
      if (ok) {
        await db
          .update(schema.orderItems)
          .set({ refundedCents: sql`${schema.orderItems.refundedCents} + ${r.amountCents}` })
          .where(eq(schema.orderItems.id, r.orderItemId));
        refundIdsByOrder.set(r.orderId, [...(refundIdsByOrder.get(r.orderId) ?? []), res.id]);
      } else failures++;
    } catch (e) {
      failures++;
      await setAction(action.id, { status: "failed", error: errText(e) });
    }
  }

  // 2. Disputes not yet refunded: accept the claim instead of refunding separately.
  for (const d of plan.disputeAccepts) {
    const key = idempotencyKey(incidentId, d.orderId, "dispute_accept");
    const action = await upsertAction({ incidentId, type: "dispute_accept", idempotencyKey: key, status: "planned", request: d });
    // "pending": PayPal accepted our partial offer request; the buyer has to accept it. Never resend.
    if (action.status === "succeeded" || action.status === "pending") continue;
    await setAction(action.id, { status: "sent" });
    try {
      // Only the recalled items are refunded; a smaller amount than the buyer asked for is a partial accept.
      const requested = buyerRequestedCents(await getDispute(d.disputeId));
      const acceptType = requested !== null && d.amountCents < requested ? "PARTIAL_REFUND" : "REFUND";
      const res = await acceptClaim(
        d.disputeId,
        {
          note: `${plan.brief.recall.number}: the product was recalled (${plan.brief.recall.sourceUrl}). We accept the claim and refund the recalled item.`,
          refundCents: d.amountCents,
          currency: d.currency,
          acceptType,
        },
        incidentId,
      );
      // A full accept refunds at once. A partial accept only sends an offer (verified in the sandbox:
      // status WAITING_FOR_BUYER_RESPONSE, no refund transaction), so it is recorded as pending and
      // promoted by syncDisputes once PayPal lists the refund.
      const after = await getDispute(d.disputeId);
      const paidNow = disputeRefundedCents(after) > 0;
      await setAction(action.id, {
        status: paidNow ? "succeeded" : "pending",
        response: { accept: res, dispute: after } as Record<string, unknown>,
        paypalRef: d.disputeId,
        error: paidNow ? null : `Partial refund offered (${acceptType}); waiting for the buyer to accept it in PayPal (dispute status ${after.status})`,
      });
      if (paidNow) await creditDisputeAccept(action.id, after as Record<string, unknown>);
    } catch (e) {
      failures++;
      await setAction(action.id, { status: "failed", error: errText(e) });
    }
  }

  // 3. Disputes on orders already refunded: attach recall evidence.
  for (const d of plan.disputeEvidence) {
    const key = idempotencyKey(incidentId, d.orderId, "dispute_evidence");
    const action = await upsertAction({ incidentId, type: "dispute_evidence", idempotencyKey: key, status: "planned", request: d });
    if (action.status === "succeeded") continue;
    await setAction(action.id, { status: "sent" });
    try {
      const current = await getDispute(d.disputeId);
      if (current.status !== "WAITING_FOR_SELLER_RESPONSE" && env.paypalBaseUrl().includes("sandbox")) {
        await sandboxRequireEvidence(d.disputeId, incidentId);
      }
      const notes = `Recall ${plan.brief.recall.number} (${plan.brief.recall.sourceUrl}). The buyer was refunded for the recalled item. ${plan.brief.recall.reason}`;
      const res = await provideEvidence(d.disputeId, { notes, file: { name: "recall-evidence.txt", type: "text/plain", content: `${notes}\n\n${plan.brief.summary}` } }, incidentId);
      await setAction(action.id, { status: "succeeded", response: res as Record<string, unknown>, paypalRef: d.disputeId });
    } catch (e) {
      failures++;
      await setAction(action.id, { status: "failed", error: errText(e) });
    }
  }

  // 4. Reconcile refunds with PayPal.
  const refundActions = await db
    .select()
    .from(schema.actions)
    .where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.type, "refund"), eq(schema.actions.status, "succeeded")));
  for (const a of refundActions) {
    if (!a.paypalRef) continue;
    try {
      const r = await getRefund(a.paypalRef, incidentId);
      await setAction(a.id, { response: r });
    } catch (e) {
      await audit({ actor: "system", eventType: "refund_reconcile_failed", incidentId, payload: { refundId: a.paypalRef, error: errText(e) } });
    }
  }

  // 5. Flag the listing (urgent only, plan-core 8.5).
  if (plan.listingFlag) {
    const key = idempotencyKey(incidentId, plan.listingFlag.productId, "listing_flag");
    const action = await upsertAction({ incidentId, type: "listing_flag", idempotencyKey: key, status: "planned", request: plan.listingFlag });
    if (action.status !== "succeeded") {
      await db.update(schema.products).set({ listingStatus: "flagged" }).where(eq(schema.products.id, plan.listingFlag.productId));
      await setAction(action.id, { status: "succeeded" });
    }
  }

  // 6. Notices to the outbox.
  for (const n of plan.notices) {
    const key = idempotencyKey(incidentId, n.customerId, "notice");
    const action = await upsertAction({ incidentId, type: "notice", idempotencyKey: key, status: "planned", request: { customerId: n.customerId, email: n.email } });
    if (action.status === "succeeded") continue;
    await db.insert(schema.notices).values({ incidentId, customerId: n.customerId, subject: n.subject, body: n.body, status: "sent" });
    await setAction(action.id, { status: "succeeded" });
  }

  const status = failures ? "failed" : "done";
  const pendingOffers = (
    await db.select({ id: schema.actions.id }).from(schema.actions).where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.status, "pending")))
  ).length;
  const statusReason = failures
    ? `${failures} action(s) failed. Retrying reuses the same idempotency keys.`
    : pendingOffers
      ? `${pendingOffers} partial refund offer(s) sent through PayPal disputes; waiting for the buyer to accept.`
      : null;
  await db
    .update(schema.incidents)
    .set({ status, statusReason })
    .where(eq(schema.incidents.id, incidentId));
  await audit({ actor: "system", eventType: "execution_finished", incidentId, storeId, payload: { status, failures } });
  return { status };
}
