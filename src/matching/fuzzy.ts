import * as z from "zod/v4";
import { complete, LlmUnavailableError } from "@/llm/client";
import { FUZZY_MATCHER } from "@/agents/prompts";
import type { ParsedRecall } from "@/recalls/parse";
import { batchOverlap, type BatchLike, type MatchResult, type ProductLike, type RecallText } from "./identifiers";

export const FuzzyOutput = z.object({
  decision: z.enum(["same_product", "near_miss", "not_related"]),
  confidence: z.enum(["high", "medium", "low"]),
  field_comparison: z.array(
    z.object({
      field: z.string(),
      recall: z.string().nullable(),
      store: z.string().nullable(),
      result: z.enum(["match", "mismatch", "partial", "missing"]),
    }),
  ),
  reason: z.string().describe("One line a store owner can read"),
});
export type FuzzyOutput = z.infer<typeof FuzzyOutput>;

/** Apply a fuzzy LLM verdict on top of the deterministic result. Pure, so it can be tested. */
export function applyFuzzy(base: MatchResult, out: FuzzyOutput, parsed: ParsedRecall, batches: BatchLike[]): MatchResult {
  const evidence = [...base.evidence, ...out.field_comparison.map((f) => ({ ...f, field: `AI: ${f.field}` }))];
  if (out.decision === "not_related") return { ...base, decision: "not_related", evidence, reason: out.reason, needsLlm: false };
  if (out.decision === "near_miss") return { ...base, decision: "near_miss", confidence: out.confidence, evidence, reason: out.reason, needsLlm: false };
  // same_product: never auto-match on low confidence (precision over recall).
  if (out.confidence === "low")
    return { ...base, decision: "needs_review", confidence: "low", evidence, reason: `AI thinks this may be the same product, but is not sure: ${out.reason}`, needsLlm: false };
  const ov = batchOverlap(parsed, batches);
  if (ov.overlap === false && batches.length > 0)
    return { ...base, decision: "near_miss", confidence: out.confidence, evidence, reason: `${out.reason} None of your batches are in the recalled codes.`, needsLlm: false };
  return { ...base, decision: "matched", confidence: out.confidence, method: "fuzzy_llm", evidence, reason: out.reason, needsLlm: false };
}

export async function fuzzyMatch(
  recall: RecallText,
  parsed: ParsedRecall,
  product: ProductLike,
  batches: BatchLike[],
  base: MatchResult,
): Promise<MatchResult> {
  const prompt = JSON.stringify(
    {
      recall: {
        product_description: recall.productDescription,
        recalling_firm: recall.recallingFirm,
        brands: parsed.brands,
        product_names: parsed.productNames,
        sizes: parsed.sizes,
        upcs: parsed.upcs,
      },
      store_product: { brand: product.brand, name: product.name, size: product.sizeText, upc: product.upc },
    },
    null,
    2,
  );
  try {
    const out = await complete({
      model: "reasoning",
      system: FUZZY_MATCHER.system,
      prompt,
      schema: FuzzyOutput,
      promptVersion: FUZZY_MATCHER.version,
      temperature: 0,
    });
    return applyFuzzy(base, out, parsed, batches);
  } catch (e) {
    if (e instanceof LlmUnavailableError)
      return { ...base, decision: "needs_review", confidence: "low", reason: `${base.reason} (AI comparison unavailable)`, needsLlm: false };
    throw e;
  }
}
