import * as z from "zod/v4";
import { complete } from "@/llm/client";
import { LABEL_READER } from "./prompts";

export const LabelReading = z.object({
  brand: z.string().nullable(),
  product_name: z.string().nullable(),
  size: z.string().nullable(),
  upc: z.string().nullable(),
  lot_code: z.string().nullable(),
  best_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  best_by_as_printed: z.string().nullable(),
  legibility: z.enum(["clear", "partial", "unreadable"]),
  notes: z.string(),
});
export type LabelReading = z.infer<typeof LabelReading>;

/** Reads brand, product, barcode, lot and best-by from a package photo with Gemini vision. */
export async function readLabel(image: { mimeType: string; data: string }): Promise<LabelReading> {
  const out = await complete({
    model: "fast",
    system: LABEL_READER.system,
    prompt: "Read this product package and return the fields.",
    schema: LabelReading,
    promptVersion: LABEL_READER.version,
    temperature: 0,
    images: [image],
  });
  return { ...out, upc: out.upc ? out.upc.replace(/\D/g, "") || null : null };
}
