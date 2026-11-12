import Link from "next/link";
import { notFound } from "next/navigation";
import { getShopProduct } from "@/queries";
import { formatUsd } from "@/lib/money";
import { fmtBestBy, shortName } from "@/shop/display";
import { ProductArt } from "../../_components/product-art";
import { AddToCart } from "../../_components/add-to-cart";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const p = await getShopProduct(decodeURIComponent(sku));
  if (!p) notFound();
  const label = shortName(p.name, p.brand, p.sizeText);
  const flagged = p.listingStatus === "flagged";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/shop" className="text-sm font-semibold text-cocoa-soft hover:text-tomato">
        Back to all snacks
      </Link>
      <div className="mt-4 grid gap-10 md:grid-cols-2">
        <div className="relative rounded-[2rem] bg-cream-deep p-8">
          <div className="absolute top-8 right-8 h-24 w-24 rounded-full bg-mustard/60" aria-hidden />
          <ProductArt brand={p.brand} label={label} category={p.category} name={p.name} className={`relative mx-auto h-80 w-auto sm:h-96 ${flagged ? "opacity-50 grayscale" : ""}`} />
        </div>
        <div className="flex flex-col justify-center">
          <div className="text-sm font-bold tracking-wide text-tomato uppercase">{p.brand}</div>
          <h1 className="mt-1 font-display text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">{label}</h1>
          <div className="mt-2 text-cocoa-soft">
            {p.sizeText} · {p.category}
          </div>
          <div className="mt-5 font-display text-4xl font-extrabold">{formatUsd(p.priceCents)}</div>

          {flagged ? (
            <div className="mt-6 rounded-2xl border-2 border-tomato bg-white p-4 text-sm">
              <div className="font-bold text-tomato">Unavailable: this product is under a recall.</div>
              <p className="mt-1 text-cocoa-soft">We have paused sales. If you bought it, check My orders for your refund.</p>
            </div>
          ) : (
            <div className="mt-6">
              <AddToCart sku={p.sku} />
            </div>
          )}

          <dl className="mt-8 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-white p-4">
              <dt className="text-xs font-semibold text-cocoa-soft uppercase">Batch on shelf</dt>
              <dd className="mt-1 font-mono font-bold">{p.shelfLot ?? "n/a"}</dd>
            </div>
            <div className="rounded-2xl bg-white p-4">
              <dt className="text-xs font-semibold text-cocoa-soft uppercase">Best by</dt>
              <dd className="mt-1 font-bold">{fmtBestBy(p.shelfBestBy) || "n/a"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-cocoa-soft">We record the batch of every item we ship, so a recall can be matched to your exact order.</p>
        </div>
      </div>
    </div>
  );
}
