import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { env } from "@/lib/env";
import { audit } from "@/audit/log";
import { listDisputes, getDispute, captureIdsOf } from "@/paypal/disputes";

export const OPEN_DISPUTE = (status: string) => !/RESOLVED|CLOSED|DENIED/i.test(status);

type DisputeRaw = {
  links?: { rel?: string }[];
  refund_details?: { transactions?: { gross_amount?: { value?: string } }[] };
} | null;

/**
 * Money PayPal already returned to the buyer through this dispute (for example after accept-claim).
 * Verified in the sandbox: an accepted claim stays UNDER_REVIEW but lists the refund here.
 */
export function disputeRefundedCents(raw: unknown): number {
  const txs = (raw as DisputeRaw)?.refund_details?.transactions ?? [];
  return txs.reduce((s, t) => s + Math.round(Number(t.gross_amount?.value ?? 0) * 100), 0);
}

/**
 * The seller can still act on the dispute. Status alone is not enough: after accept-claim the
 * sandbox keeps UNDER_REVIEW but offers no seller links. Without link data, fall back to status.
 */
export function disputeAwaitingSeller(status: string, raw: unknown): boolean {
  if (!OPEN_DISPUTE(status)) return false;
  const links = (raw as DisputeRaw)?.links;
  if (!links) return true;
  return links.some((l) => l.rel && l.rel !== "self");
}

/**
 * Pull disputes from PayPal and link them to orders by capture id
 * (a dispute's seller_transaction_id is the capture id). The list endpoint omits
 * disputed_transactions in the sandbox (probe row 8), so each dispute is fetched in full.
 */
export async function syncDisputes(storeId: string): Promise<{ synced: number; linked: number; error?: string }> {
  if (!env.paypalConfigured()) return { synced: 0, linked: 0, error: "PayPal is not configured" };
  const db = await getDb();
  let items;
  try {
    items = await listDisputes();
  } catch (e) {
    const error = (e as Error).message;
    await audit({ actor: "system", eventType: "dispute_sync_failed", storeId, payload: { error } });
    return { synced: 0, linked: 0, error };
  }
  let linked = 0;
  for (const listed of items) {
    // Always read the full dispute: the list omits capture ids, seller links and refund details.
    let d = listed;
    {
      try {
        d = { ...listed, ...(await getDispute(listed.dispute_id)) };
      } catch (e) {
        await audit({ actor: "system", eventType: "dispute_fetch_failed", storeId, payload: { disputeId: listed.dispute_id, error: (e as Error).message } });
      }
    }
    const caps = captureIdsOf(d);
    const order = caps.length
      ? (await db.select({ id: schema.orders.id }).from(schema.orders).where(inArray(schema.orders.paypalCaptureId, caps)))[0]
      : undefined;
    const existing = (await db.select().from(schema.disputes).where(eq(schema.disputes.paypalDisputeId, d.dispute_id)))[0];
    if (order ?? existing?.orderId) linked++;
    const values = {
      storeId,
      paypalDisputeId: d.dispute_id,
      orderId: order?.id ?? existing?.orderId ?? null,
      status: d.status ?? "UNKNOWN",
      raw: d as unknown as Record<string, unknown>,
    };
    if (existing) await db.update(schema.disputes).set(values).where(eq(schema.disputes.id, existing.id));
    else await db.insert(schema.disputes).values(values);

    // A partial-refund offer we sent earlier has now been paid out by PayPal.
    if (disputeRefundedCents(d) > 0) {
      const pending = await db
        .select({ id: schema.actions.id })
        .from(schema.actions)
        .where(and(eq(schema.actions.type, "dispute_accept"), eq(schema.actions.status, "pending"), eq(schema.actions.paypalRef, d.dispute_id)));
      for (const a of pending) await creditDisputeAccept(a.id, d as unknown as Record<string, unknown>);
    }
  }
  await audit({ actor: "system", eventType: "disputes_synced", storeId, payload: { synced: items.length, linked } });
  return { synced: items.length, linked };
}

/**
 * Mark a dispute_accept action as paid and add its amount to the affected items' refunded_cents,
 * so the over-refund guard sees it. Only moves an action that is not already succeeded.
 */
export async function creditDisputeAccept(actionId: string, dispute: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  const moved = await db
    .update(schema.actions)
    .set({ status: "succeeded", error: null, response: { dispute } })
    .where(and(eq(schema.actions.id, actionId), inArray(schema.actions.status, ["pending", "sent"])))
    .returning({ incidentId: schema.actions.incidentId, request: schema.actions.request });
  if (!moved.length) return;
  const { incidentId, request } = moved[0];
  const orderId = (request as { orderId?: string } | null)?.orderId;
  if (!orderId) return;
  const items = await db
    .select({ orderItemId: schema.affectedItems.orderItemId, cents: schema.affectedItems.refundCents })
    .from(schema.affectedItems)
    .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
    .where(and(eq(schema.affectedItems.incidentId, incidentId), eq(schema.orderItems.orderId, orderId)));
  for (const it of items)
    await db.update(schema.orderItems).set({ refundedCents: sql`${schema.orderItems.refundedCents} + ${it.cents}` }).where(eq(schema.orderItems.id, it.orderItemId));
  await audit({ actor: "system", eventType: "dispute_refund_confirmed", incidentId, payload: { actionId, orderId, disputeId: dispute.dispute_id } });
  // Last offer paid: drop the "waiting for the buyer" note from the incident.
  const stillPending = await db
    .select({ id: schema.actions.id })
    .from(schema.actions)
    .where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.status, "pending")));
  if (!stillPending.length)
    await db
      .update(schema.incidents)
      .set({ statusReason: null })
      .where(and(eq(schema.incidents.id, incidentId), sql`${schema.incidents.statusReason} like '%waiting for the buyer%'`));
}
