<div align="center">

  <h1>🛡️ Pullback</h1>
  <h3>A recall-to-refund agent for PayPal merchants: matched evidence, exact affected orders, and one human click before any money moves</h3>

![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat&logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat&logo=typescript&logoColor=white)
![PayPal](https://img.shields.io/badge/PayPal-Sandbox-003087?style=flat&logo=paypal&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-3.1%20Pro%20%2B%203.5%20Flash-8E75F5?style=flat)
![Postgres](https://img.shields.io/badge/Postgres-Drizzle-4169E1?style=flat&logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-45%20passing-brightgreen?style=flat)
![Eval](https://img.shields.io/badge/eval-18%2F18%20correct-brightgreen?style=flat)
![License](https://img.shields.io/badge/license-MIT-green?style=flat)

**Live demo:** [pullback-tan.vercel.app](https://pullback-tan.vercel.app)

</div>

---

> 📐 **See [ARCHITECTURE.md](ARCHITECTURE.md)** for Mermaid diagrams of the system overview, the recall pipeline, the approve and execute sequence, the per-order dispute decision, the incident and action state machines, storefront checkout, the package photo check, and the data model.

## The Problem

When the FDA recalls a food product, a small online store usually finds out late, if at all. Then the owner has to work out by hand which orders contained the recalled batch, refund those customers one by one, write to each of them, and pull the listing. Most stores either over-refund ("everyone who ever bought this"), under-react (nobody is told), or wait until customers complain and open PayPal disputes. Every one of those outcomes costs money and trust.

## Solution

Pullback reads the FDA food recall feed every day and stays silent unless a recall matches something the store actually sold. When one does, it matches the recall to the store's product on exact identifiers (barcode, brand, name, size, lot, best-by date), narrows it to the exact affected order items ("15 of 212 orders", not "everyone who bought this"), and writes the owner a single brief with the evidence laid out field by field. After one click on **Approve**, it refunds the affected items through PayPal, settles any open PayPal disputes on those orders instead of refunding twice, flags the listing, and sends each customer a plain-language notice. Nothing is paid out without the owner's approval, and that gate is enforced in code, not by asking the model nicely.

The live demo is one website with two views, switched with **View as: Shopper | Store owner**: the Trailhead Pantry storefront, where you buy a real product with PayPal (sandbox), and the Pullback dashboard for the store owner.

> **Demo data.** The store ("Trailhead Pantry"), its customers and orders are fictional. Payments and refunds are real PayPal **sandbox** transactions. Recalls are real openFDA records, except one expansion fixture that is clearly labeled "simulated for demo". Product photos are AI-generated; real third-party brands are shown in plain, unbranded packaging.

## Key Concepts

### The Seven Safety Rails

1. **Human approval gate**: incidents wait in `awaiting_owner`; PayPal writes only start from the approve endpoint ([`app/api/incidents/[id]/approve/route.ts`](app/api/incidents/[id]/approve/route.ts), [`src/executor/execute.ts`](src/executor/execute.ts))
2. **Field-by-field evidence**: every match shows barcode, brand, name, size and lot or best-by side by side with a match, partial, mismatch or missing result ([`src/matching/identifiers.ts`](src/matching/identifiers.ts))
3. **Exact narrowing**: only order items from the recalled lots or best-by dates are affected; other batches of the same product are untouched ([`src/narrowing/narrow.ts`](src/narrowing/narrow.ts))
4. **Idempotent payouts**: every refund and dispute action has a deterministic key sent as `PayPal-Request-Id`, so a retry never pays twice ([`src/executor/idempotency.ts`](src/executor/idempotency.ts))
5. **Over-refund guard and caps**: never refund more than captured minus already refunded (including money PayPal paid out through a dispute), plus per-order and per-batch caps ([`src/executor/caps.ts`](src/executor/caps.ts))
6. **One path per order**: an order is either refunded, settled through its open dispute, given recall evidence, or skipped with a reason; never two at once ([`src/executor/execute.ts`](src/executor/execute.ts), [`src/disputes/sync.ts`](src/disputes/sync.ts))
7. **Append-only audit log**: every PayPal call, AI call, approval and reset is recorded and shown on the Activity page ([`src/audit/log.ts`](src/audit/log.ts))

### How the LLM Is (and Isn't) Used

**Matching, narrowing, severity and every payment: deterministic code.** Identifier matching, lot and date overlap, the affected-order count, the severity tier (from the FDA class and hazard) and all PayPal writes are plain TypeScript. The model never calls a payment API. *AI decides nothing that moves money; code pays.*

**Google Gemini** (`gemini-3.1-pro-preview` for reasoning, `gemini-3.5-flash` for fast tasks), via `@google/genai`, behind one wrapper ([`src/llm/client.ts`](src/llm/client.ts)) that validates every response with Zod, retries once, and otherwise throws so the caller falls back:

| Agent | Model | Job | Guardrail |
|---|---|---|---|
| Recall parser | fast | Extract brands, names, sizes, lots and dates from free text | Regex wins on exact identifiers; AI values must appear in the source text |
| Fuzzy matcher | reasoning | Decide "same product?" only when identifiers give a partial signal | Low confidence goes to the review list, never to a refund |
| Hazard explainer | fast | Plain-language hazard summary | Cannot change the FDA class; severity is rule-based |
| Brief writer | reasoning | The owner's incident brief | Must reference exactly the orders the narrowing step selected |
| Notice writer | reasoning | Customer recall notice, under 150 words | Placeholders checked; template fallback |
| Label reader | fast (vision) | Read brand, barcode, lot and best-by from a package photo | Only reads; the verdict comes from the same deterministic matcher |

Without a Gemini key the app still runs: parsing is regex-only, the photo check is unavailable, and texts use labeled templates.

---

## Technical Architecture

### Frontend

- Next.js 15 App Router with two route groups and a shared **View as: Shopper | Store owner** switch ([`app/_components/profile-switch.tsx`](app/_components/profile-switch.tsx))
- **Storefront** `app/(shop)/`: home, shop with category filter, product page (shows the batch on the shelf and its best-by date), cart, checkout with PayPal Buttons, and **My orders** with refund status, recall messages and a link to the PayPal Resolution Center
- **Seller dashboard** `app/seller/`: Overview (recall check buttons, package photo check, recent orders, incidents), incident page (evidence, affected orders, preview, Approve or Decline, live progress), Needs review, Activity (audit log), Outbox (customer notices), Replay
- Tailwind v4 design tokens; a warm snack-shop theme for the storefront and a quiet dashboard theme for the owner

### Backend

- Next.js route handlers and server actions; long PayPal work runs after the response with `after()` so the incident page can poll live progress
- Drizzle ORM on Postgres: Neon in production, embedded PGlite locally, with migrations applied on first connection ([`src/db/client.ts`](src/db/client.ts))
- PayPal REST: Orders v2, Payments v2 (captures, refunds), Disputes v1, webhook signature verification ([`src/paypal/`](src/paypal/))
- openFDA food enforcement API for recalls ([`src/recalls/openfda.ts`](src/recalls/openfda.ts)), with a content hash so a changed recall is detected and re-processed ([`src/recalls/fingerprint.ts`](src/recalls/fingerprint.ts))

### How it uses PayPal

PayPal is both the data source and the action layer.

| Step | PayPal API |
|---|---|
| Storefront checkout | `POST /v2/checkout/orders`, PayPal Buttons approval, `POST /v2/checkout/orders/{id}/capture`; the order is recorded from PayPal's own item data |
| Seeded hero orders are real sandbox payments | `POST /v2/checkout/orders` with a card payment source |
| Refund affected items | `POST /v2/payments/captures/{id}/refund` with `PayPal-Request-Id` idempotency and a `note_to_payer` recall notice |
| Confirm refunds | `GET /v2/payments/refunds/{id}`, `GET /v2/payments/captures/{id}` |
| Find and settle disputes | `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}`, `POST .../accept-claim` (full or partial), `POST .../provide-evidence` |
| Webhooks | `POST /v1/notifications/verify-webhook-signature`; refund and dispute events |

---

## Installation

### Prerequisites

- Node.js 20 or newer
- A PayPal Developer account with a **US business sandbox app** (card processing enabled) and a sandbox Personal (buyer) account
- A Google Gemini API key ([aistudio.google.com](https://aistudio.google.com/apikey)): optional, the app falls back to regex parsing and templates without it
- Postgres is optional locally: with no `DATABASE_URL`, an embedded PGlite database is created in `./.data/pglite`

### Setup Instructions

**1. Install dependencies**

```bash
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
# Fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_TEST_CARD_*, PAYPAL_SANDBOX_BUYER_EMAIL, GEMINI_API_KEY
```

**Configuration sources:**

- **PayPal sandbox**: developer.paypal.com > Apps & Credentials > Sandbox for the client id and secret; Testing Tools > Card Generator for `PAYPAL_TEST_CARD_NUMBER`, `PAYPAL_TEST_CARD_EXPIRY` and `PAYPAL_TEST_CARD_CVV`; the sandbox Personal account email for `PAYPAL_SANDBOX_BUYER_EMAIL`
- **Gemini**: `GEMINI_API_KEY`; model names come from `LLM_MODEL_FAST` and `LLM_MODEL_REASONING`
- **Caps**: `REFUND_CAP_PER_ORDER_USD` and `REFUND_CAP_PER_BATCH_USD`

**3. Build the demo store**

```bash
npm run db:migrate
npm run seed          # fictional store: 30 products, 120 customers, 511 orders (211 of the hero product)
npm run seed:paypal   # real sandbox card payments for the 24 recalled-batch orders
```

**4. Start the app**

```bash
npm run dev           # http://localhost:3000
```

The storefront is at `/` and the store owner dashboard at `/seller`.

> **Important:** PGlite allows one process at a time. Stop `npm run dev` before running `seed` or other scripts against the local database. On Windows, stopping the dev server can leave child Node processes behind that lock the database; end them before restarting.

---

## System Architecture

```
openFDA feed (daily) or replay fixture
    │
    ▼
ingest + content hash            change detection            ── src/recalls/, src/pipeline/process-recall.ts
    │
    ▼
parse                            regex first, Gemini fills in ── src/recalls/parse.ts
    │
    ▼
match each store product         UPC > brand+name+size > lot/best-by, Gemini only for partial signals
    │                                                         ── src/matching/identifiers.ts, fuzzy.ts
    ▼
narrow to affected order items   deterministic                ── src/narrowing/narrow.ts
    │
    ▼
severity (FDA class + hazard)    rule-based                   ── src/severity/severity.ts
    │
    ├─► incident brief + customer notice    Gemini, validated ── src/agents/
    ▼
owner: Preview → Approve / Decline          structural gate  ── app/api/incidents/[id]/approve
    │ (only if APPROVED)
    ▼
executor: refund, accept-claim or evidence per order, flag listing, notices
    │                                                         ── src/executor/execute.ts
    ▼
append-only audit log                                         ── src/audit/log.ts
```

```
┌────────────────────────────────────────────────────────────────────┐
│                     Next.js app (one website)                      │
│   ┌──────────────────────────┐       ┌───────────────────────────┐ │
│   │ Storefront  app/(shop)   │ ◄───► │ Seller dashboard          │ │
│   │ shop, product, cart,     │ View  │ app/seller: overview,     │ │
│   │ checkout, My orders      │  as   │ incidents, review, audit  │ │
│   └──────────────────────────┘       └───────────────────────────┘ │
│        │ /api/shop/checkout/*               │ /api/replay, /api/incidents/*, /api/label-check
│        ▼                                    ▼                      │
│   src/paypal/orders.ts           src/pipeline + src/executor       │
└────────────────────────────────────────────────────────────────────┘
          │                         │                    │
          ▼                         ▼                    ▼
   PayPal REST (sandbox)      Google Gemini         openFDA API
          │
          ▼
   Postgres (Neon) / PGlite via Drizzle
```

## User Flow (Testing the Full Flow)

**Unit tests and eval** (no external services needed):

```bash
npm test              # 45 tests: parsing, matching, narrowing, severity, caps, idempotency, executor with a sandbox-faithful fake PayPal
npm run eval          # matching eval, 18 labeled cases
```

**Live, end to end** (on [pullback-tan.vercel.app](https://pullback-tan.vercel.app) or locally):

1. **Shopper buys.** Open **Tex Mex Trail Mix** (sold from batch FTM-2508B, best by Aug 6, 2027), add it to the cart, and check out with PayPal using the sandbox Personal account. **My orders** shows the order, its batch and the PayPal capture id.
2. **Switch to Store owner.** The new order appears under Recent orders with a "storefront" tag, and the overview says "All clear".
3. **Run a recall check.** Replay the near-misses first: two look-alikes are ignored with a reason, the unrelated recall stays silent, and the Class III recall is logged only. Then run the hero recall **H-0836-2026** (the first button in the card).
4. **Open the incident.** You will see:
   - the evidence table;
   - "15 of 212 orders affected" (the 14 seeded orders plus yours);
   - the severity and plain-language hazard;
   - the refund total and the drafted customer notice.

   Click **Preview exactly what will happen** to see each order's path, and the buyer's PayPal dispute reason where one exists. Then click **Approve**: refunds land in the PayPal sandbox, notices go out, and the listing is flagged.
5. **Switch to Shopper.** My orders shows "Refunded $17.99 · recall H-0836-2026" and the recall notice under Messages. The product page says the product is under a recall, and checkout refuses it.

| Scenario | How to trigger | Expected result |
|---|---|---|
| Full refund | Buy only the trail mix | Order refunded $17.99, notice sent |
| Partial refund | Buy the trail mix plus another product | Only the trail mix line is refunded; capture shows partially refunded |
| Dispute instead of refund | Pay with the PayPal wallet, open a dispute in the sandbox Resolution Center, then approve | Pullback accepts the claim for the recalled items instead of refunding separately |
| Dispute for more than the recall | Dispute the whole order, then approve | Pullback offers a partial refund for the recalled items only; it shows as pending until the buyer accepts in PayPal |
| Near-miss | Replay near-miss fixtures | Same brand or product, different lot or product: ignored with a reason, no incident |
| Lot expansion | Replay the simulated expansion | Child incident with only the newly affected orders |
| Package photo | Upload a jar photo on the overview | Reads lot and best-by; says recalled or safe for that exact package |

**Reset between takes:** **Reset demo** on the overview clears incidents, notices and replayed recalls. **Clear all my orders** on My orders removes the shopper's storefront orders. Sandbox refunds are never reversed.

---

## Project Structure

```
pullback/
├── app/
│   ├── (shop)/                 # Storefront: home, shop, product, cart, checkout, orders
│   ├── seller/                 # Owner dashboard: overview, incidents, review, activity, outbox, replay
│   ├── api/
│   │   ├── shop/checkout/      # create + capture (prices from the DB, items from PayPal)
│   │   ├── incidents/[id]/     # approve, decline, retry, status
│   │   ├── replay/             # replay fixtures, reset demo
│   │   ├── label-check/        # package photo check
│   │   ├── ingest/             # daily openFDA ingest (CRON_SECRET)
│   │   └── paypal/webhook/     # verified PayPal webhooks
│   └── _components/            # profile switch, pills, formatting
├── src/
│   ├── recalls/                # openFDA client, regex + AI parser, fingerprint, fixtures
│   ├── matching/               # identifier matcher, fuzzy AI step, label check, normalizers
│   ├── narrowing/              # affected order items by lot or best-by
│   ├── severity/               # FDA class + hazard → urgent / standard / low
│   ├── pipeline/               # process-recall: ingest → match → narrow → incident
│   ├── executor/               # plan, approve, execute; caps; idempotency keys
│   ├── disputes/               # dispute sync and crediting
│   ├── paypal/                 # auth, orders, refunds, disputes, webhooks
│   ├── agents/                 # Gemini agents and versioned prompts
│   ├── llm/                    # the only Gemini client: Zod validation, retry, audit
│   ├── shop/                   # shopper, display helpers, order removal
│   ├── db/                     # Drizzle schema, client, seed
│   └── audit/                  # append-only audit log
├── fixtures/recalls/           # real openFDA records for replay (+ one labeled simulated expansion)
├── evals/                      # 18 labeled matching cases + runner
├── scripts/                    # seed:paypal, probe, sandbox integration test, product images
├── public/products/            # AI-generated product photos
├── drizzle/                    # SQL migrations
├── docs/                       # PayPal capability check, decisions, optional GitHub Action
└── tests/                      # Vitest unit tests
```

---

## Eval Results

**18/18 exact labels, 100% matched precision, 100% matched recall, 0 false-positive matches** with Gemini on 18 labeled recall-to-product cases. Run `npm run eval` to regenerate.

| Mode | Exact label | Matched precision | Matched recall | False-positive matches |
|---|---|---|---|---|
| With Gemini (`gemini-3.5-flash` parser, `gemini-3.1-pro-preview` fuzzy matcher) | 18 of 18 | 100% | 100% | 0 |
| Rules only (no key) | 16 of 18 | 100% | 100% | 0 |

Without a key, the two same-brand cases built for the AI step go to the review list, which never refunds.

PayPal sandbox capabilities were verified with `npm run probe` (results in [`docs/paypal-capabilities.md`](docs/paypal-capabilities.md)) and `npm run it:sandbox` (real refunds, idempotent rerun, forced error). Sandbox dispute behaviour found along the way is recorded in [`docs/decisions.md`](docs/decisions.md).

## Deploy

**Vercel (live demo).** The project deploys with the Vercel CLI and a Neon Postgres database from the Vercel Marketplace:

```bash
vercel link
vercel integration add neon            # sets DATABASE_URL
vercel env add PAYPAL_CLIENT_ID production   # repeat for each key in .env.example
vercel deploy --prod
DATABASE_URL="<neon url>" npm run seed && DATABASE_URL="<neon url>" npm run seed:paypal
```

Migrations and the recall fixtures are bundled with every function (`outputFileTracingIncludes` in [`next.config.ts`](next.config.ts)); pooled Neon URLs disable prepared statements automatically.

**Daily recall check.** `POST /api/ingest` with `Authorization: Bearer $CRON_SECRET`. [`docs/github-action-daily-ingest.yml`](docs/github-action-daily-ingest.yml) is a ready GitHub Action for it; copy it to `.github/workflows/` and add the `APP_URL` and `CRON_SECRET` repository secrets.

## Honest Limitations

- PayPal **sandbox only**. The store and customers are simulated; only the orders that matter are real sandbox payments, and simulated orders are never sent to the refund API (they are labeled "skipped").
- **One recall source** (openFDA food enforcement), which can lag real announcements by weeks. The demo uses **replay** of stored real records.
- The recall **expansion** in the demo is simulated (labeled).
- Sandbox order dates cannot be backdated, so the 90-day order history lives in the app database.
- Customer notices go to an in-app outbox (demo customers use example.com addresses). PayPal's own refund note also reaches the buyer.
- There is no API to create a dispute: the buyer opens it in the sandbox Resolution Center, on a payment made with their PayPal wallet.
- Pullback shows the buyer's dispute reason but does not act on it; a dispute on a recalled item is settled for the recalled amount whatever the stated reason.

## Demo Video

_Link added after recording._

---

## Acknowledgments

Built with:

- [PayPal REST APIs](https://developer.paypal.com) (Orders, Payments, Disputes, Webhooks), sandbox
- [openFDA](https://open.fda.gov) food enforcement API
- [Google Gemini](https://ai.google.dev): parsing, fuzzy matching, briefs, notices, label reading, product photos
- [Next.js](https://nextjs.org), [React](https://react.dev), [Tailwind CSS](https://tailwindcss.com)
- [Drizzle ORM](https://orm.drizzle.team), [Neon](https://neon.tech), [PGlite](https://pglite.dev)
- [Zod](https://zod.dev), [Vitest](https://vitest.dev)

## License

MIT, see [LICENSE](LICENSE).
