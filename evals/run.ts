/**
 * Matching eval: runs every case in evals/cases through the same parser and matcher the app uses.
 * Prints precision, recall and failures. Exits non-zero on any false-positive "matched".
 *
 *   npm run eval            (uses Gemini for parsing and fuzzy cases if GEMINI_API_KEY is set)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parseRecall } from "../src/recalls/parse";
import { matchRecallToProduct } from "../src/matching/identifiers";
import { fuzzyMatch } from "../src/matching/fuzzy";
import { closeDb } from "../src/db/client";

// LLM calls are audited; keep eval runs out of the app database.
process.env.DATABASE_URL = "pglite:memory://";

type Case = {
  id: string;
  type: string;
  note: string;
  expected: "matched" | "near_miss" | "needs_review" | "not_related";
  recall: { product_description: string; code_info: string; recalling_firm: string; reason_for_recall: string };
  product: { name: string; brand: string; upc: string | null; sizeText: string | null };
  batches: { lotCode: string; bestBy: string | null }[];
};

const dir = path.join(process.cwd(), "evals", "cases");
const cases: Case[] = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

let tp = 0, fp = 0, fn = 0, exact = 0;
const failures: string[] = [];
const rows: string[] = [];

for (const c of cases) {
  const parsed = await parseRecall(c.recall);
  const recallText = { productDescription: c.recall.product_description, recallingFirm: c.recall.recalling_firm };
  const product = { id: c.id, ...c.product };
  let r = matchRecallToProduct(recallText, parsed, product, c.batches);
  if (r.needsLlm) r = await fuzzyMatch(recallText, parsed, product, c.batches, r);

  const got = r.decision;
  if (got === "matched" && c.expected === "matched") tp++;
  if (got === "matched" && c.expected !== "matched") fp++;
  if (got !== "matched" && c.expected === "matched") fn++;
  if (got === c.expected) exact++;
  const ok = got === c.expected;
  rows.push(`${ok ? "ok  " : "MISS"} ${c.id.padEnd(34)} expected ${c.expected.padEnd(12)} got ${got.padEnd(12)} ${r.confidence}`);
  if (!ok) failures.push(`${c.id}: expected ${c.expected}, got ${got} (${r.reason})`);
}

const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
console.log(rows.join("\n"));
console.log("");
console.log(`Cases: ${cases.length}  exact label: ${exact}/${cases.length}`);
console.log(`Matched precision: ${(precision * 100).toFixed(1)}%  recall: ${(recall * 100).toFixed(1)}%  false positives: ${fp}`);
console.log(`AI: ${process.env.GEMINI_API_KEY ? "Gemini enabled" : "not configured (fuzzy cases fall back to needs_review)"}`);
if (failures.length) console.log("\nMisses:\n" + failures.map((f) => `- ${f}`).join("\n"));
await closeDb();
if (fp > 0) {
  console.error("\nFAIL: false-positive matches.");
  process.exit(1);
}
