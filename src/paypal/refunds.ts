import * as z from "zod/v4";
import { paypalFetch } from "./auth";
import { centsToValue } from "@/lib/money";

export const RefundResponse = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: z.looseObject({ value: z.string(), currency_code: z.string() }).optional(),
  note_to_payer: z.string().optional(),
  create_time: z.string().optional(),
});
export type RefundResponse = z.infer<typeof RefundResponse>;

/**
 * Refund (part of) a capture. The idempotency key is sent as PayPal-Request-Id so a retry
 * with the same key returns the original refund instead of creating a new one.
 */
export async function refundCapture(args: {
  captureId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  noteToPayer?: string;
  invoiceId?: string;
  incidentId?: string | null;
  mockResponse?: string;
}): Promise<RefundResponse> {
  const headers: Record<string, string> = { Prefer: "return=representation" };
  if (args.mockResponse) headers["PayPal-Mock-Response"] = args.mockResponse;
  return paypalFetch(`/v2/payments/captures/${encodeURIComponent(args.captureId)}/refund`, {
    method: "POST",
    label: "refund_capture",
    idempotencyKey: args.idempotencyKey,
    incidentId: args.incidentId,
    headers,
    schema: RefundResponse,
    body: {
      amount: { value: centsToValue(args.amountCents), currency_code: args.currency },
      ...(args.noteToPayer ? { note_to_payer: args.noteToPayer.slice(0, 255) } : {}),
      ...(args.invoiceId ? { invoice_id: args.invoiceId.slice(0, 127) } : {}),
    },
  });
}

export async function getRefund(refundId: string, incidentId?: string | null): Promise<RefundResponse> {
  return paypalFetch(`/v2/payments/refunds/${encodeURIComponent(refundId)}`, {
    label: "get_refund",
    incidentId,
    schema: RefundResponse,
  });
}
