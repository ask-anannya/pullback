import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/audit/log";
import { valueToCents } from "@/lib/money";
import { createAndCaptureCardOrder } from "./orders";

/** PayPal wants YYYY-MM. Accept MM/YYYY, MM/YY and YYYY-MM. */
export function normalizeExpiry(s: string): string {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (m) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${m[1].padStart(2, "0")}`;
  throw new Error(`PAYPAL_TEST_CARD_EXPIRY "${s}" is not a valid expiry (use YYYY-MM)`);
}

export function testCard() {
  const number = process.env.PAYPAL_TEST_CARD_NUMBER;
  if (!number) throw new Error("PAYPAL_TEST_CARD_NUMBER is not set (Developer Dashboard > Testing Tools > Card Generator)");
  return {
    number: number.replace(/\s/g, ""),
    expiry: normalizeExpiry(process.env.PAYPAL_TEST_CARD_EXPIRY || "2030-12"),
    securityCode: process.env.PAYPAL_TEST_CARD_CVV || "123",
    name: "Pullback Demo Buyer",
  };
}

/**
 * Option A seeding: create and capture a real sandbox payment for each demo order marked "card".
 * Uses PayPal-Request-Id = "seed-<order id>", so re-running never charges twice.
 */
export async function attachCardPayments(opts: { orderIds?: string[]; log?: (s: string) => void } = {}) {
  const db = await getDb();
  const log = opts.log ?? (() => {});
  const where = [eq(schema.orders.paymentMethod, "card"), eq(schema.orders.isRealSandbox, false)];
  if (opts.orderIds?.length) where.push(inArray(schema.orders.id, opts.orderIds));
  const pending = await db.select().from(schema.orders).where(and(...where)).orderBy(schema.orders.orderedAt);
  const card = testCard();
  let ok = 0;
  const errors: string[] = [];

  for (const o of pending) {
    const lines = await db
      .select({ name: schema.products.name, sku: schema.products.sku, quantity: schema.orderItems.quantity, unitPriceCents: schema.orderItems.unitPriceCents })
      .from(schema.orderItems)
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, o.id));
    try {
      const r = await createAndCaptureCardOrder({ lines, customId: o.id, requestId: `seed-${o.id}`, card });
      const captured = r.raw.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;
      if (captured && valueToCents(captured) !== o.totalCents) throw new Error(`Captured ${captured}, expected ${o.totalCents / 100}`);
      await db.update(schema.orders).set({ paypalOrderId: r.orderId, paypalCaptureId: r.captureId, isRealSandbox: true }).where(eq(schema.orders.id, o.id));
      ok++;
      log(`  paid ${o.id.slice(0, 8)}  order ${r.orderId}  capture ${r.captureId}  (${r.status})`);
    } catch (e) {
      const msg = `${o.id.slice(0, 8)}: ${(e as Error).message}`;
      errors.push(msg);
      log(`  FAILED ${msg}`);
    }
  }
  await audit({ actor: "system", eventType: "seed_card_payments", payload: { attempted: pending.length, succeeded: ok, errors } });
  return { attempted: pending.length, succeeded: ok, errors };
}
