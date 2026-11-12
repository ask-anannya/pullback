import Link from "next/link";
import { getShopperOrders } from "@/queries";
import { getShopper } from "@/shop/shopper";
import { formatUsd } from "@/lib/money";
import { env } from "@/lib/env";
import { fmtBestBy, shortName } from "@/shop/display";
import { ProductArt } from "../_components/product-art";
import { RemoveOrders } from "./remove-button";

export const dynamic = "force-dynamic";

function fmtWhen(d: Date) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function MyOrders({ searchParams }: { searchParams: Promise<{ placed?: string }> }) {
  const { placed } = await searchParams;
  const shopper = await getShopper();
  if (!shopper) {
    return <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">Demo shopper not found. Run npm run seed.</div>;
  }
  const { orders, notices } = await getShopperOrders(shopper.id);
  const resolution = env.paypalBaseUrl().includes("sandbox") ? "https://www.sandbox.paypal.com/resolutioncenter" : "https://www.paypal.com/resolutioncenter";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">My orders</h1>
          <p className="mt-1 text-cocoa-soft">Signed in as {shopper.name} (demo shopper)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {orders.length > 0 && <RemoveOrders className="shop-btn-ghost disabled:opacity-50" />}
          <Link href="/shop" className="shop-btn-ghost">
            Keep shopping
          </Link>
        </div>
      </div>

      {placed && orders.some((o) => o.id === placed) && (
        <div className="mt-6 rounded-3xl bg-forest p-5 text-cream">
          <div className="font-display text-xl font-bold">Thanks! Your order is paid.</div>
          <p className="mt-1 text-sm text-cream/80">The payment went through PayPal. Your snacks are packed from the batch shown below.</p>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 lg:col-span-2">
          {orders.length === 0 ? (
            <div className="shop-card p-10 text-center">
              <p className="text-lg font-semibold">No orders yet.</p>
              <Link href="/shop" className="shop-btn mt-5">
                Start shopping
              </Link>
            </div>
          ) : (
            orders.map((o) => {
              const paid = o.items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
              const refunded = o.items.reduce((s, i) => s + i.refundedCents, 0);
              const state = refunded === 0 ? "Paid" : refunded >= paid ? "Refunded" : "Partly refunded";
              return (
                <article key={o.id} className={`shop-card p-5 ${o.id === placed ? "ring-4 ring-mustard" : ""}`}>
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-display text-lg font-bold">Order {o.id.slice(0, 8).toUpperCase()}</div>
                      <div className="text-xs text-cocoa-soft">
                        {fmtWhen(o.orderedAt)} · paid with PayPal {o.paypalCaptureId ? <span className="font-mono">({o.paypalCaptureId})</span> : null}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${state === "Paid" ? "bg-cream-deep text-cocoa" : "bg-forest text-cream"}`}
                    >
                      {state}
                      {refunded > 0 ? ` ${formatUsd(refunded)}` : ""}
                    </span>
                  </header>
                  <ul className="mt-4 space-y-3">
                    {o.items.map((i) => {
                      const label = shortName(i.name, i.brand, null);
                      return (
                        <li key={i.orderItemId} className="flex items-center gap-3">
                          <div className="shrink-0 rounded-xl bg-cream-deep/60 p-1">
                            <ProductArt brand={i.brand} label={label} category={i.category} name={i.name} className="h-16 w-auto" />
                          </div>
                          <div className="min-w-0 flex-1 text-sm">
                            <div className="font-semibold">
                              {i.quantity} × {i.name}
                            </div>
                            <div className="text-xs text-cocoa-soft">
                              Batch <span className="font-mono">{i.lot ?? "n/a"}</span>
                              {i.bestBy ? ` · best by ${fmtBestBy(i.bestBy)}` : ""}
                            </div>
                            {i.refundedCents > 0 && (
                              <div className="mt-1 inline-block rounded-full bg-forest/10 px-2 py-0.5 text-xs font-bold text-forest">
                                Refunded {formatUsd(i.refundedCents)}
                                {i.recall ? ` · recall ${i.recall}` : ""}
                              </div>
                            )}
                          </div>
                          <div className="text-sm font-semibold tabular-nums">{formatUsd(i.quantity * i.unitPriceCents)}</div>
                        </li>
                      );
                    })}
                  </ul>
                  <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t-2 border-cream-deep pt-3 text-sm">
                    <span className="font-bold">Total {formatUsd(o.totalCents)}</span>
                    <span className="flex flex-wrap gap-4">
                      <a href={resolution} target="_blank" rel="noreferrer" className="text-xs font-semibold text-cocoa-soft underline hover:text-tomato">
                        Report a problem on PayPal
                      </a>
                      <RemoveOrders orderId={o.id} className="text-xs font-semibold text-cocoa-soft underline hover:text-tomato disabled:opacity-50" />
                    </span>
                  </footer>
                </article>
              );
            })
          )}
        </section>

        <aside className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold">Messages</h2>
          {notices.length === 0 ? (
            <div className="shop-card p-5 text-sm text-cocoa-soft">No messages. If anything you bought is ever recalled, we will tell you here first.</div>
          ) : (
            notices.map((n) => (
              <div key={n.id} className="shop-card border-tomato p-5">
                <div className="text-xs font-bold text-tomato uppercase">Recall notice · {fmtWhen(n.createdAt)}</div>
                <div className="mt-1 font-display text-lg leading-tight font-bold">{n.subject}</div>
                <p className="mt-2 text-sm whitespace-pre-wrap text-cocoa-soft">{n.body}</p>
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
