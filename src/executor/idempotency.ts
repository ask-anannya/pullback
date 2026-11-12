import { createHash } from "node:crypto";

export type ActionType = "refund" | "notice" | "listing_flag" | "dispute_evidence" | "dispute_accept";

/**
 * Deterministic idempotency key: sha256(incident + target + type), hex (64 chars).
 * Sent as PayPal-Request-Id, so a retry can never create a second refund.
 */
export function idempotencyKey(incidentId: string, targetId: string, type: ActionType): string {
  return createHash("sha256").update(`${incidentId}:${targetId}:${type}`).digest("hex");
}
