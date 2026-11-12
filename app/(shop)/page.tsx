import Link from "next/link";
import { getShopProducts } from "@/queries";
import { shortName, slugCategory } from "@/shop/display";
import { ProductArt } from "./_components/product-art";
import { ProductCard } from "./_components/product-card";

export const dynamic = "force-dynamic";

const HERO_SKU = "TP-FIS-TEXMEX-30";

function Wave({ from, to, flip = false }: { from: string; to: string; flip?: boolean }) {
  return (
    <div style={{ background: from }} aria-hidden>
      <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className={`block h-10 w-full ${flip ? "rotate-180" : ""}`}>
        <path d="M0 30 C 240 70 480 -10 720 30 S 1200 70 1440 30 V60 H0 Z" fill={to} />
      </svg>
    </div>
  );
}

export default async function Home() {
  const products = await getShopProducts();
  const hero = products.find((p) => p.sku === HERO_SKU) ?? products[0];
  const best = [hero, ...products.filter((p) => p.sku !== hero?.sku && p.listingStatus === "active").slice(0, 7)].filter(Boolean);
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))] as string[];
  const sidekicks = products.filter((p) => ["Popcorn", "Chocolate"].includes(p.category ?? "")).slice(0, 2);

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-6 sm:px-6 md:grid-cols-2 md:pt-16">
          <div>
            <span className="inline-block rounded-full bg-mustard px-3 py-1 text-xs font-bold tracking-wide uppercase">Fresh batches every week</span>
            <h1 className="mt-4 font-display text-5xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl">
              Snacks worth
              <br />
              the <span className="text-tomato">long way</span> round.
            </h1>
            <p className="mt-5 max-w-md text-lg text-cocoa-soft">
              Crunchy trail mixes, roasted nuts and sweet stuff, packed in small batches and tracked from shelf to your door.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/shop" className="shop-btn">
                Shop snacks
              </Link>
              {hero && (
                <Link href={`/product/${hero.sku}`} className="shop-btn-ghost">
                  Try the {shortName(hero.name, hero.brand, hero.sizeText)}
                </Link>
              )}
            </div>
          </div>
          <div className="relative mx-auto h-80 w-full max-w-md sm:h-96">
            <div className="absolute inset-6 rounded-full bg-mustard/70" aria-hidden />
            <div className="absolute top-2 right-10 h-16 w-16 rounded-full bg-tomato/80" aria-hidden />
            <div className="absolute bottom-6 left-4 h-10 w-10 rounded-full bg-forest" aria-hidden />
            {hero && (
              <Link href={`/product/${hero.sku}`} className="absolute inset-x-0 top-0 mx-auto block h-full w-2/3 drop-shadow-xl">
                <ProductArt brand={hero.brand} label={shortName(hero.name, hero.brand, hero.sizeText)} category={hero.category} name={hero.name} className="h-full w-full" />
              </Link>
            )}
            {sidekicks[0] && (
              <ProductArt
                brand={sidekicks[0].brand}
                label={shortName(sidekicks[0].name, sidekicks[0].brand, sidekicks[0].sizeText)}
                category={sidekicks[0].category}
                name={sidekicks[0].name}
                className="absolute bottom-0 left-0 h-40 w-auto -rotate-12"
              />
            )}
            {sidekicks[1] && (
              <ProductArt
                brand={sidekicks[1].brand}
                label={shortName(sidekicks[1].name, sidekicks[1].brand, sidekicks[1].sizeText)}
                category={sidekicks[1].category}
                name={sidekicks[1].name}
                className="absolute right-0 bottom-4 h-32 w-auto rotate-12"
              />
            )}
          </div>
        </div>
      </section>

      <Wave from="var(--color-cream)" to="var(--color-forest)" />
      <section className="bg-forest text-cream">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap justify-center gap-2">
            {categories.map((c) => (
              <Link key={c} href={`/shop?c=${slugCategory(c)}`} className="rounded-full border-2 border-cream/30 px-4 py-2 text-sm font-bold hover:border-mustard hover:bg-mustard hover:text-cocoa">
                {c}
              </Link>
            ))}
          </div>
        </div>
      </section>
      <Wave from="var(--color-cream)" to="var(--color-forest)" flip />

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Bestsellers</h2>
          <Link href="/shop" className="text-sm font-bold text-tomato hover:underline">
            Shop all
          </Link>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-5 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {best.map((p, i) => (
            <ProductCard key={p!.id} p={p!} featured={i === 0} />
          ))}
        </div>
      </section>

      <section id="promise" className="mx-auto max-w-6xl scroll-mt-24 px-4 sm:px-6">
        <div className="grid gap-5 rounded-[2rem] bg-cocoa p-8 text-cream sm:p-12 md:grid-cols-3">
          <div className="md:col-span-1">
            <h2 className="font-display text-3xl leading-tight font-extrabold">Our recall promise</h2>
            <p className="mt-3 text-cream/70">Food recalls happen. What matters is how fast you hear about it and get your money back.</p>
          </div>
          {[
            ["Every batch tracked", "We record the lot and best-by date of every jar we ship, so we know exactly which orders a recall touches."],
            ["Refund first, questions never", "If something you bought is recalled, the refund goes back to your PayPal account. No forms, no returns."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl bg-cream/10 p-5">
              <div className="font-display text-xl font-bold text-mustard">{t}</div>
              <p className="mt-2 text-sm text-cream/80">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
