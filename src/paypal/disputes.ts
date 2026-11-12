import * as z from "zod/v4";
import { paypalFetch } from "./auth";
import { centsToValue } from "@/lib/money";

export const DisputeSummary = z.looseObject({
  dispute_id: z.string(),
  status: z.string().optional(),
  reason: z.string().optional(),
  dispute_life_cycle_stage: z.string().optional(),
  disputed_transactions: z
    .array(z.looseObject({ seller_transaction_id: z.string().optional(), buyer_transaction_id: z.string().optional() }))
    .optional(),
});
export type DisputeSummary = z.infer<typeof DisputeSummary>;

const DisputeList = z.looseObject({ items: z.array(DisputeSummary).optional() });

export async function listDisputes(query: { dispute_state?: string; page_size?: number } = {}) {
  const r = await paypalFetch(`/v1/customer/disputes`, {
    label: "list_disputes",
    query: { page_size: query.page_size ?? 50, dispute_state: query.dispute_state },
    schema: DisputeList,
  });
  return r.items ?? [];
}

export async function getDispute(id: string) {
  return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}`, { label: "get_dispute", schema: DisputeSummary });
}

/**
 * Seller transaction id on a dispute is the capture id (verified in M0, see docs/paypal-capabilities.md).
 */
export function captureIdsOf(d: DisputeSummary): string[] {
  return (d.disputed_transactions ?? []).map((t) => t.seller_transaction_id).filter((x): x is string => Boolean(x));
}

/** multipart/form-data: an "input" JSON part plus an optional evidence file. */
export async function provideEvidence(
  id: string,
  args: { notes: string; evidenceType?: string; file?: { name: string; content: string; type: string } },
  incidentId?: string | null,
) {
  const form = new FormData();
  const input = { evidences: [{ evidence_type: args.evidenceType ?? "OTHER", notes: args.notes.slice(0, 2000) }] };
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
  if (args.file) form.append("evidence_file", new Blob([args.file.content], { type: args.file.type }), args.file.name);
  return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, {
    method: "POST",
    label: "dispute_provide_evidence",
    incidentId,
    form,
  });
}

export async function acceptClaim(
  id: string,
  args: { note: string; refundCents?: number; currency?: string; acceptType?: "REFUND" | "PARTIAL_REFUND" },
  incidentId?: string | null,
) {
  return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, {
    method: "POST",
    label: "dispute_accept_claim",
    incidentId,
    body: {
      note: args.note.slice(0, 2000),
      // Recalled goods are thrown away, never sent back. Without a type, PayPal treats the accept as a
      // refund-with-return and rejects it with MISSING_RETURN_SHIPPING_ADDRESS. REFUND must be the full
      // requested amount (less gives INVALID_ACCEPT_CLAIM_TYPE); use PARTIAL_REFUND below it.
      // Both seen in the sandbox on a MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED dispute.
      accept_claim_type: args.acceptType ?? "REFUND",
      ...(args.refundCents !== undefined
        ? { refund_amount: { currency_code: args.currency ?? "USD", value: centsToValue(args.refundCents) } }
        : {}),
    },
  });
}

/** Amount the buyer asked for on the dispute, in cents, if PayPal reports it. */
export function buyerRequestedCents(d: unknown): number | null {
  const v = (d as { offer?: { buyer_requested_amount?: { value?: string } } } | null)?.offer?.buyer_requested_amount?.value;
  return v ? Math.round(Number(v) * 100) : null;
}

/** Sandbox only: move the dispute to WAITING_FOR_SELLER_RESPONSE so evidence can be attached. */
export async function sandboxRequireEvidence(id: string, incidentId?: string | null) {
  return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/require-evidence`, {
    method: "POST",
    label: "dispute_require_evidence_sandbox",
    incidentId,
    body: { action: "SELLER_EVIDENCE" },
  });
}

/** Sandbox only: settle a dispute. */
export async function sandboxAdjudicate(id: string, outcome: "BUYER_FAVOR" | "SELLER_FAVOR", incidentId?: string | null) {
  return paypalFetch(`/v1/customer/disputes/${encodeURIComponent(id)}/adjudicate`, {
    method: "POST",
    label: "dispute_adjudicate_sandbox",
    incidentId,
    body: { adjudication_outcome: outcome },
  });
}

const REASONS: Record<string, { label: string; aboutProduct: boolean }> = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: { label: "Item not as described", aboutProduct: true },
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: { label: "Item not received", aboutProduct: false },
  UNAUTHORISED: { label: "Unauthorized payment", aboutProduct: false },
  CREDIT_NOT_PROCESSED: { label: "Refund not processed", aboutProduct: false },
  DUPLICATE_TRANSACTION: { label: "Duplicate payment", aboutProduct: false },
  INCORRECT_AMOUNT: { label: "Charged the wrong amount", aboutProduct: false },
  PAYMENT_BY_OTHER_MEANS: { label: "Paid by other means", aboutProduct: false },
  CANCELED_RECURRING_BILLING: { label: "Canceled recurring billing", aboutProduct: false },
  PROBLEM_WITH_REMITTANCE: { label: "Problem with remittance", aboutProduct: false },
  OTHER: { label: "Other", aboutProduct: true },
};

/**
 * The buyer's stated reason, in plain words. aboutProduct is false when the reason has nothing to do
 * with the item itself (for example "not received"), so the owner can double-check before approving.
 */
export function disputeReason(d: unknown): { code: string | null; label: string; aboutProduct: boolean } {
  const code = (d as { reason?: string } | null)?.reason ?? null;
  if (!code) return { code: null, label: "Reason not given by PayPal", aboutProduct: true };
  const known = REASONS[code];
  return { code, label: known?.label ?? code.toLowerCase().replaceAll("_", " "), aboutProduct: known?.aboutProduct ?? true };
}
