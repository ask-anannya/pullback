import * as z from "zod/v4";
import { complete, LlmUnavailableError } from "@/llm/client";
import { NOTICE_WRITER } from "./prompts";

export type NoticeInput = {
  storeName: string;
  productName: string;
  sizeText: string | null;
  codes: string;
  reason: string;
  recallNumber: string;
};

const Out = z.object({ subject: z.string().min(5).max(120), body: z.string().min(40).max(1500) });

export function templateNotice(i: NoticeInput) {
  return {
    subject: `Recall notice: ${i.productName} from ${i.storeName}`,
    body: `Hi {{customer_name}},

You bought ${i.productName}${i.sizeText ? ` (${i.sizeText})` : ""} from ${i.storeName}. The maker has recalled it (FDA recall ${i.recallNumber}, ${i.codes}) because of ${i.reason.toLowerCase()}.

Please stop using it and throw it away, or return it to us. We have already refunded {{refund_amount}} to your PayPal payment method, so you do not need to do anything else.

If you feel unwell, please contact a doctor.

We are sorry for the trouble.
${i.storeName}`,
  };
}

function wordCount(s: string) {
  return s.trim().split(/\s+/).length;
}

export async function writeNotice(i: NoticeInput, incidentId?: string | null): Promise<{ subject: string; body: string; source: "ai" | "template" }> {
  try {
    const out = await complete({
      model: "reasoning",
      system: NOTICE_WRITER.system,
      prompt: JSON.stringify(i, null, 2),
      schema: Out,
      promptVersion: NOTICE_WRITER.version,
      temperature: 0.4,
      incidentId,
    });
    const body = unescapeNewlines(out.body).replace(/—/g, ",");
    if (!body.includes("{{customer_name}}") || !body.includes("{{refund_amount}}") || wordCount(body) > 160)
      return { ...templateNotice(i), source: "template" };
    return { subject: out.subject.replace(/—/g, ","), body, source: "ai" };
  } catch (e) {
    if (e instanceof LlmUnavailableError) return { ...templateNotice(i), source: "template" };
    throw e;
  }
}

export function renderNotice(body: string, customerName: string, refundAmount: string): string {
  return unescapeNewlines(body).replaceAll("{{customer_name}}", customerName).replaceAll("{{refund_amount}}", refundAmount);
}

/** The model sometimes returns line breaks double-escaped ("\n" as two characters); restore them. */
export function unescapeNewlines(s: string): string {
  return s.replace(/\r\n|\n/g, "\n").replace(/\t/g, " ");
}
