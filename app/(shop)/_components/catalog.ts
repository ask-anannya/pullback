import type { ShopProduct } from "@/queries";

/** The slice of product data the client cart needs (prices shown only; the server re-prices). */
export type CatalogItem = Pick<ShopProduct, "sku" | "name" | "brand" | "sizeText" | "category" | "priceCents" | "listingStatus">;

export function toCatalog(products: ShopProduct[]): Record<string, CatalogItem> {
  return Object.fromEntries(
    products.map((p) => [p.sku, { sku: p.sku, name: p.name, brand: p.brand, sizeText: p.sizeText, category: p.category, priceCents: p.priceCents, listingStatus: p.listingStatus }]),
  );
}
