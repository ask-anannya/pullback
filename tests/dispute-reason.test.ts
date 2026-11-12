import { describe, expect, it } from "vitest";
import { disputeReason } from "@/paypal/disputes";

describe("disputeReason", () => {
  it("maps product reasons", () => {
    expect(disputeReason({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" })).toEqual({ code: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", label: "Item not as described", aboutProduct: true });
  });
  it("flags reasons that are not about the product", () => {
    expect(disputeReason({ reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" })).toMatchObject({ label: "Item not received", aboutProduct: false });
    expect(disputeReason({ reason: "UNAUTHORISED" }).aboutProduct).toBe(false);
  });
  it("handles missing and unknown reasons", () => {
    expect(disputeReason({})).toMatchObject({ code: null, aboutProduct: true });
    expect(disputeReason({ reason: "SOME_NEW_REASON" })).toMatchObject({ label: "some new reason", aboutProduct: true });
  });
});
