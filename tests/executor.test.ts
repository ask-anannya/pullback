/**
 * Executor against an in-memory database with a mocked PayPal HTTP layer.
 * Checks idempotency (no duplicate refunds on retry), the cap stop, and the dispute path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "pglite:memory://";
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";
process.env.PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
delete process.env.GEMINI_API_KEY;

const { getDb, closeDb, schema } = await import("@/db/client");
const { seed } = await import("@/db/seed");
const { replayFixture, resetDemo } = await import("@/replay/replay");
const { approveIncident, executeIncident } = await import("@/executor/execute");
const { eq, and, inArray } = await import("drizzle-orm");

type Refund = { id: string; captureId: string; cents: number };

class FakePayPal {
  refundsByKey = new Map<string, Refund>();
  created = 0;
  failNextRefund = 0;
  disputes: unknown[] = [];
  acceptClaims: string[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/v1/oauth2/token") return json({ access_token: "tok", expires_in: 32400 });
    let m = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
    if (m && method === "POST") {
      if (this.failNextRefund > 0) {
        this.failNextRefund--;
        throw new TypeError("fetch failed (simulated network error)");
      }
      const key = headers.get("PayPal-Request-Id")!;
      const body = JSON.parse(String(init?.body));
      let r = this.refundsByKey.get(key);
      if (!r) {
        r = { id: `REF-${++this.created}`, captureId: m[1], cents: Math.round(Number(body.amount.value) * 100) };
        this.refundsByKey.set(key, r);
      }
      return json({ id: r.id, status: "COMPLETED", amount: body.amount }, 201);
    }
    m = url.pathname.match(/^\/v2\/payments\/refunds\/([^/]+)$/);
    if (m) return json({ id: m[1], status: "COMPLETED" });
    // Like the real sandbox: the list omits capture ids, seller links and refund details.
    if (url.pathname === "/v1/customer/disputes")
      return json({ items: (this.disputes as Record<string, unknown>[]).map(({ dispute_id, status }) => ({ dispute_id, status })) });
    m = url.pathname.match(/^\/v1\/customer\/disputes\/([^/]+)$/);
    if (m && method === "GET") {
      const d = (this.disputes as { dispute_id: string }[]).find((x) => x.dispute_id === m![1]);
      return d ? json(d) : json({ name: "RESOURCE_NOT_FOUND" }, 404);
    }
    m = url.pathname.match(/^\/v1\/customer\/disputes\/([^/]+)\/accept-claim$/);
    if (m) {
      this.acceptClaims.push(m[1]);
      // Like the sandbox: a full accept refunds at once, a partial accept only sends an offer.
      const d = (this.disputes as Record<string, any>[]).find((x) => x.dispute_id === m![1]);
      const body = JSON.parse(String(init?.body));
      if (d) {
        d.links = [{ rel: "self" }];
        if (body.accept_claim_type === "PARTIAL_REFUND") {
          d.status = "WAITING_FOR_BUYER_RESPONSE";
          d.offer = { ...d.offer, seller_offered_amount: body.refund_amount };
        } else {
          d.status = "UNDER_REVIEW";
          d.refund_details = { transactions: [{ id: "DR-1", gross_amount: body.refund_amount }] };
        }
      }
      return json({ links: [] });
    }
    return json({ name: "NOT_FOUND" }, 404);
  };
}

let pp: FakePayPal;

async function heroIncident() {
  const db = await getDb();
  const r = await replayFixture("01-hero-match.json");
  expect(r.incidentIds).toHaveLength(1);
  const id = r.incidentIds[0];
  // Mark every affected order as a real sandbox payment with a fake capture id.
  const items = await db
    .select({ orderId: schema.orderItems.orderId })
    .from(schema.affectedItems)
    .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
    .where(eq(schema.affectedItems.incidentId, id));
  for (const { orderId } of items) {
    await db.update(schema.orders).set({ isRealSandbox: true, paypalCaptureId: `CAP-${orderId.slice(0, 8)}` }).where(eq(schema.orders.id, orderId));
  }
  return { id, orderIds: items.map((i) => i.orderId) };
}

beforeAll(async () => {
  await getDb();
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

beforeEach(async () => {
  pp = new FakePayPal();
  vi.stubGlobal("fetch", pp.fetch);
  process.env.REFUND_CAP_PER_ORDER_USD = "100";
  process.env.REFUND_CAP_PER_BATCH_USD = "2000";
  await seed({ anchor: new Date("2026-11-11T12:00:00Z") });
}, 60_000);

describe("executor", () => {
  it("refunds each affected item exactly once, even when retried", async () => {
    const { id } = await heroIncident();
    expect((await approveIncident(id)).ok).toBe(true);

    pp.failNextRefund = 1; // first refund call hits a network error
    const first = await executeIncident(id);
    expect(first.status).toBe("failed");
    expect(pp.created).toBe(13);

    const second = await executeIncident(id); // retry reuses the same keys
    expect(second.status).toBe("done");
    expect(pp.created).toBe(14);

    // Force a third run by flipping the status back: PayPal sees the same keys, nothing new.
    const db = await getDb();
    await db.update(schema.incidents).set({ status: "failed" }).where(eq(schema.incidents.id, id));
    await db.update(schema.actions).set({ status: "failed" }).where(eq(schema.actions.incidentId, id));
    await executeIncident(id);
    expect(pp.created).toBe(14);

    const refunded = await db
      .select({ c: schema.orderItems.refundedCents, unit: schema.orderItems.unitPriceCents, q: schema.orderItems.quantity })
      .from(schema.affectedItems)
      .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
      .where(eq(schema.affectedItems.incidentId, id));
    // The forced re-run must not have double-counted: refunded never exceeds the item price.
    for (const r of refunded) expect(r.c).toBeLessThanOrEqual(r.unit * r.q);
    const total = [...pp.refundsByKey.values()].reduce((s, r) => s + r.cents, 0);
    expect(total).toBe(34181);
  }, 60_000);

  it("stops at the batch cap without calling PayPal", async () => {
    process.env.REFUND_CAP_PER_BATCH_USD = "100";
    const { id } = await heroIncident();
    await approveIncident(id);
    const r = await executeIncident(id);
    expect(r.status).toBe("awaiting_owner");
    expect(r.reason).toMatch(/per-batch cap/);
    expect(pp.created).toBe(0);
  }, 60_000);

  it("accepts an open dispute instead of refunding that order", async () => {
    const { id, orderIds } = await heroIncident();
    const db = await getDb();
    const order = (await db.select().from(schema.orders).where(eq(schema.orders.id, orderIds[0])))[0];
    pp.disputes = [
      {
        dispute_id: "PP-D-1",
        status: "WAITING_FOR_SELLER_RESPONSE",
        disputed_transactions: [{ seller_transaction_id: order.paypalCaptureId }],
        links: [{ rel: "self" }, { rel: "accept_claim" }],
      },
    ];
    await approveIncident(id);
    const r = await executeIncident(id);
    expect(r.status).toBe("done");
    expect(pp.acceptClaims).toEqual(["PP-D-1"]);
    expect(pp.created).toBe(13); // one order went through the dispute path, not a second refund
    const acts = await db.select().from(schema.actions).where(and(eq(schema.actions.incidentId, id), inArray(schema.actions.type, ["dispute_accept"])));
    expect(acts).toHaveLength(1);
  }, 60_000);

  it("records a partial accept as a pending offer, never refunds it separately, and credits it once PayPal pays", async () => {
    const { id, orderIds } = await heroIncident();
    const db = await getDb();
    const order = (await db.select().from(schema.orders).where(eq(schema.orders.id, orderIds[0])))[0];
    const dispute: Record<string, any> = {
      dispute_id: "PP-D-3",
      status: "WAITING_FOR_SELLER_RESPONSE",
      disputed_transactions: [{ seller_transaction_id: order.paypalCaptureId }],
      links: [{ rel: "self" }, { rel: "accept_claim" }],
      offer: { buyer_requested_amount: { currency_code: "USD", value: "999.00" } }, // more than the recalled item
    };
    pp.disputes = [dispute];
    await approveIncident(id);
    const r = await executeIncident(id);
    expect(r.status).toBe("done");
    const acts = () => db.select().from(schema.actions).where(and(eq(schema.actions.incidentId, id), eq(schema.actions.type, "dispute_accept")));
    expect((await acts())[0].status).toBe("pending");
    const inc = (await db.select().from(schema.incidents).where(eq(schema.incidents.id, id)))[0];
    expect(inc.statusReason).toMatch(/waiting for the buyer/);

    // Forced re-run while the offer is open: no second accept and no separate refund for that order.
    await db.update(schema.incidents).set({ status: "failed" }).where(eq(schema.incidents.id, id));
    await executeIncident(id);
    expect(pp.acceptClaims).toEqual(["PP-D-3"]);
    expect(pp.created).toBe(13);

    // The buyer accepts; PayPal lists the refund. The next sync credits the pending action.
    dispute.status = "RESOLVED";
    dispute.refund_details = { transactions: [{ id: "DR-9", gross_amount: dispute.offer.seller_offered_amount }] };
    const { syncDisputes } = await import("@/disputes/sync");
    await syncDisputes(inc.storeId);
    expect((await acts())[0].status).toBe("succeeded");
    const credited = await db
      .select({ c: schema.orderItems.refundedCents })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    expect(credited.reduce((s, x) => s + x.c, 0)).toBeGreaterThan(0);
  }, 60_000);

  it("never refunds an order PayPal already refunded through an accepted dispute", async () => {
    const { id, orderIds } = await heroIncident();
    const db = await getDb();
    const order = (await db.select().from(schema.orders).where(eq(schema.orders.id, orderIds[0])))[0];
    // Shape seen in the sandbox after accept-claim: still UNDER_REVIEW, only a self link, refund listed.
    pp.disputes = [
      {
        dispute_id: "PP-D-2",
        status: "UNDER_REVIEW",
        disputed_transactions: [{ seller_transaction_id: order.paypalCaptureId }],
        links: [{ rel: "self" }],
        refund_details: { transactions: [{ id: "R-1", gross_amount: { currency_code: "USD", value: "17.99" } }] },
      },
    ];
    await approveIncident(id);
    expect((await executeIncident(id)).status).toBe("done");
    expect(pp.acceptClaims).toEqual([]);
    expect(pp.created).toBe(13);
    const skipped = await db.select().from(schema.actions).where(and(eq(schema.actions.incidentId, id), eq(schema.actions.status, "skipped")));
    expect(skipped).toHaveLength(1);
    expect(skipped[0].error).toMatch(/Already refunded by PayPal through dispute PP-D-2/);
  }, 60_000);

  it("refunds only the rest of an item when a dispute already refunded part of it", async () => {
    const { id } = await heroIncident();
    const db = await getDb();
    // A two-jar order ($35.98 of recalled items) where the buyer disputed and got $17.99 back.
    const [twoJar] = await db
      .select({ orderId: schema.orderItems.orderId, orderItemId: schema.orderItems.id, cents: schema.affectedItems.refundCents, capture: schema.orders.paypalCaptureId })
      .from(schema.affectedItems)
      .innerJoin(schema.orderItems, eq(schema.affectedItems.orderItemId, schema.orderItems.id))
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .where(and(eq(schema.affectedItems.incidentId, id), eq(schema.affectedItems.refundCents, 3598)));
    expect(twoJar).toBeDefined();
    pp.disputes = [
      {
        dispute_id: "PP-D-4",
        status: "UNDER_REVIEW",
        disputed_transactions: [{ seller_transaction_id: twoJar.capture }],
        links: [{ rel: "self" }],
        refund_details: { transactions: [{ id: "R-4", gross_amount: { currency_code: "USD", value: "17.99" } }] },
      },
    ];
    await approveIncident(id);
    expect((await executeIncident(id)).status).toBe("done");
    // 13 other orders refunded in full, plus one refund for the uncovered half of this item.
    expect(pp.created).toBe(14);
    const forItem = [...pp.refundsByKey.values()].filter((r) => r.captureId === twoJar.capture);
    expect(forItem.map((r) => r.cents)).toEqual([1799]);
    const total = [...pp.refundsByKey.values()].reduce((s, r) => s + r.cents, 0);
    expect(total + 1799).toBe(34181); // PayPal refunds plus the dispute refund cover the recall exactly
  }, 60_000);

  it("skips simulated orders and never calls PayPal for them", async () => {
    const r = await replayFixture("01-hero-match.json");
    const id = r.incidentIds[0];
    await approveIncident(id);
    expect((await executeIncident(id)).status).toBe("done");
    expect(pp.created).toBe(0);
    await resetDemo();
  }, 60_000);
});
