# Pullback Architecture

This document shows how Pullback is put together, as Mermaid diagrams, with links to the code. For setup and the demo walkthrough, see [README.md](README.md).

1. [System overview](#1-system-overview)
2. [Recall pipeline](#2-recall-pipeline)
3. [Matching decision](#3-matching-decision)
4. [Approve and execute](#4-approve-and-execute)
5. [Per-order payout path](#5-per-order-payout-path)
6. [Incident state machine](#6-incident-state-machine)
7. [Action state machine](#7-action-state-machine)
8. [Storefront checkout](#8-storefront-checkout)
9. [Package photo check](#9-package-photo-check)
10. [Data model](#10-data-model)
11. [Frontend structure](#11-frontend-structure)
12. [Where the LLM sits](#12-where-the-llm-sits)

---

## 1. System overview

One Next.js app serves both the storefront and the owner dashboard. Every outside service is reached through one module: PayPal through `src/paypal/`, Gemini through `src/llm/client.ts`, openFDA through `src/recalls/openfda.ts`.

```mermaid
flowchart LR
  subgraph Browser
    Shop["Storefront<br/>app/(shop)"]
    Seller["Seller dashboard<br/>app/seller"]
    Shop <-->|"View as switch"| Seller
  end

  subgraph App["Next.js app (Vercel)"]
    Checkout["/api/shop/checkout<br/>create, capture"]
    Replay["/api/replay<br/>/api/ingest"]
    Incidents["/api/incidents/[id]<br/>approve, decline, retry, status"]
    Label["/api/label-check"]
    Webhook["/api/paypal/webhook"]
    Pipeline["src/pipeline<br/>process-recall"]
    Executor["src/executor<br/>plan, execute"]
    Disputes["src/disputes<br/>sync"]
    LLM["src/llm/client.ts<br/>Zod-validated Gemini"]
    Audit["src/audit/log.ts"]
  end

  PayPal[("PayPal REST<br/>sandbox")]
  Gemini[("Google Gemini")]
  FDA[("openFDA<br/>food enforcement")]
  DB[("Postgres<br/>Neon or PGlite")]

  Shop --> Checkout --> PayPal
  Seller --> Replay --> Pipeline
  Seller --> Incidents --> Executor
  Seller --> Label
  Pipeline --> FDA
  Pipeline --> LLM
  Label --> LLM
  LLM --> Gemini
  Executor --> PayPal
  Executor --> Disputes --> PayPal
  Webhook --> PayPal
  Pipeline --> DB
  Executor --> DB
  Checkout --> DB
  Pipeline --> Audit
  Executor --> Audit
  Audit --> DB
```

---

## 2. Recall pipeline

Runs daily (`POST /api/ingest`, or **Check the live FDA feed** on the overview) and on demand from replay fixtures. Code: [`src/pipeline/process-recall.ts`](src/pipeline/process-recall.ts).

```mermaid
flowchart TD
  A["openFDA record<br/>or replay fixture"] --> B["Ingest<br/>content hash"]
  B -->|unchanged| Z1["Stop: already processed"]
  B -->|new or changed| C["Parse<br/>regex first, Gemini fills in"]
  C --> D["Match every store product<br/>(see section 3)"]
  D -->|no product matched| Z2["Stay silent<br/>record near-misses with reasons"]
  D -->|needs review| R["Needs review list<br/>never refunds"]
  D -->|matched| E["Narrow to affected order items<br/>lot or best-by overlap"]
  E --> F["Severity<br/>FDA class + hazard type"]
  F -->|low| L["Incident: logged_only"]
  F -->|urgent or standard| G["Brief writer + notice writer<br/>Gemini, template fallback"]
  G --> H["Incident: awaiting_owner"]
  B -->|"changed recall, new lots"| X["Expansion diff<br/>child incident with only new orders"]
  X --> E
```

| Step | Deterministic? | File |
|---|---|---|
| Ingest and change detection | yes | [`src/recalls/fingerprint.ts`](src/recalls/fingerprint.ts) |
| Parse | regex first; Gemini values must appear in the text | [`src/recalls/parse.ts`](src/recalls/parse.ts) |
| Match | yes, Gemini only for partial signals | [`src/matching/identifiers.ts`](src/matching/identifiers.ts), [`fuzzy.ts`](src/matching/fuzzy.ts) |
| Narrow | yes | [`src/narrowing/narrow.ts`](src/narrowing/narrow.ts) |
| Severity | yes | [`src/severity/severity.ts`](src/severity/severity.ts) |
| Brief and notice text | Gemini, validated, template fallback | [`src/agents/`](src/agents/) |

---

## 3. Matching decision

The identifier-first matcher is a pure function. It returns a decision plus an evidence row per field (match, partial, mismatch, missing), which is exactly what the incident page and the package photo check display.

```mermaid
flowchart TD
  S["Recall + store product + batches"] --> U{"Barcode in recall?"}
  U -->|yes| UL{"Recall lists lots or dates,<br/>and none of our batches overlap?"}
  UL -->|yes| NM1["near_miss: same product, other batch"]
  UL -->|no| M1["matched (high)"]
  U -->|no| BN{"Same brand and<br/>strong name match?"}
  BN -->|yes| C1{"Barcode or size conflict?"}
  C1 -->|yes| NM2["near_miss: different barcode or size"]
  C1 -->|no| LO{"Lots or dates given<br/>and no overlap?"}
  LO -->|yes| NM3["near_miss: other batch"]
  LO -->|no| M2["matched (medium or high)"]
  BN -->|"same brand, partial name"| AI["Gemini fuzzy matcher"]
  AI -->|"same product, confident"| M3["matched"]
  AI -->|unsure| RV["needs_review"]
  AI -->|"different flavor or product"| NM4["near_miss"]
  BN -->|"same brand only"| NM5["near_miss: different product"]
  BN -->|"different brand"| NR["not_related"]
```

---

## 4. Approve and execute

The approve endpoint is the only way into PayPal writes. The response returns at once and execution continues with `after()`, so the incident page polls `/status` for live progress. Code: [`src/executor/execute.ts`](src/executor/execute.ts).

```mermaid
sequenceDiagram
  actor Owner
  participant UI as Incident page
  participant API as /api/incidents/[id]
  participant Exec as Executor
  participant PP as PayPal
  participant DB as Database

  Owner->>UI: Preview exactly what will happen
  UI->>API: (server render) buildPlan
  Note over UI: Per order: refund, accept dispute, evidence or skip,<br/>amount, reason, buyer's dispute reason
  Owner->>UI: Approve
  UI->>API: POST approve
  API->>DB: awaiting_owner → approved
  API-->>UI: 200 approved
  API->>Exec: after(): executeIncident
  Exec->>DB: approved → executing (atomic claim)
  Exec->>Exec: re-check caps and over-refund guard
  loop each affected order item
    Exec->>PP: POST captures/{id}/refund<br/>PayPal-Request-Id = idempotency key
    PP-->>Exec: refund id, COMPLETED or PENDING
    Exec->>DB: action succeeded, refundedCents += amount
  end
  loop each order with an open dispute
    Exec->>PP: GET dispute (amount buyer asked for)
    Exec->>PP: POST accept-claim (REFUND or PARTIAL_REFUND)
    Exec->>PP: GET dispute (did money move?)
    Exec->>DB: succeeded, or pending (offer waits for buyer)
  end
  Exec->>DB: flag listing, write notices to outbox
  Exec->>DB: executing → done (or failed)
  loop every second
    UI->>API: GET status
    API-->>UI: counts by action status
  end
```

---

## 5. Per-order payout path

Each affected order takes exactly one path. Disputes are synced from PayPal (full `GET` per dispute, because the list endpoint omits the transaction ids) before the plan is built. Code: `buildPlan` in [`src/executor/execute.ts`](src/executor/execute.ts), [`src/disputes/sync.ts`](src/disputes/sync.ts).

```mermaid
flowchart TD
  O["Affected order item"] --> R{"Real sandbox payment<br/>with a capture id?"}
  R -->|no| SK1["Skip: not a real sandbox payment<br/>(simulated order, labeled)"]
  R -->|yes| D{"Dispute on this order?"}
  D -->|none| RF["PayPal refund of the recalled items"]
  D -->|"PayPal already refunded<br/>through the dispute"| CR{"Covers the recalled items?"}
  CR -->|fully| SK2["Skip: already refunded by PayPal"]
  CR -->|partly| RR["Refund only the remainder"]
  D -->|"open, waiting for seller"| AS{"Order refunded before?"}
  AS -->|yes| EV["Provide recall evidence<br/>no second refund"]
  AS -->|no| AQ{"Buyer asked for more<br/>than the recalled items?"}
  AQ -->|no| AF["accept-claim REFUND<br/>money moves now"]
  AQ -->|yes| AP["accept-claim PARTIAL_REFUND<br/>offer, pending until buyer accepts"]
  D -->|"in progress at PayPal<br/>(under review)"| SK3["Skip: PayPal is handling it"]
```

Every write above is guarded by:

- a deterministic idempotency key per incident, order and action type ([`src/executor/idempotency.ts`](src/executor/idempotency.ts));
- an over-refund check: captured minus already refunded, including dispute refunds;
- per-order and per-batch caps ([`src/executor/caps.ts`](src/executor/caps.ts)).

---

## 6. Incident state machine

```mermaid
stateDiagram-v2
  [*] --> logged_only: severity low (Class III)
  [*] --> awaiting_owner: severity urgent or standard
  awaiting_owner --> approved: owner clicks Approve
  awaiting_owner --> declined: owner clicks Decline
  approved --> executing: executor claims it (atomic update)
  executing --> awaiting_owner: caps exceeded, needs owner
  executing --> done: every action succeeded, skipped or pending
  executing --> failed: one or more actions failed
  failed --> executing: Retry (same idempotency keys)
  done --> [*]
  declined --> [*]
  logged_only --> [*]
```

A retry reuses the same idempotency keys, so PayPal returns the original refund rather than paying again.

---

## 7. Action state machine

One row in `actions` per refund, dispute action, notice and listing flag.

```mermaid
stateDiagram-v2
  [*] --> planned
  planned --> skipped: path is skip (reason recorded)
  planned --> sent: request sent to PayPal
  sent --> succeeded: COMPLETED or PENDING refund
  sent --> pending: partial dispute offer, waiting for buyer
  sent --> failed: PayPal error or over-refund guard
  pending --> succeeded: dispute sync sees PayPal's refund
  failed --> sent: Retry
  succeeded --> [*]
  skipped --> [*]
```

---

## 8. Storefront checkout

The server never trusts client prices, and no order row exists until PayPal has captured the money. Code: [`app/api/shop/checkout/`](app/api/shop/checkout/), [`src/paypal/orders.ts`](src/paypal/orders.ts).

```mermaid
sequenceDiagram
  actor Shopper
  participant Page as Checkout page
  participant Create as /api/shop/checkout/create
  participant Capture as /api/shop/checkout/capture
  participant PP as PayPal
  participant DB as Database

  Shopper->>Page: PayPal Buttons
  Page->>Create: items [{sku, qty}]
  Create->>DB: load prices, reject flagged (recalled) products
  Create->>PP: POST /v2/checkout/orders
  PP-->>Page: order id
  Shopper->>PP: approve in PayPal popup
  Page->>Capture: order id
  Capture->>DB: already recorded? return it (idempotent)
  Capture->>PP: POST capture, then GET order
  Capture->>DB: insert order + items from PayPal's item data,<br/>each item tied to the product's shelf batch
  Capture-->>Page: order id
  Page->>Shopper: My orders, with batch and capture id
```

Because each item is tied to the batch on the shelf, a purchase made live in the demo (the hero is sold from FTM-2508B) is caught by the real recall H-0836-2026.

---

## 9. Package photo check

The owner photographs a package on the shelf. Gemini only reads the label; the verdict comes from the same matcher as the recall pipeline, with the photo's lot and best-by as the only batch. Code: [`src/agents/label-reader.ts`](src/agents/label-reader.ts), [`src/matching/label-check.ts`](src/matching/label-check.ts).

```mermaid
flowchart LR
  P["Photo<br/>JPG, PNG, WebP, HEIC ≤ 8 MB"] --> V["Gemini vision<br/>brand, name, size, UPC, lot, best-by"]
  V --> Z{"Readable?"}
  Z -->|no| UR["Could not read: retake"]
  Z -->|yes| F["Find store product<br/>UPC, then brand + name"]
  F -->|none| NS["Not in your catalog"]
  F --> M["matchRecallToProduct<br/>against every processed recall"]
  M -->|matched| RC["Recalled: pull from sale<br/>+ units sold from this batch,<br/>link to incident"]
  M -->|"matched, no code read"| CC["Recalled product: check the code"]
  M -->|"near_miss, other batch"| OK["Safe to sell: batch not recalled"]
  M -->|nothing| NR["No recall found"]
```

---

## 10. Data model

Drizzle schema: [`src/db/schema.ts`](src/db/schema.ts). Migrations in [`drizzle/`](drizzle/).

```mermaid
erDiagram
  stores ||--o{ products : sells
  stores ||--o{ customers : has
  stores ||--o{ orders : receives
  products ||--o{ batches : "made in"
  customers ||--o{ orders : places
  orders ||--o{ order_items : contains
  products ||--o{ order_items : "line of"
  batches ||--o{ order_items : "filled from"
  recalls ||--o{ recall_parsed : "parsed as"
  recalls ||--o{ matches : produces
  products ||--o{ matches : "matched to"
  recalls ||--o{ incidents : opens
  incidents ||--o{ affected_items : lists
  order_items ||--o{ affected_items : "affected by"
  incidents ||--o{ actions : runs
  affected_items ||--o{ actions : "paid by"
  incidents ||--o{ notices : sends
  customers ||--o{ notices : receives
  orders ||--o{ disputes : "disputed in"

  products {
    text sku
    text brand
    text upc
    text listing_status
    int price_cents
    uuid shelf_batch_id
  }
  batches {
    text lot_code
    date best_by
  }
  orders {
    text paypal_order_id
    text paypal_capture_id
    bool is_real_sandbox
    text payment_method
  }
  order_items {
    int quantity
    int unit_price_cents
    int refunded_cents
  }
  recalls {
    text source_recall_id
    text classification
    text code_info
    text content_hash
    bool is_simulated
  }
  incidents {
    text severity
    text status
    int affected_order_count
    int total_refund_cents
    jsonb brief
  }
  actions {
    text type
    text idempotency_key
    text status
    text paypal_ref
  }
  disputes {
    text paypal_dispute_id
    text status
    jsonb raw
  }
```

`audit_events` is append-only and stands apart: it records `actor`, `event_type` and a JSON payload for every PayPal call, AI call (model, prompt version, tokens, validity), approval, reset and photo check.

---

## 11. Frontend structure

```mermaid
flowchart TD
  Root["app/layout.tsx<br/>fonts, demo banner"] --> ShopL["app/(shop)/layout.tsx<br/>cart context, header, footer"]
  Root --> SellerL["app/seller/layout.tsx<br/>dashboard nav"]
  ShopL --> H["/ home"]
  ShopL --> SA["/shop catalog + filter"]
  ShopL --> PD["/product/[sku]<br/>batch on shelf, best-by"]
  ShopL --> CT["/cart"]
  ShopL --> CO["/checkout<br/>PayPal Buttons"]
  ShopL --> MO["/orders<br/>refunds, messages, remove"]
  SellerL --> OV["/seller overview<br/>recall check, photo check, recent orders"]
  SellerL --> IN["/seller/incidents/[id]<br/>evidence, preview, approve, progress"]
  SellerL --> RV["/seller/review"]
  SellerL --> AC["/seller/activity<br/>audit log"]
  SellerL --> OB["/seller/outbox<br/>notices"]
  SellerL --> RP["/seller/replay<br/>all fixtures"]
  PS["ProfileSwitch<br/>Shopper | Store owner"] -.-> ShopL
  PS -.-> SellerL
```

The cart lives in `localStorage` (wrapped in try/catch). Product images come from `public/products/`, generated by [`scripts/generate-product-images.ts`](scripts/generate-product-images.ts); any product without a photo falls back to a drawn SVG package.

---

## 12. Where the LLM sits

All Gemini calls go through [`src/llm/client.ts`](src/llm/client.ts): JSON schema output, Zod validation, one retry with the validation error, then `LlmUnavailableError` so the caller falls back. Every call is audited with model, prompt version and token counts. Prompts are versioned in [`src/agents/prompts/index.ts`](src/agents/prompts/index.ts).

```mermaid
flowchart LR
  subgraph Deterministic["Deterministic: decides and pays"]
    Match["Identifier matching"]
    Narrow["Narrowing"]
    Sev["Severity"]
    Plan["Payout plan + caps"]
    Pay["PayPal writes"]
  end
  subgraph AI["Gemini: reads and writes text"]
    Parse["Recall parser"]
    Fuzzy["Fuzzy matcher<br/>partial signals only"]
    Hazard["Hazard explainer"]
    Brief["Brief writer"]
    Notice["Notice writer"]
    Read["Label reader"]
  end
  Parse --> Match
  Fuzzy -->|"confident → match,<br/>unsure → review"| Match
  Match --> Narrow --> Sev --> Plan --> Pay
  Hazard --> Brief
  Narrow --> Brief
  Read --> Match
  Plan --> Notice
  Gate{{"Owner approval"}}
  Plan --> Gate --> Pay
```

The model never calls a payment API, never sets the severity, and never chooses which orders are affected.
