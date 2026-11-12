import type { DateRange } from "@/db/schema";
import { inRange } from "@/matching/identifiers";
import { normalizeLot } from "@/matching/normalize";

export type NarrowItem = {
  orderItemId: string;
  orderId: string;
  quantity: number;
  unitPriceCents: number;
  refundedCents: number;
  batch: { lotCode: string; bestBy: string | null } | null;
};

export type Affected = { orderItemId: string; orderId: string; rule: "lot" | "best_by" | "whole_product"; refundCents: number };
export type ReviewItem = { orderItemId: string; orderId: string; reason: string };

export type NarrowResult = {
  affected: Affected[];
  needsReview: ReviewItem[];
  checkedOrderCount: number;
  affectedOrderCount: number;
  totalRefundCents: number;
  wholeProduct: boolean;
};

/**
 * Plan-core 8.4. An item is affected if its batch lot is in the recall lots, or its best-by date
 * is in a recall date range. With no lot or date info and a high-confidence match, all items are
 * affected. Items with no batch go to review. `skip` excludes items already handled (expansions).
 */
export function narrow(
  parsed: { lots: string[]; dateRanges: DateRange[] },
  confidence: "high" | "medium" | "low",
  items: NarrowItem[],
  skip: Set<string> = new Set(),
): NarrowResult {
  const lots = new Set(parsed.lots.map(normalizeLot));
  const hasCodes = lots.size > 0 || parsed.dateRanges.length > 0;
  const affected: Affected[] = [];
  const needsReview: ReviewItem[] = [];

  for (const it of items) {
    if (skip.has(it.orderItemId)) continue;
    const refundCents = it.quantity * it.unitPriceCents - it.refundedCents;
    if (refundCents <= 0) continue;
    if (!hasCodes) {
      if (confidence === "high") affected.push({ orderItemId: it.orderItemId, orderId: it.orderId, rule: "whole_product", refundCents });
      else needsReview.push({ orderItemId: it.orderItemId, orderId: it.orderId, reason: "Recall lists no lots or dates and the match is not high confidence." });
      continue;
    }
    if (!it.batch) {
      needsReview.push({ orderItemId: it.orderItemId, orderId: it.orderId, reason: "No batch recorded for this order item." });
      continue;
    }
    if (lots.has(normalizeLot(it.batch.lotCode))) {
      affected.push({ orderItemId: it.orderItemId, orderId: it.orderId, rule: "lot", refundCents });
    } else if (it.batch.bestBy && parsed.dateRanges.some((r) => inRange(it.batch!.bestBy!, r))) {
      affected.push({ orderItemId: it.orderItemId, orderId: it.orderId, rule: "best_by", refundCents });
    }
  }

  return {
    affected,
    needsReview,
    checkedOrderCount: new Set(items.map((i) => i.orderId)).size,
    affectedOrderCount: new Set(affected.map((a) => a.orderId)).size,
    totalRefundCents: affected.reduce((s, a) => s + a.refundCents, 0),
    wholeProduct: !hasCodes && confidence === "high",
  };
}
