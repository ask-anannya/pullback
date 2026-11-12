const STOP = new Set([
  "the", "a", "an", "of", "with", "and", "in", "for", "by", "brand", "bag", "bags", "jar", "jars", "can", "cans",
  "pack", "packs", "box", "case", "cases", "per", "net", "wt", "weight", "plastic", "packaged", "product", "products",
  "oz", "ounce", "ounces", "lb", "lbs", "g", "grams", "kg", "ml", "l", "upc", "count", "ct", "size", "container", "units",
]);

/** Very small stemmer: enough for "nuts"/"nut", "mixed"/"mix", "berries"/"berry". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/(\d)\s*-\s*(oz|lb|g)\b/g, "$1 $2")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name tokens with sizes, numbers and filler words removed; stemmed; deduplicated. */
export function nameTokens(s: string): string[] {
  const words = normalizeText(s)
    .replace(/\b\d+(?:\.\d+)?\s*(oz|ounces?|lbs?|g|grams?|kg|ml|l)\b/g, " ")
    .split(" ")
    .filter((w) => w && !/^\d/.test(w) && !STOP.has(w))
    .map(stem);
  return [...new Set(words)];
}

/**
 * Fraction of the store name's tokens that appear in the recall text tokens.
 * Brand words are removed from both sides first, so a shared brand alone never looks like a shared product.
 */
export function nameContainment(storeName: string, recallText: string, brand?: string): number {
  const brandTokens = new Set(brand ? nameTokens(brand) : []);
  const a = nameTokens(storeName).filter((t) => !brandTokens.has(t));
  if (!a.length) return 0;
  const b = new Set(nameTokens(recallText).filter((t) => !brandTokens.has(t)));
  return a.filter((t) => b.has(t)).length / a.length;
}

/** True if the brand appears in the text as whole words (case, punctuation and "&" insensitive). */
export function brandInText(brand: string, text: string): boolean {
  const b = normalizeText(brand).replace(/\./g, "");
  if (!b) return false;
  const t = ` ${normalizeText(text).replace(/\./g, "")} `;
  return t.includes(` ${b} `);
}

const BRAND_SUFFIX = new Set(["co", "company", "inc", "llc", "ltd", "corp", "corporation", "brand", "brands", "foods", "the"]);

/** Same brand after dropping corporate suffixes ("Copper Kettle Co." equals "Copper Kettle", not "Kettle"). */
export function brandEquals(a: string, b: string): boolean {
  const core = (s: string) =>
    normalizeText(s)
      .replace(/\./g, "")
      .split(" ")
      .filter((w) => w && !BRAND_SUFFIX.has(w))
      .join(" ");
  const x = core(a);
  return x.length > 0 && x === core(b);
}

const UNIT_GRAMS: Record<string, number> = {
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592,
  g: 1, gram: 1, grams: 1, kg: 1000, ml: 1, l: 1000,
};

/** Size in grams (or ml) from text like "12 oz", "340g", "1.5 lb". */
export function parseSize(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.toLowerCase().match(/(\d+(?:\.\d+)?)\s*-?\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l)\b/);
  if (!m) return null;
  const unit = UNIT_GRAMS[m[2]];
  return unit ? Number(m[1]) * unit : null;
}

/** Sizes within 3 percent count as equal (12 oz is 340.2 g). */
export function sizesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) <= 0.03;
}

export function normalizeLot(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
