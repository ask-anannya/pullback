import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Brief } from "@/pipeline/process-recall";

export async function getStore() {
  const db = await getDb();
  return (await db.select().from(schema.stores).limit(1))[0] ?? null;
}

export async function getOverview() {
  const db = await getDb();
  const store = await getStore();
  const [orders] = await db.select({ n: count() }).from(schema.orders);
  const [realOrders] = await db.select({ n: count() }).from(schema.orders).where(eq(schema.orders.isRealSandbox, true));
  const [recalls] = await db.select({ n: count() }).from(schema.recalls);
  const incidents = await db.select().from(schema.incidents).orderBy(desc(schema.incidents.createdAt));
  const refundActions = await db
    .select({ request: schema.actions.request, type: schema.actions.type, updatedAt: schema.actions.updatedAt, incidentId: schema.actions.incidentId })
    .from(schema.actions)
    .where(and(inArray(schema.actions.type, ["refund", "dispute_accept"]), eq(schema.actions.status, "succeeded")));
  const refundedCents = refundActions.reduce((s, a) => s + Number((a.request as { amountCents?: number })?.amountCents ?? 0), 0);

  // Time from recall ingestion to the last refund, for finished incidents.
  const recallTimes = new Map<string, number>();
  for (const r of await db.select({ id: schema.recalls.id, createdAt: schema.recalls.createdAt }).from(schema.recalls))
    recallTimes.set(r.id, r.createdAt.getTime());
  let fastestMs: number | null = null;
  for (const inc of incidents.filter((i) => i.status === "done")) {
    const last = refundActions.filter((a) => a.incidentId === inc.id).map((a) => a.updatedAt.getTime());
    const start = recallTimes.get(inc.recallId);
    if (!last.length || !start) continue;
    const ms = Math.max(...last) - start;
    fastestMs = fastestMs === null ? ms : Math.min(fastestMs, ms);
  }

  return {
    store,
    ordersChecked: orders.n,
    realSandboxOrders: realOrders.n,
    recallsChecked: recalls.n,
    incidents: incidents.map((i) => ({ ...i, brief: i.brief as Brief })),
    ordersAffected: incidents.filter((i) => i.status !== "logged_only" && i.status !== "declined").reduce((s, i) => s + i.affectedOrderCount, 0),
    refundedCents,
    fastestMs,
  };
}

export async function getIncident(id: string) {
  const db = await getDb();
  const incident = (await db.select().from(schema.incidents).where(eq(schema.incidents.id, id)))[0];
  if (!incident) return null;
  const items = await db
    .select({
      affectedItemId: schema.affectedItems.id,
      rule: schema.affectedItems.rule,
      refundCents: schema.affectedItems.refundCents,
      orderId: schema.orders.id,
      orderedAt: schema.orders.orderedAt,
      isRealSandbox: schema.orders.isRealSandbox,
      captureId: schema.orders.paypalCaptureId,
      quantity: schema.orderItems.quantity,
      customer: schema.customers.name,
      lot: schema.batches.lotCode,
      bestBy: schema.batches.bestBy,
    })
    .from(schema.affectedItems)
    .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
    .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .leftJoin(schema.batches, eq(schema.orderItems.batchId, schema.batches.id))
    .where(eq(schema.affectedItems.incidentId, id))
    .orderBy(schema.orders.orderedAt);
  const actions = await db.select().from(schema.actions).where(eq(schema.actions.incidentId, id)).orderBy(schema.actions.createdAt);
  const timeline = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.incidentId, id)).orderBy(schema.auditEvents.at);
  const children = await db.select({ id: schema.incidents.id, brief: schema.incidents.brief, status: schema.incidents.status }).from(schema.incidents).where(eq(schema.incidents.parentIncidentId, id));
  const disputes = items.length
    ? await db.select().from(schema.disputes).where(inArray(schema.disputes.orderId, [...new Set(items.map((i) => i.orderId))]))
    : [];
  return { incident: { ...incident, brief: incident.brief as Brief }, items, actions, timeline, children, disputes };
}

export async function getReview() {
  const db = await getDb();
  const matches = await db
    .select({ id: schema.matches.id, reason: schema.matches.reason, confidence: schema.matches.confidence, evidence: schema.matches.evidence, createdAt: schema.matches.createdAt, product: schema.products.name, recall: schema.recalls.sourceRecallId, recallDesc: schema.recalls.productDescription })
    .from(schema.matches)
    .innerJoin(schema.products, eq(schema.matches.productId, schema.products.id))
    .innerJoin(schema.recalls, eq(schema.matches.recallId, schema.recalls.id))
    .where(eq(schema.matches.decision, "needs_review"))
    .orderBy(desc(schema.matches.createdAt));
  const incidents = await db.select({ id: schema.incidents.id, brief: schema.incidents.brief }).from(schema.incidents);
  const items = incidents.flatMap((i) => ((i.brief as Brief).needsReview ?? []).map((r) => ({ ...r, incidentId: i.id, title: (i.brief as Brief).title })));
  return { matches, items };
}

export async function getActivity(limit = 300) {
  const db = await getDb();
  const events = await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.at)).limit(limit);
  const nearMisses = await db
    .select({ reason: schema.matches.reason, product: schema.products.name, recall: schema.recalls.sourceRecallId, createdAt: schema.matches.createdAt })
    .from(schema.matches)
    .innerJoin(schema.products, eq(schema.matches.productId, schema.products.id))
    .innerJoin(schema.recalls, eq(schema.matches.recallId, schema.recalls.id))
    .where(eq(schema.matches.decision, "near_miss"))
    .orderBy(desc(schema.matches.createdAt));
  return { events, nearMisses };
}

export async function getOutbox() {
  const db = await getDb();
  return db
    .select({ id: schema.notices.id, subject: schema.notices.subject, body: schema.notices.body, status: schema.notices.status, createdAt: schema.notices.createdAt, customer: schema.customers.name, email: schema.customers.email, incidentId: schema.notices.incidentId })
    .from(schema.notices)
    .innerJoin(schema.customers, eq(schema.notices.customerId, schema.customers.id))
    .orderBy(desc(schema.notices.createdAt));
}

// Storefront ------------------------------------------------------------------------------

export type ShopProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  sizeText: string | null;
  category: string | null;
  priceCents: number;
  listingStatus: "active" | "flagged";
  shelfLot: string | null;
  shelfBestBy: string | null;
};

export async function getShopProducts(): Promise<ShopProduct[]> {
  const db = await getDb();
  return db
    .select({
      id: schema.products.id,
      sku: schema.products.sku,
      name: schema.products.name,
      brand: schema.products.brand,
      sizeText: schema.products.sizeText,
      category: schema.products.category,
      priceCents: schema.products.priceCents,
      listingStatus: schema.products.listingStatus,
      shelfLot: schema.batches.lotCode,
      shelfBestBy: schema.batches.bestBy,
    })
    .from(schema.products)
    .leftJoin(schema.batches, eq(schema.products.shelfBatchId, schema.batches.id))
    .orderBy(schema.products.createdAt);
}

export async function getShopProduct(sku: string): Promise<ShopProduct | null> {
  return (await getShopProducts()).find((p) => p.sku === sku) ?? null;
}

/** The shopper's orders with per-item refund state, plus the recall notices sent to them. */
export async function getShopperOrders(customerId: string) {
  const db = await getDb();
  const orders = await db.select().from(schema.orders).where(eq(schema.orders.customerId, customerId)).orderBy(desc(schema.orders.orderedAt));
  const items = orders.length
    ? await db
        .select({
          orderId: schema.orderItems.orderId,
          orderItemId: schema.orderItems.id,
          sku: schema.products.sku,
          name: schema.products.name,
          brand: schema.products.brand,
          category: schema.products.category,
          quantity: schema.orderItems.quantity,
          unitPriceCents: schema.orderItems.unitPriceCents,
          refundedCents: schema.orderItems.refundedCents,
          lot: schema.batches.lotCode,
          bestBy: schema.batches.bestBy,
        })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .leftJoin(schema.batches, eq(schema.orderItems.batchId, schema.batches.id))
        .where(inArray(schema.orderItems.orderId, orders.map((o) => o.id)))
    : [];
  // Which recall each refunded item belongs to.
  const recallByItem = new Map<string, string>();
  if (items.length) {
    const rows = await db
      .select({ orderItemId: schema.affectedItems.orderItemId, brief: schema.incidents.brief, status: schema.incidents.status })
      .from(schema.affectedItems)
      .innerJoin(schema.incidents, eq(schema.affectedItems.incidentId, schema.incidents.id))
      .where(inArray(schema.affectedItems.orderItemId, items.map((i) => i.orderItemId)));
    for (const r of rows) recallByItem.set(r.orderItemId, (r.brief as Brief).recall.number);
  }
  const notices = await db
    .select({ id: schema.notices.id, subject: schema.notices.subject, body: schema.notices.body, createdAt: schema.notices.createdAt })
    .from(schema.notices)
    .where(eq(schema.notices.customerId, customerId))
    .orderBy(desc(schema.notices.createdAt));
  return {
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id).map((i) => ({ ...i, recall: recallByItem.get(i.orderItemId) ?? null })) })),
    notices,
  };
}

/** Latest orders for the seller overview, so a storefront purchase visibly arrives. */
export async function getRecentOrders(limit = 6) {
  const db = await getDb();
  const orders = await db
    .select({
      id: schema.orders.id,
      orderedAt: schema.orders.orderedAt,
      totalCents: schema.orders.totalCents,
      isRealSandbox: schema.orders.isRealSandbox,
      paymentMethod: schema.orders.paymentMethod,
      customer: schema.customers.name,
      email: schema.customers.email,
    })
    .from(schema.orders)
    .innerJoin(schema.customers, eq(schema.orders.customerId, schema.customers.id))
    .orderBy(desc(schema.orders.orderedAt))
    .limit(limit);
  const lines = orders.length
    ? await db
        .select({ orderId: schema.orderItems.orderId, name: schema.products.name, quantity: schema.orderItems.quantity })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .where(inArray(schema.orderItems.orderId, orders.map((o) => o.id)))
    : [];
  return orders.map((o) => ({ ...o, lines: lines.filter((l) => l.orderId === o.id) }));
}

export async function orderLines(orderId: string) {
  const db = await getDb();
  return db
    .select({ name: schema.products.name, sku: schema.products.sku, quantity: schema.orderItems.quantity, unitPriceCents: schema.orderItems.unitPriceCents })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
    .where(eq(schema.orderItems.orderId, orderId));
}

export async function disputeCount() {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(schema.disputes).where(isNotNull(schema.disputes.orderId));
  return r.n;
}

export { sql };
