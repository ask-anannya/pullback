/**
 * Sandbox integration test (M6). Runs against the real PayPal sandbox on a separate in-memory
 * database, so it never uses up the demo orders:
 *   1. seed the demo store, pay the recalled-batch hero orders with a sandbox card
 *   2. replay the hero recall, approve, execute
 *   3. assert every refund exists in the sandbox with the right amount
 *   4. run again and assert no new refunds were created
 *   5. force one PayPal error with PayPal-Mock-Response and assert it is handled
 *
 *   npm run it:sandbox
 */
import "dotenv/config";

process.env.DATABASE_URL = "pglite:memory://";

const { eq, and } = await import("drizzle-orm");
const { getDb, closeDb, schema } = await import("../src/db/client");
const { env } = await import("../src/lib/env");
const { seed } = await import("../src/db/seed");
const { attachCardPayments } = await import("../src/paypal/seed-payments");
const { replayFixture } = await import("../src/replay/replay");
const { approveIncident, executeIncident } = await import("../src/executor/execute");
const { getRefund, refundCapture } = await import("../src/paypal/refunds");
const { PayPalError } = await import("../src/paypal/auth");
const { valueToCents } = await import("../src/lib/money");

if (!env.paypalConfigured() || !process.env.PAYPAL_TEST_CARD_NUMBER) {
  console.error("Needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_TEST_CARD_NUMBER in .env");
  process.exit(1);
}

let failed = 0;
function check(cond: boolean, msg: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failed++;
}

const db = await getDb();
await seed();

// Pay only the card orders in the recalled batch (lot FTM-2508B) to keep the run small.
const recalled = await db
  .select({ id: schema.orders.id })
  .from(schema.orders)
  .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
  .innerJoin(schema.batches, eq(schema.orderItems.batchId, schema.batches.id))
  .where(and(eq(schema.batches.lotCode, "FTM-2508B"), eq(schema.orders.paymentMethod, "card")));
console.log(`Paying ${recalled.length} recalled-batch orders in the sandbox...`);
const paid = await attachCardPayments({ orderIds: recalled.map((r) => r.id) });
check(paid.succeeded === recalled.length, `created ${paid.succeeded}/${recalled.length} card payments`);

const r = await replayFixture("01-hero-match.json");
check(r.incidentIds.length === 1, "hero recall opened one incident");
const incidentId = r.incidentIds[0];
check((await approveIncident(incidentId)).ok, "owner approval recorded");
const run1 = await executeIncident(incidentId);
check(run1.status === "done", `execution finished (${run1.status})`);

const refunds = await db
  .select()
  .from(schema.actions)
  .where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.type, "refund"), eq(schema.actions.status, "succeeded")));
check(refunds.length === paid.succeeded, `${refunds.length} refunds succeeded (one per real sandbox order)`);
for (const a of refunds) {
  const pp = await getRefund(a.paypalRef!);
  const want = (a.request as { amountCents: number }).amountCents;
  check(pp.status === "COMPLETED" && pp.amount !== undefined && valueToCents(pp.amount.value) === want, `refund ${pp.id} ${pp.status} ${pp.amount?.value} (expected ${(want / 100).toFixed(2)})`);
}

// Run again: force the incident back to failed and every action back to failed.
const before = new Set(refunds.map((a) => a.paypalRef));
await db.update(schema.incidents).set({ status: "failed" }).where(eq(schema.incidents.id, incidentId));
await db.update(schema.actions).set({ status: "failed" }).where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.type, "refund"), eq(schema.actions.status, "succeeded")));
await executeIncident(incidentId);
const after = await db.select().from(schema.actions).where(and(eq(schema.actions.incidentId, incidentId), eq(schema.actions.type, "refund")));
const afterRefs = after.filter((a) => a.paypalRef).map((a) => a.paypalRef);
check(afterRefs.length === before.size && afterRefs.every((r) => before.has(r)), `second run created no new refunds (${afterRefs.length} refund ids, all from run 1)`);
check(after.filter((a) => a.status === "succeeded").length === before.size, "every real refund confirmed as succeeded again");

// Same PayPal-Request-Id sent directly to PayPal returns the original refund.
const first = refunds[0];
if (first) {
  const again = await refundCapture({
    captureId: (first.request as { captureId: string }).captureId,
    amountCents: (first.request as { amountCents: number }).amountCents,
    currency: "USD",
    idempotencyKey: first.idempotencyKey,
  });
  check(again.id === first.paypalRef, `PayPal returned the original refund for a reused key (${again.id})`);
}

// Negative test: forced PayPal error is surfaced, not swallowed.
try {
  await refundCapture({
    captureId: (refunds[0]?.request as { captureId: string })?.captureId ?? "X",
    amountCents: 100,
    currency: "USD",
    idempotencyKey: `mock-${Date.now()}`,
    mockResponse: JSON.stringify({ mock_application_codes: "CAPTURE_FULLY_REFUNDED" }),
  });
  check(false, "mocked refund error was raised");
} catch (e) {
  check(e instanceof PayPalError, `mocked refund error raised as PayPalError (${(e as Error).message})`);
}

await closeDb();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
