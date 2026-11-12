/** Display helpers for the storefront (pure, safe on server and client). */

/** "Fisher Tex Mex Trail Mix 30 oz Jar" -> "Tex Mex Trail Mix". */
export function shortName(name: string, brand: string, size: string | null): string {
  let n = name;
  if (n.toLowerCase().startsWith(brand.toLowerCase())) n = n.slice(brand.length).trim();
  if (size) n = n.replace(new RegExp(`\\s*${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*$`, "i"), "");
  n = n.replace(/\s+(Jar|Can|Bag|Box)$/i, "").trim();
  return n || name;
}

export function slugCategory(c: string | null): string {
  return (c ?? "other").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const BRAND_COLORS = ["#d9472b", "#2e5c4f", "#f2b33d", "#8a4fbf", "#1f6fb2", "#c26b2e", "#3f8f5a", "#b8325f"];

export function brandColor(brand: string): string {
  let h = 0;
  for (const ch of brand) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BRAND_COLORS[h % BRAND_COLORS.length];
}

export function fmtBestBy(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** File name (without extension) of a product's photo in public/products. */
export function productImageSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
