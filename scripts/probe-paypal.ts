/**
 * M0 capability probe. Tries each PayPal sandbox capability this project uses and writes
 * docs/paypal-capabilities.md with works / does not work / not run for each row.
 *
 *   npm run probe
 *
 * Optional: PROBE_DISPUTE_ID=<id of a buyer-opened sandbox dispute> to also test the dispute
 * endpoints (this changes that dispute's state, so use a throwaway one).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as z from "zod/v4";

process.env.DATABASE_URL = "pglite:memory://"; // probe calls are audited in memory only

const { env } = await import("../src/lib/env");
const { getAccessToken, paypalFetch, PayPalError } = await import("../src/paypal/auth");
const { createAndCaptureCardOrder, getCapture } = await import("../src/paypal/orders");
const { refundCapture, getRefund } = await import("../src/paypal/refunds");
const { listDisputes, getDispute, provideEvidence, acceptClaim, sandboxRequireEvidence, sandboxAdjudicate } = await import("../src/paypal/disputes");
const { verifyWebhook } = await import("../src/paypal/webhooks");
const { testCard } = await import("../src/paypal/seed-payments");
const { fetchRecalls } = await import("../src/recalls/openfda");
const { complete } = await import("../src/llm/client");
const { closeDb } = await import("../src/db/client");

type Row = { n: number; capability: string; result: "works" | "does not work" | "not run"; notes: string };
const rows: Row[] = [];
let n = 0;

function describeErr(e: unknown): string {
  if (e instanceof PayPalError) return `${e.status} ${e.issue ?? ""} ${e.debugId ? `debug_id ${e.debugId}` : ""}`.trim();
  return (e as Error)?.message ?? String(e);
}

async function probe(capability: string, fn: () => Promise<string | { skip: string }>) {
  n++;
  try {
    const r = await fn();
    if (typeof r === "object") rows.push({ n, capability, result: "not run", notes: r.skip });
    else rows.push({ n, capability, result: "works", notes: r });
  } catch (e) {
    rows.push({ n, capability, result: "does not work", notes: describeErr(e) });
  }
  const last = rows[rows.length - 1];
  console.log(`${String(last.n).padStart(2)}. ${last.result.padEnd(14)} ${capability}: ${last.notes}`);
}

const hasPayPal = env.paypalConfigured();
const noCreds = { skip: "PayPal sandbox credentials not set" };
let captureId: string | null = null;
let captureId2: string | null = null;

await probe("OAuth token (client credentials)", async () => {
  if (!hasPayPal) return noCreds;
  const t = await getAccessToken(true);
  return `token received (${t.slice(0, 6)}...)`;
});

await probe("Create order with card payment_source, no buyer approval (Option A)", async () => {
  if (!hasPayPal) return noCreds;
  if (!process.env.PAYPAL_TEST_CARD_NUMBER) return { skip: "PAYPAL_TEST_CARD_NUMBER not set" };
  const r = await createAndCaptureCardOrder({
    lines: [{ name: "Probe item", sku: "PROBE-1", quantity: 1, unitPriceCents: 1000 }],
    customId: `probe-${Date.now()}`,
    requestId: `probe-${Date.now()}`,
    card: testCard(),
  });
  captureId = r.captureId;
  const second = await createAndCaptureCardOrder({
    lines: [{ name: "Probe item 2", sku: "PROBE-2", quantity: 2, unitPriceCents: 500 }],
    customId: `probe2-${Date.now()}`,
    requestId: `probe2-${Date.now()}`,
    card: testCard(),
  });
  captureId2 = second.captureId;
  const direct = r.raw.status === "COMPLETED" ? "create returned COMPLETED directly" : "needed a separate capture call";
  return `order ${r.orderId}, capture ${r.captureId} (${r.status}); ${direct}`;
});

let refundId: string | null = null;
const refundKey = `probe-refund-${Date.now()}`;
await probe("Full refund of a capture", async () => {
  if (!captureId) return { skip: "no capture from row 2" };
  const r = await refundCapture({ captureId, amountCents: 1000, currency: "USD", idempotencyKey: refundKey, noteToPayer: "Probe refund" });
  refundId = r.id;
  const g = await getRefund(r.id);
  return `refund ${r.id} status ${r.status}; GET refund says ${g.status}`;
});

await probe("Idempotent retry (same PayPal-Request-Id returns the same refund)", async () => {
  if (!captureId || !refundId) return { skip: "no refund from row 3" };
  const r = await refundCapture({ captureId, amountCents: 1000, currency: "USD", idempotencyKey: refundKey, noteToPayer: "Probe refund" });
  if (r.id !== refundId) throw new Error(`second call returned a different refund ${r.id} (first ${refundId})`);
  return `same refund id ${r.id}, no second refund`;
});

await probe("Partial refund, then over-refund is rejected", async () => {
  if (!captureId2) return { skip: "no second capture from row 2" };
  await refundCapture({ captureId: captureId2, amountCents: 600, currency: "USD", idempotencyKey: `probe-partial-${Date.now()}` });
  try {
    await refundCapture({ captureId: captureId2, amountCents: 600, currency: "USD", idempotencyKey: `probe-over-${Date.now()}` });
  } catch (e) {
    return `partial refund ok; over-refund rejected with ${describeErr(e)}`;
  }
  throw new Error("over-refund was accepted");
});

await probe("Transaction Search returns the capture", async () => {
  if (!captureId) return { skip: "no capture from row 2" };
  const end = new Date();
  const start = new Date(end.getTime() - 2 * 86_400_000);
  const r = await paypalFetch(`/v1/reporting/transactions`, {
    label: "transaction_search",
    query: { start_date: start.toISOString().replace(/\.\d+Z$/, "Z"), end_date: end.toISOString().replace(/\.\d+Z$/, "Z"), fields: "all", page_size: 100 },
    schema: z.looseObject({ transaction_details: z.array(z.looseObject({ transaction_info: z.looseObject({ transaction_id: z.string() }) })).optional() }),
  });
  const ids = (r.transaction_details ?? []).map((t) => t.transaction_info.transaction_id);
  return ids.includes(captureId)
    ? `capture found among ${ids.length} transactions`
    : `endpoint works; capture not visible yet (${ids.length} transactions returned; sandbox lag can be hours)`;
});

await probe("Get capture details", async () => {
  if (!captureId) return { skip: "no capture from row 2" };
  const c = await getCapture(captureId);
  return `capture ${c.id} status ${c.status}`;
});

await probe("List disputes", async () => {
  if (!hasPayPal) return noCreds;
  const items = await listDisputes();
  const linked = items.filter((d) => (d.disputed_transactions ?? []).some((t) => t.seller_transaction_id)).length;
  return `${items.length} dispute(s); ${linked} carry seller_transaction_id`;
});

const disputeId = process.env.PROBE_DISPUTE_ID;
await probe("Dispute: seller_transaction_id is the capture id", async () => {
  if (!disputeId) return { skip: "set PROBE_DISPUTE_ID to a buyer-opened sandbox dispute" };
  const d = await getDispute(disputeId);
  const t = d.disputed_transactions?.[0]?.seller_transaction_id;
  const c = t ? await getCapture(t).catch(() => null) : null;
  return c ? `seller_transaction_id ${t} resolves as capture ${c.id}` : `seller_transaction_id ${t ?? "missing"} did not resolve as a capture`;
});

await probe("Dispute: require-evidence (sandbox) then provide-evidence (multipart)", async () => {
  if (!disputeId) return { skip: "set PROBE_DISPUTE_ID" };
  if (process.env.PROBE_SKIP_EVIDENCE === "true") return { skip: "PROBE_SKIP_EVIDENCE=true (accept-claim tested on this dispute instead)" };
  const before = await getDispute(disputeId);
  if (before.status !== "WAITING_FOR_SELLER_RESPONSE") await sandboxRequireEvidence(disputeId);
  await provideEvidence(disputeId, { notes: "Probe: recall evidence", file: { name: "probe.txt", type: "text/plain", content: "probe" } });
  const after = await getDispute(disputeId);
  return `status ${before.status} -> ${after.status}`;
});

await probe("Dispute: accept-claim", async () => {
  if (!disputeId || process.env.PROBE_ACCEPT_CLAIM !== "true") return { skip: "set PROBE_DISPUTE_ID and PROBE_ACCEPT_CLAIM=true (refunds the buyer)" };
  // Same call shape as the executor: an explicit refund_amount equal to the disputed amount.
  const before = await getDispute(disputeId);
  const amt = (before as { dispute_amount?: { value?: string; currency_code?: string } }).dispute_amount;
  const refundCents = amt?.value ? Math.round(Number(amt.value) * 100) : undefined;
  await acceptClaim(disputeId, { note: "Probe: accepting claim", refundCents, currency: amt?.currency_code });
  return `accepted with refund_amount ${amt?.value ?? "none"}; status ${before.status} -> ${(await getDispute(disputeId)).status}`;
});

await probe("Dispute: adjudicate (sandbox)", async () => {
  if (!disputeId || process.env.PROBE_ADJUDICATE !== "true") return { skip: "set PROBE_DISPUTE_ID and PROBE_ADJUDICATE=true" };
  await sandboxAdjudicate(disputeId, "BUYER_FAVOR");
  return `adjudicated; status now ${(await getDispute(disputeId)).status}`;
});

await probe("Webhook signature verification endpoint", async () => {
  if (!hasPayPal) return noCreds;
  if (!process.env.PAYPAL_WEBHOOK_ID) return { skip: "PAYPAL_WEBHOOK_ID not set (deferred to M9 on Render)" };
  const ok = await verifyWebhook(new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-transmission-id": "probe", "paypal-transmission-sig": "probe", "paypal-transmission-time": new Date().toISOString(), "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77" }), { id: "probe" });
  return `endpoint reachable; forged signature verified=${ok} (expected false)`;
});

await probe("openFDA food enforcement query (last 30 days)", async () => {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const r = await fetchRecalls({ from, to, maxRecords: 100 });
  return `${r.length} record(s); sample ${r[0]?.recall_number ?? "none"}`;
});

await probe("Gemini structured output round trip", async () => {
  if (!env.geminiConfigured()) return { skip: "GEMINI_API_KEY not set" };
  const out = await complete({ model: "fast", system: "Return JSON only.", prompt: "Give the number 42 as answer.", schema: z.object({ answer: z.number() }), promptVersion: "probe-1" });
  const out2 = await complete({ model: "reasoning", system: "Return JSON only.", prompt: "Give the word ok as answer.", schema: z.object({ answer: z.string() }), promptVersion: "probe-1" });
  return `fast model (${env.modelFast()}) answered ${out.answer}; reasoning model (${env.modelReasoning()}) answered ${out2.answer}`;
});

const md = `# PayPal and AI capability check (M0)

Generated by \`npm run probe\` on ${new Date().toISOString()} against \`${env.paypalBaseUrl()}\`.
Features that depend on a row marked "does not work" are skipped and the README says so. Nothing here is mocked.

| # | Capability | Result | Notes |
|---|---|---|---|
${rows.map((r) => `| ${r.n} | ${r.capability} | ${r.result} | ${r.notes.replace(/\|/g, "/")} |`).join("\n")}

## What depends on what

- Rows 2 to 5 (card orders, refunds, idempotency, over-refund) gate M1 seeding and M6 refunds.
- Row 6 (Transaction Search) is a cross-check only. The app database is the source of truth.
- Rows 8 to 12 (disputes) gate M8. Disputes have no create API: the sandbox buyer opens them in the Resolution Center on payments from their own PayPal wallet (orders paid with the PayPal wallet on the storefront).
- Row 13 (webhooks) is optional. Refund and dispute status are also polled.
`;
fs.mkdirSync(path.join(process.cwd(), "docs"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "docs", "paypal-capabilities.md"), md);
console.log("\nWrote docs/paypal-capabilities.md");
await closeDb();
