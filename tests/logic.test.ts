import { describe, expect, it } from "vitest";
import { brandEquals, brandInText, nameContainment, nameTokens, parseSize, sizesEqual } from "@/matching/normalize";
import { narrow, type NarrowItem } from "@/narrowing/narrow";
import { severityFor } from "@/severity/severity";
import { checkCaps, overRefund } from "@/executor/caps";
import { idempotencyKey } from "@/executor/idempotency";
import { centsToValue, valueToCents } from "@/lib/money";

describe("normalization", () => {
  it("converts units: 12 oz is about 340 g", () => {
    expect(sizesEqual(parseSize("12oz")!, parseSize("340g")!)).toBe(true);
    expect(sizesEqual(parseSize("30 oz")!, parseSize("23 oz")!)).toBe(false);
    expect(parseSize("1 lb")).toBeCloseTo(453.592);
  });

  it("ignores case, punctuation and word order in names", () => {
    expect(nameTokens("Trail Mix Organic 340g").sort()).toEqual(nameTokens("Organic Trail-Mix, 12 oz").sort());
    expect(nameContainment("Organic Trail Mix", "TRAIL MIX ORGANIC 340G BAG")).toBe(1);
  });

  it("removes brand words before comparing names", () => {
    expect(nameContainment("Squirrel Brand Classic Mixed Nuts", "Squirrel Brand Travelers Mix 16 oz can", "Squirrel Brand")).toBeLessThan(0.4);
  });

  it("finds brands as whole words", () => {
    expect(brandInText("Good & Gather", "Good and Gather Mexican Street Corn Trail Mix")).toBe(true);
    expect(brandInText("Fisher", "Fishers Island Oysters")).toBe(false);
  });

  it("compares brands exactly, ignoring corporate suffixes", () => {
    expect(brandEquals("Copper Kettle Co.", "Copper Kettle")).toBe(true);
    expect(brandEquals("Kettle", "Copper Kettle Co.")).toBe(false);
    expect(brandEquals("Squirrel Brand", "Squirrel")).toBe(true);
  });
});

const item = (id: string, lot: string | null, bestBy: string | null, extra: Partial<NarrowItem> = {}): NarrowItem => ({
  orderItemId: id,
  orderId: `o-${id}`,
  quantity: 1,
  unitPriceCents: 1000,
  refundedCents: 0,
  batch: lot ? { lotCode: lot, bestBy } : null,
  ...extra,
});

describe("narrowing", () => {
  const items = [item("1", "A1", "2027-01-01"), item("2", "B2", "2027-08-06"), item("3", "C3", "2027-09-01"), item("4", null, null)];

  it("selects by lot", () => {
    const r = narrow({ lots: ["a-1"], dateRanges: [] }, "high", items);
    expect(r.affected.map((a) => [a.orderItemId, a.rule])).toEqual([["1", "lot"]]);
  });

  it("selects by best-by range and reports affected of checked", () => {
    const r = narrow({ lots: [], dateRanges: [{ from: "2027-08-06", to: "2027-08-06" }] }, "high", items);
    expect(r.affected.map((a) => a.orderItemId)).toEqual(["2"]);
    expect(r.checkedOrderCount).toBe(4);
    expect(r.affectedOrderCount).toBe(1);
  });

  it("sends items with no batch to review", () => {
    const r = narrow({ lots: ["A1"], dateRanges: [] }, "high", items);
    expect(r.needsReview.map((x) => x.orderItemId)).toEqual(["4"]);
  });

  it("affects the whole product when the recall has no codes and the match is high", () => {
    const r = narrow({ lots: [], dateRanges: [] }, "high", items);
    expect(r.affected).toHaveLength(4);
    expect(r.wholeProduct).toBe(true);
  });

  it("sends everything to review when there are no codes and the match is not high", () => {
    const r = narrow({ lots: [], dateRanges: [] }, "medium", items);
    expect(r.affected).toHaveLength(0);
    expect(r.needsReview).toHaveLength(4);
  });

  it("skips handled items and fully refunded items", () => {
    const r = narrow({ lots: [], dateRanges: [{ from: null, to: "2030-01-01" }] }, "high", [
      item("1", "A", "2027-01-01"),
      item("2", "B", "2027-01-01", { refundedCents: 1000 }),
      item("3", "C", "2027-01-01"),
    ], new Set(["3"]));
    expect(r.affected.map((a) => a.orderItemId)).toEqual(["1"]);
  });

  it("refunds only the unrefunded remainder", () => {
    const r = narrow({ lots: ["A"], dateRanges: [] }, "high", [item("1", "A", null, { quantity: 2, refundedCents: 500 })]);
    expect(r.totalRefundCents).toBe(1500);
  });
});

describe("severity", () => {
  it("follows the plan table", () => {
    expect(severityFor("Class I", "other")).toBe("urgent");
    expect(severityFor("Class II", "allergen")).toBe("urgent");
    expect(severityFor("Class II", "pathogen")).toBe("urgent");
    expect(severityFor("Class II", "other")).toBe("standard");
    expect(severityFor("Class III", "pathogen")).toBe("low");
  });
});

describe("caps and guards", () => {
  const caps = { perOrderCents: 10_000, perBatchCents: 20_000 };
  it("passes within caps", () => {
    expect(checkCaps(new Map([["a", 5000], ["b", 5000]]), caps).ok).toBe(true);
  });
  it("stops an oversized order", () => {
    expect(checkCaps(new Map([["a", 10_001]]), caps).ok).toBe(false);
  });
  it("stops an oversized batch", () => {
    const r = checkCaps(new Map([["a", 9000], ["b", 9000], ["c", 9000]]), caps);
    expect(r.ok).toBe(false);
  });
  it("blocks over-refunds", () => {
    expect(overRefund({ orderTotalCents: 3598, orderRefundedCents: 1799, amountCents: 1799 })).toBe(false);
    expect(overRefund({ orderTotalCents: 3598, orderRefundedCents: 1799, amountCents: 1800 })).toBe(true);
  });
});

describe("idempotency and money", () => {
  it("is deterministic per incident, target and type", () => {
    expect(idempotencyKey("i", "x", "refund")).toBe(idempotencyKey("i", "x", "refund"));
    expect(idempotencyKey("i", "x", "refund")).not.toBe(idempotencyKey("i", "x", "notice"));
    expect(idempotencyKey("i", "x", "refund")).toHaveLength(64);
  });
  it("converts cents and PayPal amount strings", () => {
    expect(centsToValue(34181)).toBe("341.81");
    expect(centsToValue(5)).toBe("0.05");
    expect(valueToCents("17.99")).toBe(1799);
    expect(valueToCents("3.5")).toBe(350);
  });
});
