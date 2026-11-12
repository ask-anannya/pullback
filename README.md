# Pullback

**A recall-to-refund agent for PayPal merchants.** Customers should never have to complain about a recalled product. The seller's AI protects them first.

Pullback reads the FDA food recall feed every day and stays silent unless a recall matches something the store actually sold. When one does, it:

1. matches the recall to the store's product on exact identifiers (barcode, brand, name, size, lot, best-by date), using AI only for messy cases, and shows the evidence field by field;
2. narrows the match to the exact affected orders ("14 of 211 orders are affected", not "everyone who bought this");
3. sets the response by severity (urgent recalls get a refund batch ready; minor ones are only logged);
4. sends the owner one brief, and after one click on **Approve**, refunds the affected orders through PayPal, flags the listing and notifies each customer;
5. resolves related PayPal disputes;
6. re-checks past orders when a recall expands to new batches;
7. keeps a plain, append-only audit record of everything.

Nothing is paid out without the owner's approval.

> **Demo data.** The store ("Trailhead Pantry"), its customers and orders are fictional. Payments and refunds are real PayPal **sandbox** transactions. Recalls are real openFDA records, except one expansion fixture that is clearly labeled "simulated for demo".

## How it uses PayPal

PayPal is both the data source and the action layer.

| Step | PayPal API |
|---|---|
| Store orders are real sandbox payments | `POST /v2/checkout/orders` (card payment source, or buyer approval), `POST /v2/checkout/orders/{id}/capture` |
| Refund affected orders | `POST /v2/payments/captures/{id}/refund` with `PayPal-Request-Id` idempotency and a `note_to_payer` recall notice |
| Confirm refunds | `GET /v2/payments/refunds/{id}` |
| Find and resolve disputes | `GET /v1/customer/disputes`, `POST .../accept-claim`, `POST .../provide-evidence` (sandbox: `POST .../require-evidence`) |
| Cross-check | `GET /v1/reporting/transactions` |
| Webhooks | `POST /v1/notifications/verify-webhook-signature`; refund and dispute events |

## How it uses AI (Google Gemini)

| Agent | Model | Job | Guardrail |
|---|---|---|---|
| Recall parser | fast | Extract brands, names, sizes, lots and dates from free text | Regex wins on exact identifiers; AI values must appear in the source text |
| Fuzzy matcher | reasoning | Decide "same product?" only when identifiers give a partial signal | Low confidence goes to the review list, never to a refund |
| Hazard explainer | fast | Plain-language hazard summary | Cannot change the FDA class; severity is rule-based |
| Brief writer | reasoning | The owner's brief | Must reference exactly the orders the narrowing step selected |
| Notice writer | reasoning | Customer recall notice, under 150 words | Placeholders checked; template fallback |

**AI decides, code pays.** The model never calls a payment API. Every PayPal write happens in a deterministic executor after approval, with per-order and per-batch caps, an over-refund guard and idempotency keys. Every AI output is validated with Zod; on failure it retries once, then routes to human review. Without a Gemini key the app still runs: parsing is regex-only and texts use labeled templates.

## Architecture

```
openFDA feed or replay fixture
   -> ingest (content hash detects changes)  -> parse (regex + Gemini)
   -> match each store product (UPC, brand+name+size, lot/best-by; Gemini for partial signals)
   -> narrow to affected order items          -> severity (FDA class + hazard)
   -> incident + brief + drafted notice       -> owner: Preview, Approve / Decline
   -> executor: refunds or accept-claim, dispute evidence, reconcile, flag listing, outbox
   -> audit log (append-only)
recall expands later -> diff new lots/dates -> child incident with only the new orders
```

Next.js 15 (App Router) + TypeScript, Tailwind, Drizzle ORM on Postgres (embedded PGlite locally, Render Postgres in production), Zod, `@google/genai`, Vitest.

## Run it locally

Requirements: Node 20 or newer. Docker is optional.

```bash
npm install
cp .env.example .env          # add PayPal sandbox and Gemini keys (see below)
npm run db:migrate
npm run seed                  # fictional demo store, 211 orders of the hero product
npm run seed:paypal           # real sandbox card payments for the 24 recalled-batch orders
npm run dev                   # http://localhost:3000
```

Open http://localhost:3000. The site has two views, switched with **View as: Shopper | Store owner** in the header: the Trailhead Pantry storefront (`/`) and the Pullback dashboard for the store owner (`/seller`).

With no `DATABASE_URL`, data lives in an embedded database in `./.data/pglite` (one process at a time: stop `npm run dev` before running scripts). To use Postgres instead, set `DATABASE_URL=postgres://...`.

### Keys

- **PayPal sandbox:** developer.paypal.com > Apps & Credentials > Sandbox: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`. A test card from Testing Tools > Card Generator: `PAYPAL_TEST_CARD_NUMBER`. The sandbox Personal account email: `PAYPAL_SANDBOX_BUYER_EMAIL`.
- **Gemini:** aistudio.google.com: `GEMINI_API_KEY`. Model names come from `LLM_MODEL_FAST` and `LLM_MODEL_REASONING`.

### Disputes

There is no API to create a dispute, and a buyer can only dispute payments from their own PayPal wallet. To show the dispute path, buy on the storefront with the sandbox Personal account, then open a dispute on that payment in the sandbox Resolution Center (`sandbox.paypal.com`, or **Report a problem on PayPal** on My orders). When the incident is approved, Pullback accepts the claim for the recalled items instead of refunding the order separately. If the buyer asked for more than the recalled items, PayPal turns the acceptance into a partial-refund offer the buyer must accept; Pullback records it as pending until PayPal pays it out.

## Demo steps

1. **Shopper:** on the storefront, open Fisher Tex Mex Trail Mix (sold from batch FTM-2508B, best by Aug 6, 2027), add it to the cart and check out with PayPal using the sandbox Personal account. **My orders** shows the order, its batch and the PayPal capture id.
2. **Switch to Store owner.** The overview shows the new storefront order under Recent orders and "All clear".
3. **Run a recall check:** replay the near-misses first (two look-alikes are ignored with a reason, the unrelated recall stays silent, the Class III recall is logged only), then replay recall **H-0836-2026**.
4. **Open incident:** evidence table, "15 of 212 orders affected" (the 14 seeded orders plus yours), severity and hazard, refund total, drafted notice. **Preview exactly what will happen**, then **Approve**: refunds land in the PayPal sandbox, notices go out, the product listing is flagged.
5. **Switch to Shopper:** My orders shows "Refunded $17.99 · recall H-0836-2026" and the recall notice under Messages; the product page now says it is under a recall and checkout refuses it. The refund is also visible in the buyer's sandbox PayPal account.
6. Optional: replay the lot expansion for a child incident with only the newly affected orders.

## Tests and checks

```bash
npm test              # unit tests: parsing, matching helpers, narrowing, severity, caps, idempotency, executor with mocked PayPal
npm run eval          # matching eval (18 labeled cases)
npm run probe         # PayPal sandbox capability check, writes docs/paypal-capabilities.md
npm run it:sandbox    # real sandbox refunds, idempotent rerun, forced error (uses its own in-memory database)
```

**Matching eval** (18 labeled cases):

| Mode | Exact label | Matched precision | Matched recall | False-positive matches |
|---|---|---|---|---|
| With Gemini (`gemini-3.5-flash` parser, `gemini-3.1-pro-preview` fuzzy matcher) | 18 of 18 | 100% | 100% | 0 |
| Rules only (no key) | 16 of 18 | 100% | 100% | 0 |

Without a key, the two same-brand cases built for the AI step go to the review list, which never refunds.

## Honest limitations

- PayPal **sandbox only**. The store and customers are simulated; only the hero orders that matter are real sandbox payments, and simulated orders are never sent to the refund API (they are labeled "skipped").
- **One recall source** (openFDA food enforcement), which can lag real announcements by weeks. The demo uses **replay** of stored real records.
- The recall **expansion** in the demo is simulated (labeled).
- Sandbox order dates cannot be backdated, so the 90-day order history lives in the app database.
- Customer notices go to an in-app outbox (demo customers use example.com addresses). PayPal's own refund note also reaches the buyer.
- Disputes require a manual step in the sandbox (above). See `docs/paypal-capabilities.md` for what was verified.

## License

MIT
