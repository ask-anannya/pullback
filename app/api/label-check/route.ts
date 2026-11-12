import { NextResponse } from "next/server";
import { readLabel } from "@/agents/label-reader";
import { checkLabel } from "@/matching/label-check";
import { LlmUnavailableError } from "@/llm/client";
import { audit } from "@/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** POST multipart form with "photo": reads the package with Gemini vision, then checks it against processed recalls. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a photo of the package." }, { status: 400 });
  if (!TYPES.has(file.type)) return NextResponse.json({ error: `Unsupported image type ${file.type || "unknown"}. Use JPG, PNG, WebP or HEIC.` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Photo is over 8 MB. Take a smaller one." }, { status: 400 });

  try {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const reading = await readLabel({ mimeType: file.type, data });
    const result = await checkLabel(reading);
    await audit({
      actor: "owner",
      eventType: "label_check",
      payload: {
        verdict: result.verdict,
        sku: result.product?.sku ?? null,
        lot: result.batch?.lotCode ?? null,
        bestBy: result.batch?.bestBy ?? null,
        recall: result.recall?.number ?? null,
        reading,
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof LlmUnavailableError)
      return NextResponse.json({ error: `The AI label reader is unavailable (${e.message}). Check the lot code by hand against the recall.` }, { status: 503 });
    throw e;
  }
}
