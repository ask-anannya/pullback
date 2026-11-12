import Link from "next/link";
import type { ShopProduct } from "@/queries";
import { formatUsd } from "@/lib/money";
import { shortName } from "@/shop/display";
import { ProductArt } from "./product-art";
import { AddToCart } from "./add-to-cart";

export function ProductCard({ p, featured = false }: { p: ShopProduct; featured?: boolean }) {
  const label = shortName(p.name, p.brand, p.sizeText);
  const flagged = p.listingStatus === "flagged";
  return (
    <div className="shop-card group relative flex flex-col overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-[0_10px_0_-4px_var(--color-cream-deep)]">
      {featured && !flagged && (
        <span className="absolute top-3 left-3 z-10 rounded-full bg-mustard px-2.5 py-1 text-[11px] font-bold text-cocoa">Bestseller</span>
      )}
      {flagged && <span className="absolute top-3 left-3 z-10 rounded-full bg-tomato px-2.5 py-1 text-[11px] font-bold text-white">Recalled</span>}
      <Link href={`/product/${p.sku}`} className="block rounded-2xl bg-cream-deep/60 p-3">
        <ProductArt brand={p.brand} label={label} category={p.category} name={p.name} className={`mx-auto h-44 w-auto transition group-hover:scale-[1.03] ${flagged ? "opacity-50 grayscale" : ""}`} />
      </Link>
      <div className="mt-3 flex flex-1 flex-col">
        <div className="text-[11px] font-semibold tracking-wide text-cocoa-soft uppercase">{p.brand}</div>
        <Link href={`/product/${p.sku}`} className="mt-0.5 font-display text-lg leading-tight font-bold hover:text-tomato">
          {label}
        </Link>
        <div className="mt-0.5 text-xs text-cocoa-soft">{p.sizeText}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="font-display text-xl font-extrabold">{formatUsd(p.priceCents)}</span>
          <AddToCart sku={p.sku} disabled={flagged} compact />
        </div>
      </div>
    </div>
  );
}
