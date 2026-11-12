import type { DateRange, EvidenceRow } from "@/db/schema";
import type { ParsedRecall } from "@/recalls/parse";
import { compareUpc } from "@/recalls/parse";
import { brandEquals, brandInText, nameContainment, normalizeLot, parseSize, sizesEqual } from "./normalize";

export type ProductLike = { id: string; name: string; brand: string; upc: string | null; sizeText: string | null };
export type BatchLike = { lotCode: string; bestBy: string | null };
export type RecallText = { productDescription: string; recallingFirm?: string | null };

export type Decision = "matched" | "near_miss" | "needs_review" | "not_related";
export type Confidence = "high" | "medium" | "low";
export type Method = "upc" | "brand_name" | "lot_date" | "fuzzy_llm";

export type MatchResult = {
  decision: Decision;
  confidence: Confidence;
  method: Method;
  evidence: EvidenceRow[];
  reason: string;
  /** True when steps 1 to 3 gave only a partial signal and the fuzzy LLM step should decide. */
  needsLlm: boolean;
};

export function inRange(d: string, r: DateRange): boolean {
  return (r.from === null || d >= r.from) && (r.to === null || d <= r.to);
}

export function fmtRange(r: DateRange): string {
  if (r.from && r.to && r.from === r.to) return r.from;
  if (!r.from) return `on or before ${r.to}`;
  if (!r.to) return `on or after ${r.from}`;
  return `${r.from} to ${r.to}`;
}

/** Does any of the store's batches fall in the recalled lots or dates? null when the recall gives none. */
export function batchOverlap(parsed: Pick<ParsedRecall, "lots" | "dateRanges">, batches: BatchLike[]): {
  overlap: boolean | null;
  lots: string[];
  bestBys: string[];
} {
  const lots = new Set(parsed.lots.map(normalizeLot));
  if (!lots.size && !parsed.dateRanges.length) return { overlap: null, lots: [], bestBys: [] };
  const hitLots = batches.filter((b) => lots.has(normalizeLot(b.lotCode))).map((b) => b.lotCode);
  const hitDates = batches
    .filter((b) => b.bestBy && parsed.dateRanges.some((r) => inRange(b.bestBy!, r)))
    .map((b) => b.bestBy!);
  return { overlap: hitLots.length > 0 || hitDates.length > 0, lots: hitLots, bestBys: hitDates };
}

/**
 * Identifier-first matching (plan-core 8.3). Pure function; the fuzzy LLM step is separate.
 */
export function matchRecallToProduct(
  recall: RecallText,
  parsed: ParsedRecall,
  product: ProductLike,
  batches: BatchLike[],
): MatchResult {
  const evidence: EvidenceRow[] = [];
  const recallText = recall.productDescription;

  // 1. UPC
  let upcResult: "exact" | "check_digit_omitted" | null = null;
  let upcMatched: string | null = null;
  if (product.upc) {
    for (const u of parsed.upcs) {
      const r = compareUpc(u, product.upc);
      if (r) {
        upcResult = r;
        upcMatched = u;
        break;
      }
    }
  }
  const upcConflict = Boolean(product.upc && parsed.upcs.length && !upcResult);
  evidence.push({
    field: "Barcode (UPC)",
    recall: parsed.upcs.length ? parsed.upcs.join(", ") : null,
    store: product.upc,
    result: upcResult ? (upcResult === "exact" ? "match" : "partial") : !product.upc || !parsed.upcs.length ? "missing" : "mismatch",
  });

  // 2. Brand, name, size
  const brandMatch =
    parsed.brands.some((b) => brandEquals(b, product.brand) || brandInText(product.brand, b)) || brandInText(product.brand, recallText);
  evidence.push({
    field: "Brand",
    recall: parsed.brands.length ? parsed.brands.join(", ") : recall.recallingFirm ?? null,
    store: product.brand,
    result: brandMatch ? "match" : "mismatch",
  });

  const nameScore = Math.max(
    nameContainment(product.name, recallText, product.brand),
    ...parsed.productNames.map((n) => nameContainment(product.name, n, product.brand)),
  );
  const nameStrong = nameScore >= 0.8;
  const namePartial = nameScore >= 0.4;
  evidence.push({
    field: "Product name",
    recall: parsed.productNames[0] ?? recallText.slice(0, 80),
    store: product.name,
    result: nameStrong ? "match" : namePartial ? "partial" : "mismatch",
  });

  const storeSize = parseSize(product.sizeText);
  const recallSizes = parsed.sizes.map(parseSize).filter((x): x is number => x !== null);
  const sizeMatch = storeSize !== null && recallSizes.some((s) => sizesEqual(s, storeSize));
  const sizeConflict = storeSize !== null && recallSizes.length > 0 && !sizeMatch;
  evidence.push({
    field: "Size",
    recall: parsed.sizes.length ? parsed.sizes.join(", ") : null,
    store: product.sizeText,
    result: sizeMatch ? "match" : sizeConflict ? "mismatch" : "missing",
  });

  // 3. Lot or best-by overlap
  const ov = batchOverlap(parsed, batches);
  const recallCodes = [...parsed.lots.map((l) => `lot ${l}`), ...parsed.dateRanges.map((r) => `best by ${fmtRange(r)}`)];
  evidence.push({
    field: "Lot / best-by",
    recall: recallCodes.length ? recallCodes.join("; ") : null,
    store: batches.length ? batches.map((b) => `lot ${b.lotCode}${b.bestBy ? ` (best by ${b.bestBy})` : ""}`).join("; ") : null,
    result: ov.overlap === null ? "missing" : ov.overlap ? "match" : "mismatch",
  });

  const lotNearMiss = (what: string): MatchResult => ({
    decision: "near_miss",
    confidence: "high",
    method: "lot_date",
    evidence,
    reason: `${what}, but none of your batches are in the recalled ${parsed.lots.length ? "lots" : "best-by dates"}.`,
    needsLlm: false,
  });

  if (upcResult) {
    // Same product by barcode. A size conflict here means a different package of the same line.
    if (ov.overlap === false && batches.length > 0) return lotNearMiss(`Same product (barcode ${upcMatched})`);
    return {
      decision: "matched",
      confidence: "high",
      method: "upc",
      evidence,
      reason:
        upcResult === "exact"
          ? `Barcode ${product.upc} appears in the recall${ov.overlap ? " and your batches fall in the recalled codes" : ""}.`
          : `Barcode matches the recall (the recall omits the check digit)${ov.overlap ? " and your batches fall in the recalled codes" : ""}.`,
      needsLlm: false,
    };
  }

  if (brandMatch && nameStrong) {
    if (upcConflict)
      return {
        decision: "near_miss",
        confidence: "high",
        method: "brand_name",
        evidence,
        reason: `Same brand and similar name, but the barcode differs (${product.upc} is not in the recall).`,
        needsLlm: false,
      };
    if (sizeConflict)
      return {
        decision: "near_miss",
        confidence: "high",
        method: "brand_name",
        evidence,
        reason: `Same brand and product, but a different size (${product.sizeText} vs ${parsed.sizes.join(", ")}).`,
        needsLlm: false,
      };
    if (ov.overlap === false && batches.length > 0) return lotNearMiss(`Same brand and product name`);
    return {
      decision: "matched",
      confidence: sizeMatch && ov.overlap ? "high" : "medium",
      method: ov.overlap ? "lot_date" : "brand_name",
      evidence,
      reason: `Brand and product name match${sizeMatch ? ", size matches" : ""}${ov.overlap ? ", and your batches fall in the recalled codes" : ""}.`,
      needsLlm: false,
    };
  }

  if (brandMatch && namePartial && !upcConflict) {
    return {
      decision: "needs_review",
      confidence: "low",
      method: "fuzzy_llm",
      evidence,
      reason: "Same brand and a partly similar name. Needs a closer comparison.",
      needsLlm: true,
    };
  }

  if (brandMatch) {
    return {
      decision: "near_miss",
      confidence: "high",
      method: "brand_name",
      evidence,
      reason: `Same brand (${product.brand}) but a different product.`,
      needsLlm: false,
    };
  }

  if (nameStrong && !upcConflict) {
    return {
      decision: "needs_review",
      confidence: "low",
      method: "fuzzy_llm",
      evidence,
      reason: "Similar product name but the brand is not stated the same way. Needs a closer comparison.",
      needsLlm: true,
    };
  }

  return { decision: "not_related", confidence: "high", method: "brand_name", evidence, reason: "Different brand and product.", needsLlm: false };
}
