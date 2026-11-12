import { formatUsd } from "@/lib/money";

export type CapCheck = { ok: true } | { ok: false; reason: string };

/** Per-order and per-batch refund caps (plan-core 8.7 step 2). Amounts in cents. */
export function checkCaps(
  refundsByOrder: Map<string, number>,
  caps: { perOrderCents: number; perBatchCents: number },
): CapCheck {
  for (const [orderId, cents] of refundsByOrder) {
    if (cents > caps.perOrderCents)
      return {
        ok: false,
        reason: `Order ${orderId.slice(0, 8)} would be refunded ${formatUsd(cents)}, above the per-order cap of ${formatUsd(caps.perOrderCents)}.`,
      };
  }
  const total = [...refundsByOrder.values()].reduce((a, b) => a + b, 0);
  if (total > caps.perBatchCents)
    return {
      ok: false,
      reason: `This batch would refund ${formatUsd(total)}, above the per-batch cap of ${formatUsd(caps.perBatchCents)}.`,
    };
  return { ok: true };
}

/** Never refund more than captured minus already refunded. */
export function overRefund(args: { orderTotalCents: number; orderRefundedCents: number; amountCents: number }): boolean {
  return args.amountCents > args.orderTotalCents - args.orderRefundedCents;
}
