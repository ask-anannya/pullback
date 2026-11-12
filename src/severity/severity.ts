import type { HazardType } from "@/recalls/parse";

export type Severity = "urgent" | "standard" | "low";

/** Plan-core 8.5. The FDA class decides; the LLM only explains. */
export function severityFor(classification: string, hazard: HazardType): Severity {
  const c = classification.trim().toUpperCase();
  if (c === "CLASS I") return "urgent";
  if (c === "CLASS II") return hazard === "allergen" || hazard === "pathogen" ? "urgent" : "standard";
  if (c === "CLASS III") return "low";
  return "standard";
}

export const SEVERITY_RESPONSE: Record<Severity, string> = {
  urgent: "Brief now, refund batch ready, listing will be flagged",
  standard: "Brief, refund batch ready",
  low: "Logged only, no interruption",
};
