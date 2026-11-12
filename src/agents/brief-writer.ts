import * as z from "zod/v4";
import { complete, LlmUnavailableError } from "@/llm/client";
import { BRIEF_WRITER } from "./prompts";
import { formatUsd } from "@/lib/money";

export type BriefInput = {
  recallNumber: string;
  firm: string | null;
  recalledProduct: string;
  reason: string;
  classification: string;
  severity: string;
  storeProduct: string;
  matchReason: string;
  confidence: string;
  checkedOrderCount: number;
  affectedOrderIds: string[];
  totalRefundCents: number;
  rulesUsed: string[];
  isExpansion: boolean;
};

const Out = z.object({
  summary: z.string().min(20).max(800),
  recommendation: z.string().min(5).max(300),
  affected_order_ids: z.array(z.string()),
});

function template(i: BriefInput) {
  const n = i.affectedOrderIds.length;
  const summary = `${i.isExpansion ? "The recall has expanded. " : ""}${i.firm ?? "A firm"} recalled ${i.recalledProduct.split(",")[0]} (${i.recallNumber}, ${i.classification}) because of ${i.reason.toLowerCase()}. It matches your product "${i.storeProduct}": ${i.matchReason} ${n} of ${i.checkedOrderCount} orders of this product are affected, for a total refund of ${formatUsd(i.totalRefundCents)}.`;
  const recommendation =
    i.severity === "low"
      ? "No action is needed now; this is logged for your records."
      : `Approve to refund the ${n} affected order${n === 1 ? "" : "s"}, flag the listing and notify each customer.`;
  return { summary: summary.replace(/—/g, ","), recommendation };
}

export async function writeBrief(i: BriefInput, incidentId?: string | null): Promise<{ summary: string; recommendation: string; source: "ai" | "template" }> {
  try {
    const out = await complete({
      model: "reasoning",
      system: BRIEF_WRITER.system,
      prompt: JSON.stringify({ ...i, totalRefund: formatUsd(i.totalRefundCents) }, null, 2),
      schema: Out,
      promptVersion: BRIEF_WRITER.version,
      temperature: 0.2,
      incidentId,
    });
    // Guard: the brief must reference exactly the orders narrowing selected, never others.
    const want = new Set(i.affectedOrderIds);
    const got = new Set(out.affected_order_ids);
    if (got.size !== want.size || [...got].some((x) => !want.has(x))) return { ...template(i), source: "template" };
    return { summary: out.summary.replace(/—/g, ","), recommendation: out.recommendation.replace(/—/g, ","), source: "ai" };
  } catch (e) {
    if (e instanceof LlmUnavailableError) return { ...template(i), source: "template" };
    throw e;
  }
}
