import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { createBuyerOrder } from "@/paypal/orders";
import { getShopProducts } from "@/queries";
import { getShopper } from "@/shop/shopper";
import { env } from "@/lib/env";

const Body = z.object({ items: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1).max(20) })).min(1).max(30) });

/**
 * Storefront checkout, step 1: create the PayPal order from DB prices (never client prices).
 * No DB order is written yet, so abandoned carts never show up in recall checks.
 */
export async function POST(req: Request) {
  if (!env.paypalConfigured()) return NextResponse.json({ error: "PayPal sandbox is not configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Your cart is empty or invalid." }, { status: 400 });
  const shopper = await getShopper();
  if (!shopper) return NextResponse.json({ error: "Demo shopper not found. Run npm run seed." }, { status: 500 });

  const catalog = new Map((await getShopProducts()).map((p) => [p.sku, p]));
  const lines = [];
  for (const it of parsed.data.items) {
    const p = catalog.get(it.sku);
    if (!p) return NextResponse.json({ error: `Unknown product ${it.sku}` }, { status: 400 });
    if (p.listingStatus === "flagged") return NextResponse.json({ error: `${p.name} is unavailable because of a recall.` }, { status: 409 });
    lines.push({ name: p.name, sku: p.sku, quantity: it.qty, unitPriceCents: p.priceCents });
  }
  try {
    const order = await createBuyerOrder({
      lines,
      customId: shopper.id,
      brandName: "Trailhead Pantry",
      description: "Trailhead Pantry order (demo store, PayPal sandbox)",
    });
    return NextResponse.json({ id: order.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
