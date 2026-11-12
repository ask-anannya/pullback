"use client";

import Link from "next/link";
import { formatUsd } from "@/lib/money";
import { shortName } from "@/shop/display";
import { useCart } from "../_components/cart";
import { ProductArt } from "../_components/product-art";
import type { CatalogItem } from "../_components/catalog";

export function CartView({ catalog }: { catalog: Record<string, CatalogItem> }) {
  const { lines, ready, setQty, remove } = useCart();
  const known = lines.filter((l) => catalog[l.sku]);
  const total = known.reduce((s, l) => s + l.qty * catalog[l.sku].priceCents, 0);
  const blocked = known.some((l) => catalog[l.sku].listingStatus === "flagged");

  if (!ready) return <div className="mt-8 h-40 animate-pulse rounded-3xl bg-cream-deep" />;
  if (!known.length) {
    return (
      <div className="shop-card mt-8 p-10 text-center">
        <p className="text-lg font-semibold">Your cart is empty.</p>
        <Link href="/shop" className="shop-btn mt-5">
          Find a snack
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-3">
      <ul className="space-y-3 md:col-span-2">
        {known.map((l) => {
          const p = catalog[l.sku];
          const label = shortName(p.name, p.brand, p.sizeText);
          return (
            <li key={l.sku} className="shop-card flex items-center gap-4 p-3">
              <div className="shrink-0 rounded-2xl bg-cream-deep/60 p-1">
                <ProductArt brand={p.brand} label={label} category={p.category} name={p.name} className="h-20 w-auto" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-cocoa-soft uppercase">{p.brand}</div>
                <div className="font-display font-bold leading-tight">{label}</div>
                <div className="text-xs text-cocoa-soft">
                  {p.sizeText} · {formatUsd(p.priceCents)}
                </div>
                {p.listingStatus === "flagged" && <div className="mt-1 text-xs font-bold text-tomato">Recalled: remove to check out</div>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center rounded-full border-2 border-cocoa/15">
                  <button className="h-8 w-8 font-bold" onClick={() => setQty(l.sku, l.qty - 1)} aria-label="Fewer">
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                  <button className="h-8 w-8 font-bold" onClick={() => setQty(l.sku, l.qty + 1)} aria-label="More">
                    +
                  </button>
                </div>
                <button className="text-xs text-cocoa-soft underline hover:text-tomato" onClick={() => remove(l.sku)}>
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <aside className="shop-card h-fit p-5">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span className="font-bold tabular-nums">{formatUsd(total)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm text-cocoa-soft">
          <span>Shipping</span>
          <span>Free</span>
        </div>
        <div className="mt-3 flex justify-between border-t-2 border-cream-deep pt-3 font-display text-xl font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{formatUsd(total)}</span>
        </div>
        {blocked ? (
          <p className="mt-4 text-sm font-semibold text-tomato">Remove recalled items to check out.</p>
        ) : (
          <Link href="/checkout" className="shop-btn mt-5 w-full">
            Check out
          </Link>
        )}
      </aside>
    </div>
  );
}
