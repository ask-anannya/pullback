import * as z from "zod/v4";
import { complete, LlmUnavailableError } from "@/llm/client";
import { HAZARD_EXPLAINER } from "./prompts";
import type { HazardType } from "@/recalls/parse";

const Out = z.object({ explanation: z.string().min(10).max(400) });

const TEMPLATES: Record<HazardType, string> = {
  pathogen: "The product may carry harmful bacteria. People who eat it can get sick, so buyers should stop using it right away.",
  allergen: "The product contains an allergen that is not declared on the label. Buyers with that allergy could have a serious reaction.",
  foreign_material: "The product may contain pieces of foreign material. Buyers could be hurt if they eat it.",
  other: "The product does not meet a labeling or quality requirement. The risk to buyers is low, but they should be told.",
};

export async function explainHazard(args: {
  classification: string;
  reason: string;
  hazardType: HazardType;
  incidentId?: string | null;
}): Promise<{ text: string; source: "ai" | "template" }> {
  try {
    const out = await complete({
      model: "fast",
      system: HAZARD_EXPLAINER.system,
      prompt: `FDA classification: ${args.classification}\nReason for recall: ${args.reason}\nHazard type: ${args.hazardType}`,
      schema: Out,
      promptVersion: HAZARD_EXPLAINER.version,
      temperature: 0,
      incidentId: args.incidentId,
    });
    return { text: out.explanation.replace(/—/g, ","), source: "ai" };
  } catch (e) {
    if (e instanceof LlmUnavailableError) return { text: TEMPLATES[args.hazardType], source: "template" };
    throw e;
  }
}
