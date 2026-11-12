import * as z from "zod/v4";
import { complete, LlmUnavailableError } from "@/llm/client";
import { RECALL_PARSER } from "@/agents/prompts";
import type { DateRange } from "@/db/schema";

export type HazardType = "allergen" | "pathogen" | "foreign_material" | "other";

export type ParsedRecall = {
  upcs: string[];
  brands: string[];
  productNames: string[];
  sizes: string[];
  lots: string[];
  dateRanges: DateRange[];
  hazardType: HazardType;
  parserVersion: string;
};

export const REGEX_PARSER_VERSION = "regex-1";

// ---------- UPC / EAN ----------

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** GTIN check digit validation (works for UPC-A 12 and EAN-13). */
export function validGtin(code: string): boolean {
  if (!/^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * UPCs found after a "UPC" keyword (10 to 14 digits, spaces or dashes allowed; recall text often
 * omits the check digit), plus standalone 12 or 13 digit numbers that pass the check digit test.
 */
export function extractUpcs(text: string): string[] {
  const found = new Set<string>();
  // Allow a few words between the keyword and the digits ("UPC code for the bar is 8-57087-00303-1").
  const kw = /\b(?:UPC|GTIN|EAN)s?\b[^\d\n]{0,30}?((?:\d[\s-]?){9,14}\d)/gi;
  for (const m of text.matchAll(kw)) {
    const d = digitsOnly(m[1]);
    if (d.length >= 10 && d.length <= 14) found.add(d);
  }
  for (const m of text.matchAll(/(?<![\d-])(\d{12,13})(?![\d-])/g)) {
    if (validGtin(m[1])) found.add(m[1]);
  }
  return [...found];
}

/** Compare a recall UPC with a store UPC. Returns "exact", "check_digit_omitted", or null. */
export function compareUpc(recallUpc: string, storeUpc: string): "exact" | "check_digit_omitted" | null {
  const a = digitsOnly(recallUpc).replace(/^0+/, "");
  const b = digitsOnly(storeUpc).replace(/^0+/, "");
  if (!a || !b) return null;
  if (a === b) return "exact";
  // Recall text frequently drops the trailing check digit (11 digits for a UPC-A).
  if (b.length === a.length + 1 && b.startsWith(a)) return "check_digit_omitted";
  return null;
}

// ---------- Lots ----------

const LOT_STOP = /\b(best\s*by|best\s*before|exp(?:iry|iration)?|use\s*by|sell\s*(?:by|thru|through)|upc|item|sn\b|packed)/i;

export function extractLots(text: string): string[] {
  const out = new Set<string>();
  const re = /\blots?\b(?:\s*(?:#|no\.?|numbers?|codes?)s?)?\s*[:#]?\s*/gi;
  for (const m of text.matchAll(re)) {
    let rest = text.slice(m.index! + m[0].length);
    const stop = rest.search(LOT_STOP);
    if (stop >= 0) rest = rest.slice(0, stop);
    rest = rest.split(/[.;](?:\s|$)/)[0];
    for (const tok of rest.split(/[\s,]+|\band\b/i)) {
      const t = tok.replace(/^[#:]+|[.,;:)]+$/g, "").trim();
      if (t.length >= 3 && /\d/.test(t) && /^[A-Za-z0-9-]+$/.test(t) && !/^\d{1,2}\/\d/.test(t)) out.add(t.toUpperCase());
    }
  }
  return [...out];
}

// ---------- Dates ----------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function yr(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

type DateHit = { index: number; end: number; from: string; to: string };

/** Find dates in free text. Month-only dates become a whole-month range. */
export function findDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const mon = "(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
  const patterns: [RegExp, (m: RegExpMatchArray) => [string, string] | null][] = [
    // 23/MAR/2027, 17 APR 2018, 03JUL12
    [new RegExp(`\\b(\\d{1,2})[\\s/-]?${mon}[\\s/-]?(\\d{4}|\\d{2})\\b`, "gi"), (m) => {
      const d = iso(yr(m[3]), MONTHS[m[2].toLowerCase().slice(0, 3)], Number(m[1]));
      return d ? [d, d] : null;
    }],
    // July 10, 2027 / Apr 22,2021 / JAN 04 17
    [new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4}|\\d{2})\\b`, "gi"), (m) => {
      const d = iso(yr(m[3]), MONTHS[m[1].toLowerCase().slice(0, 3)], Number(m[2]));
      return d ? [d, d] : null;
    }],
    // 08/06/27, 4/28/2017, 2027-08-06 handled below. US order unless first part > 12.
    [/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b/g, (m) => {
      let a = Number(m[1]), b = Number(m[2]);
      if (a > 12 && b <= 12) [a, b] = [b, a];
      const d = iso(yr(m[3]), a, b);
      return d ? [d, d] : null;
    }],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => {
      const d = iso(Number(m[1]), Number(m[2]), Number(m[3]));
      return d ? [d, d] : null;
    }],
    // 11/2016 (month and year)
    [/\b(\d{1,2})\/(\d{4})\b/g, (m) => {
      const y = Number(m[2]), mo = Number(m[1]);
      const a = iso(y, mo, 1);
      return a ? [a, iso(y, mo, lastDay(y, mo))!] : null;
    }],
  ];
  for (const [re, fn] of patterns) {
    for (const m of text.matchAll(re)) {
      const start = m.index!, end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.index)) continue;
      const r = fn(m);
      if (r) hits.push({ index: start, end, from: r[0], to: r[1] });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Turn code_info text into date ranges. "on or before X" gives an open start;
 * "X through Y" / "X to Y" gives a closed range; any other date is a single day.
 */
export function extractDateRanges(text: string): DateRange[] {
  const hits = findDates(text);
  const ranges: DateRange[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const before = text.slice(Math.max(0, h.index - 30), h.index).toLowerCase();
    const next = hits[i + 1];
    const between = next ? text.slice(h.end, next.index).toLowerCase() : "";
    if (next && /^\s*(through|thru|to|until|-)\s*$/.test(between)) {
      ranges.push({ from: h.from, to: next.to });
      i++;
    } else if (/(on or before|up to and including|or before|or earlier|prior to)\s*$/.test(before)) {
      ranges.push({ from: null, to: h.to });
    } else if (/(on or after|or later|after)\s*$/.test(before)) {
      ranges.push({ from: h.from, to: null });
    } else {
      ranges.push({ from: h.from, to: h.to });
    }
  }
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const k = `${r.from}|${r.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------- Sizes, hazard ----------

export function extractSizes(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*-?\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|l)\b\.?/gi)) {
    out.add(`${m[1]} ${m[2].toLowerCase()}`);
  }
  return [...out];
}

export function classifyHazard(reason: string): HazardType {
  const r = reason.toLowerCase();
  if (/salmonella|listeria|e\.?\s*coli|botulism|botulinum|clostridium|cronobacter|hepatitis|norovirus|pathogen|bacteri|mold|mould|toxin/.test(r)) return "pathogen";
  if (/undeclared|allergen|\bmilk\b|peanut|tree nut|cashew|almond|pecan|walnut|\bsoy|wheat|gluten|\begg|sesame|shellfish|shrimp|\bfish\b|salmon|tuna|crustacean/.test(r)) return "allergen";
  if (/metal|glass|plastic|foreign (material|object|matter)|rubber|wood|stone/.test(r)) return "foreign_material";
  return "other";
}

/** Deterministic pass only. Used directly in tests and as the fallback when the LLM is unavailable. */
export function parseDeterministic(r: { product_description: string; code_info?: string | null; reason_for_recall?: string | null }): ParsedRecall {
  const desc = r.product_description;
  const code = r.code_info ?? "";
  const all = `${desc}\n${code}`;
  const firstClause = desc.split(/,|\bUPC\b|\(|;|\bNet\b/i)[0].trim();
  return {
    upcs: extractUpcs(all),
    brands: [],
    productNames: firstClause ? [firstClause] : [],
    sizes: extractSizes(desc),
    lots: extractLots(code || desc),
    dateRanges: extractDateRanges(code),
    hazardType: classifyHazard(r.reason_for_recall ?? ""),
    parserVersion: REGEX_PARSER_VERSION,
  };
}

// ---------- LLM extraction ----------

export const LlmParse = z.object({
  upcs: z.array(z.string()).describe("Barcodes exactly as written in the text, digits only"),
  brands: z.array(z.string()).describe("Brand names printed on the product"),
  product_names: z.array(z.string()).describe("Product names without brand, size or packaging"),
  sizes: z.array(z.string()).describe("Package sizes such as '30 oz'"),
  lots: z.array(z.string()).describe("Lot codes exactly as written; empty if none"),
  date_ranges: z
    .array(z.object({ from: z.string().nullable(), to: z.string().nullable() }))
    .describe("Best-by/expiry/sell-by coverage as ISO dates YYYY-MM-DD; null for an open end"),
  hazard_type: z.enum(["allergen", "pathogen", "foreign_material", "other"]),
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Merge: regex wins on exact identifiers; LLM values are kept only if they are grounded in the text. */
export function mergeParse(det: ParsedRecall, llm: z.infer<typeof LlmParse>, sourceText: string): ParsedRecall {
  const textDigits = digitsOnly(sourceText);
  const upper = sourceText.toUpperCase();
  const llmUpcs = llm.upcs.map(digitsOnly).filter((u) => u.length >= 10 && textDigits.includes(u));
  const llmLots = llm.lots.map((l) => l.trim().toUpperCase()).filter((l) => l.length >= 2 && upper.includes(l));
  const llmDates = llm.date_ranges.filter((d) => (d.from === null || ISO.test(d.from)) && (d.to === null || ISO.test(d.to)) && (d.from || d.to));
  return {
    upcs: det.upcs.length ? det.upcs : llmUpcs,
    brands: llm.brands.filter((b) => upper.includes(b.toUpperCase())),
    productNames: llm.product_names.length ? llm.product_names : det.productNames,
    sizes: det.sizes.length ? det.sizes : llm.sizes,
    lots: det.lots.length ? det.lots : llmLots,
    dateRanges: det.dateRanges.length ? det.dateRanges : llmDates,
    // The deterministic hazard classifier wins when it found something specific.
    hazardType: det.hazardType !== "other" ? det.hazardType : llm.hazard_type,
    parserVersion: `${REGEX_PARSER_VERSION}+${RECALL_PARSER.version}`,
  };
}

export async function parseRecall(r: {
  product_description: string;
  code_info?: string | null;
  reason_for_recall?: string | null;
}): Promise<ParsedRecall> {
  const det = parseDeterministic(r);
  const text = `PRODUCT DESCRIPTION:\n${r.product_description}\n\nCODE INFO:\n${r.code_info ?? ""}\n\nREASON:\n${r.reason_for_recall ?? ""}`;
  try {
    const llm = await complete({
      model: "fast",
      system: RECALL_PARSER.system,
      prompt: text,
      schema: LlmParse,
      promptVersion: RECALL_PARSER.version,
      temperature: 0,
    });
    return mergeParse(det, llm, `${r.product_description}\n${r.code_info ?? ""}`);
  } catch (e) {
    if (e instanceof LlmUnavailableError) return det;
    throw e;
  }
}
