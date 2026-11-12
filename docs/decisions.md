# Decisions

Choices made while building, and places where the build differs from `plan-core.md` or `implementation-plan.md`.

## Runtime and data

- **Embedded Postgres (PGlite) for local runs.** `DATABASE_URL` empty means an embedded PGlite database in `./.data/pglite`, so a fresh clone runs without Docker. Any `postgres://` URL (Docker locally, Render Postgres in production) uses the `postgres` driver. Both run the same Drizzle migrations automatically on first use. PGlite allows one process at a time, so stop the dev server before running scripts that touch the app database (`seed`, `seed:paypal`, `job:ingest`).
- **TypeScript 5.9, not 7.** Next.js 15 type-checks with the TypeScript JS API, which TypeScript 7 (the native port) no longer ships.
- **Zod v4 API (`zod/v4`).** It converts Zod schemas to JSON Schema, which Gemini's `responseJsonSchema` accepts directly. Every LLM response is still validated with Zod.
- **Execution runs after the approve response** (`after()` from `next/server`) so the incident page can poll live progress. Render runs a long-lived Node server, so the work is not cut off.

## PayPal

- **No runtime use of `@paypal/agent-toolkit`.** It has adapters for the Vercel AI SDK, OpenAI Agents, LangChain and MCP, but no native Gemini adapter and no provide-evidence tool. Pullback's rule is "AI decides, code pays": the LLM never calls a payment tool, and every PayPal write happens in `src/executor/execute.ts` after the owner approves. The PayPal AI-Toolkit Claude Code plugin was used only as a dev aid to inspect sandbox data.
- **Seeding is hybrid.** Most real sandbox orders are created and captured server-side with a sandbox test card (Option A). Orders paid from a PayPal wallet (Option B) come from the storefront (`/`), where the presenter shops as the sandbox buyer; only those can be disputed, because a buyer can only dispute payments from their own PayPal wallet and there is no API to create a dispute.
- **One refund per affected order item**, keyed `sha256(incident_id + order_item_id + "refund")` and sent as `PayPal-Request-Id`. If an action already holds a PayPal refund id, a retry confirms it with `GET /v2/payments/refunds/{id}` instead of refunding again.
- **`note_to_payer`** on each refund carries a one-line recall notice, so the buyer also sees the reason in PayPal.
- **Disputes link to orders by capture id** (`disputed_transactions[].seller_transaction_id`). To be confirmed by `npm run probe` with `PROBE_DISPUTE_ID`.
- **Exactly one path per disputed order:** an open dispute on an unrefunded order is resolved with `accept-claim` (which refunds the buyer) instead of a separate refund; an open dispute on an already refunded order gets `provide-evidence` (after the sandbox-only `require-evidence` when needed).
- **Listing flag** is applied for urgent incidents only, following the severity table in plan-core 8.5. The listing lives in the app database (the demo store has no PayPal catalog listing to flag).

## Recalls and matching

- **Hero product is shaped around a real recall:** openFDA `H-0836-2026`, Fisher Tex Mex Trail Mix 30 oz, UPC 070690275941, best by 08/06/27, Class I, Salmonella (JOHN B SANFILIPPO & SONS INC, report date 2026-05-27).
- **Fixtures** are real openFDA records: H-0836-2026 (true match), H-0831-2026 (same product, different best-by: near-miss), H-0833-2026 (same brand, different product: near-miss), H-1071-2026 (unrelated), H-1234-2026 (Class III, logged only). The expansion fixture is H-0836-2026 with one extra best-by date and is labeled "simulated for demo" everywhere it appears.
- **Brand words are removed before comparing names**, so a shared brand alone never looks like a shared product.
- **Recall UPCs often omit the check digit** (11 digits). A store UPC that equals the recall UPC plus one digit counts as a barcode match, labeled as such in the evidence.
- **AI fallback.** Without `GEMINI_API_KEY`, parsing is regex-only, fuzzy cases go to the review list, and the hazard explanation, brief and notice use templates. The UI labels each text as "AI written" or "Template".

## Models

- `LLM_MODEL_FAST` and `LLM_MODEL_REASONING` come from env. Used: **`gemini-3.5-flash`** (fast) and **`gemini-3.1-pro-preview`** (reasoning), both confirmed by `npm run probe` on 2026-11-12. `gemini-2.5-pro` returned 404 "no longer available to new users", and Google's error message recommended `gemini-3.1-pro-preview`.
- The SDK client uses `apiVersion: "v1beta"`: on `v1`, system instructions are rejected ("Developer instruction is not enabled for api version v1").

## Disputes: read each dispute in full, decide by seller links (verified 2026-11-12)
- The sandbox dispute list omits `disputed_transactions`, `links` and `refund_details`, so sync fetches each dispute with GET.
- After `accept-claim` (tested with `refund_amount` on PP-R-VCD-10200200), PayPal refunded the buyer, but the dispute stayed `UNDER_REVIEW` with only a `self` link. Status alone does not say whether the seller can still act.
- Rule: a dispute is actionable when it is not resolved and offers a seller link (`accept_claim`, `make_offer`, ...). A dispute that lists money in `refund_details.transactions` and is no longer actionable means the buyer was already paid; the executor skips that order instead of refunding again (the local over-refund guard cannot see dispute refunds).
- A capture under an open dispute is `PENDING` with reason `BUYER_COMPLAINT`, which is another reason accept-claim is the path for disputed orders.
- The incident page syncs disputes before showing the approval preview, so the preview matches what approval will do.

## Accepting a dispute for a recall (verified 2026-11-12 on PP-R-NJB-10200199)
- `accept-claim` without `accept_claim_type` on a "not as described" dispute fails with `MISSING_RETURN_SHIPPING_ADDRESS`: PayPal assumes the item comes back. Recalled food is thrown away, so the type is always set.
- `REFUND` means the full amount the buyer asked for; a smaller `refund_amount` with `REFUND` fails with `INVALID_ACCEPT_CLAIM_TYPE`. Pullback refunds only the recalled items, so when that is less than `offer.buyer_requested_amount` it sends `PARTIAL_REFUND`.
- A `PARTIAL_REFUND` accept moves no money: PayPal records a seller offer and the dispute goes to `WAITING_FOR_BUYER_RESPONSE`. The action is stored as `pending`, the item is not counted as refunded, and no separate refund is ever sent for that order while the dispute is open. When a later sync sees `refund_details.transactions`, the action becomes `succeeded` and the amount is credited.
- PayPal error bodies (name, issue) are now written to the audit log and shown on the Activity page.
- A dispute can refund less than the recalled items on that order (a buyer disputed $17.99 of a two-jar $35.98 order). Dispute refunds are credited against the order's recalled items first, and only the uncovered remainder is refunded; the over-refund guard also counts money returned through disputes. Verified live: capture 9HA176388X105341T ended fully REFUNDED ($17.99 by dispute + $17.99 by Pullback), and the hero recall's $341.81 is covered exactly.
