import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/audit/log";

/**
 * Removes the demo shopper's storefront orders from the app database, so the storefront demo can be
 * run again from an empty "My orders". Also removes this order's rows from incidents (affected items
 * and their actions) and the shopper's recall notices for those incidents.
 * PayPal is not touched: the sandbox payment and any refund stay in the sandbox.
 */
export async function removeShopperOrders(customerId: string, orderIds?: string[]): Promise<number> {
  const db = await getDb();
  const where = orderIds?.length
    ? and(eq(schema.orders.customerId, customerId), inArray(schema.orders.id, orderIds))
    : eq(schema.orders.customerId, customerId);
  const orders = await db.select({ id: schema.orders.id, captureId: schema.orders.paypalCaptureId }).from(schema.orders).where(where);
  if (!orders.length) return 0;
  const ids = orders.map((o) => o.id);

  const items = await db.select({ id: schema.orderItems.id }).from(schema.orderItems).where(inArray(schema.orderItems.orderId, ids));
  const itemIds = items.map((i) => i.id);
  const affected = itemIds.length
    ? await db.select({ id: schema.affectedItems.id, incidentId: schema.affectedItems.incidentId }).from(schema.affectedItems).where(inArray(schema.affectedItems.orderItemId, itemIds))
    : [];
  const incidentIds = [...new Set(affected.map((a) => a.incidentId))];

  if (affected.length) {
    await db.delete(schema.actions).where(inArray(schema.actions.affectedItemId, affected.map((a) => a.id)));
    await db.delete(schema.affectedItems).where(inArray(schema.affectedItems.id, affected.map((a) => a.id)));
  }
  if (incidentIds.length)
    await db.delete(schema.notices).where(and(eq(schema.notices.customerId, customerId), inArray(schema.notices.incidentId, incidentIds)));
  await db.update(schema.disputes).set({ orderId: null }).where(inArray(schema.disputes.orderId, ids));
  if (itemIds.length) await db.delete(schema.orderItems).where(inArray(schema.orderItems.id, itemIds));
  await db.delete(schema.orders).where(inArray(schema.orders.id, ids));

  await audit({
    actor: "owner",
    eventType: "shop_orders_removed",
    payload: { orders: ids, captures: orders.map((o) => o.captureId), note: "Removed from the app only. PayPal sandbox payments and refunds are unchanged." },
  });
  return ids.length;
}
