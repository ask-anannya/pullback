import Link from "next/link";
import { getShopProducts } from "@/queries";
import { slugCategory } from "@/shop/display";
import { ProductCard } from "../_components/product-card";

export const dynamic = "force-dynamic";

export default async function ShopAll({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const products = await getShopProducts();
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))] as string[];
  const shown = c ? products.filter((p) => slugCategory(p.category) === c) : products;
  const title = c ? (categories.find((x) => slugCategory(x) === c) ?? "Snacks") : "All snacks";

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1 text-cocoa-soft">{shown.length} products</p>
      <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
        <Link href="/shop" className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${!c ? "bg-cocoa text-cream" : "bg-white hover:bg-cream-deep"}`}>
          All
        </Link>
        {categories.map((x) => (
          <Link
            key={x}
            href={`/shop?c=${slugCategory(x)}`}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${c === slugCategory(x) ? "bg-cocoa text-cream" : "bg-white hover:bg-cream-deep"}`}
          >
            {x}
          </Link>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {shown.map((p) => (
          <ProductCard key={p.id} p={p} featured={p.sku === "TP-FIS-TEXMEX-30"} />
        ))}
      </div>
    </div>
  );
}
