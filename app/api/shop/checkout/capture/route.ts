import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import * as z from "zod/v4";
import { getDb, schema } from "@/db/client";
import { captureOrder, firstCapture, getOrder, orderItemsOf } from "@/paypal/orders";
import { getShopper } from "@/shop/shopper";
import { audit } from "@/audit/log";

const Body = z.object({ paypalOrderId: z.string().min(5).max(64) });

/**
 * Storefront checkout, step 2: capture the approved PayPal order, then record the order exactly as
 * PayPal has it (items, quantities, prices). Items are filled from each product's shelf batch.
 * Idempotent on the PayPal order id.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "paypalOrderId required" }, { status: 400 });
  const { paypalOrderId } = parsed.data;
  const db = await getDb();

  const existing = (await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId)))[0];
  if (existing) return NextResponse.json({ orderId: existing.id, captureId: existing.paypalCaptureId });

  const shopper = await getShopper();
  if (!shopper) return NextResponse.json({ error: "Demo shopper not found. Run npm run seed." }, { status: 500 });

  try {
    const captured = await captureOrder(paypalOrderId, `shop-capture-${paypalOrderId}`);
    const cap = firstCapture(captured);
    if (!cap || cap.status !== "COMPLETED") {
      return NextResponse.json({ error: `Payment not completed (${cap?.status ?? captured.status}).` }, { status: 502 });
    }

    const lines = orderItemsOf(await getOrder(paypalOrderId));
    const products = lines.length ? await db.select().from(schema.products).where(inArray(schema.products.sku, lines.map((l) => l.sku))) : [];
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const totalCents = Math.round(Number(cap.amount?.value ?? 0) * 100);

    const [order] = await db
      .insert(schema.orders)
      .values({
        storeId: shopper.storeId,
        customerId: shopper.id,
        paypalOrderId,
        paypalCaptureId: cap.id,
        isRealSandbox: true,
        paymentMethod: "buyer",
        orderedAt: new Date(),
        totalCents,
        currency: cap.amount?.currency_code ?? "USD",
      })
      .returning({ id: schema.orders.id });
    const rows = lines
      .filter((l) => bySku.has(l.sku))
      .map((l) => {
        const p = bySku.get(l.sku)!;
        return { orderId: order.id, productId: p.id, batchId: p.shelfBatchId, quantity: l.quantity, unitPriceCents: l.unitPriceCents };
      });
    if (rows.length) await db.insert(schema.orderItems).values(rows);

    await audit({
      actor: "system",
      eventType: "shop_order_paid",
      storeId: shopper.storeId,
      payload: { orderId: order.id, paypalOrderId, captureId: cap.id, totalCents, items: rows.length, payer: captured.payer?.email_address ?? null },
    });
    return NextResponse.json({ orderId: order.id, captureId: cap.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
