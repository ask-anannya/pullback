import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const stores = pgTable("stores", {
  id: id(),
  name: text("name").notNull(),
  paypalMerchantId: text("paypal_merchant_id"),
  ownerEmail: text("owner_email").notNull(),
  isDemo: boolean("is_demo").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const products = pgTable(
  "products",
  {
    id: id(),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    brand: text("brand").notNull(),
    upc: text("upc"),
    sizeText: text("size_text"),
    category: text("category"),
    listingStatus: text("listing_status", { enum: ["active", "flagged"] }).notNull().default("active"),
    /** Storefront price. */
    priceCents: integer("price_cents").notNull().default(0),
    /**
     * The batch currently on the shelf: new storefront orders are filled from it. No FK on purpose,
     * since products and batches would reference each other and the demo wipe deletes batches first.
     */
    shelfBatchId: uuid("shelf_batch_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("products_store_sku").on(t.storeId, t.sku)],
);

export const batches = pgTable(
  "batches",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id),
    lotCode: text("lot_code").notNull(),
    bestBy: date("best_by"),
    receivedAt: date("received_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("batches_product").on(t.productId)],
);

export const customers = pgTable("customers", {
  id: id(),
  storeId: uuid("store_id").notNull().references(() => stores.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  isDemo: boolean("is_demo").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    isRealSandbox: boolean("is_real_sandbox").notNull().default(false),
    // How a real sandbox payment was made: "card" (server-side) or "buyer" (sandbox buyer approved).
    paymentMethod: text("payment_method", { enum: ["card", "buyer"] }),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("orders_capture").on(t.paypalCaptureId)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    batchId: uuid("batch_id").references(() => batches.id),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("order_items_product").on(t.productId), index("order_items_order").on(t.orderId)],
);

export const recalls = pgTable(
  "recalls",
  {
    id: id(),
    sourceRecallId: text("source_recall_id").notNull(),
    eventId: text("event_id"),
    classification: text("classification").notNull(),
    status: text("status"),
    recallingFirm: text("recalling_firm"),
    productDescription: text("product_description").notNull(),
    reasonForRecall: text("reason_for_recall"),
    codeInfo: text("code_info"),
    reportDate: text("report_date"),
    raw: jsonb("raw").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceUrl: text("source_url").notNull(),
    isSimulated: boolean("is_simulated").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("recalls_source_id").on(t.sourceRecallId)],
);

export type DateRange = { from: string | null; to: string | null };

export const recallParsed = pgTable(
  "recall_parsed",
  {
    id: id(),
    recallId: uuid("recall_id").notNull().references(() => recalls.id),
    contentHash: text("content_hash").notNull(),
    upcs: jsonb("upcs").$type<string[]>().notNull(),
    brands: jsonb("brands").$type<string[]>().notNull(),
    productNames: jsonb("product_names").$type<string[]>().notNull(),
    sizes: jsonb("sizes").$type<string[]>().notNull(),
    lots: jsonb("lots").$type<string[]>().notNull(),
    dateRanges: jsonb("date_ranges").$type<DateRange[]>().notNull(),
    hazardType: text("hazard_type", { enum: ["allergen", "pathogen", "foreign_material", "other"] }).notNull(),
    parserVersion: text("parser_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recall_parsed_recall").on(t.recallId)],
);

export type EvidenceRow = {
  field: string;
  recall: string | null;
  store: string | null;
  result: "match" | "mismatch" | "partial" | "missing";
};

export const matches = pgTable(
  "matches",
  {
    id: id(),
    recallId: uuid("recall_id").notNull().references(() => recalls.id),
    recallParsedId: uuid("recall_parsed_id").references(() => recallParsed.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    method: text("method", { enum: ["upc", "brand_name", "lot_date", "fuzzy_llm"] }).notNull(),
    confidence: text("confidence", { enum: ["high", "medium", "low"] }).notNull(),
    evidence: jsonb("evidence").$type<EvidenceRow[]>().notNull(),
    decision: text("decision", { enum: ["matched", "near_miss", "needs_review"] }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("matches_recall").on(t.recallId)],
);

export const incidents = pgTable("incidents", {
  id: id(),
  recallId: uuid("recall_id").notNull().references(() => recalls.id),
  storeId: uuid("store_id").notNull().references(() => stores.id),
  matchId: uuid("match_id").references(() => matches.id),
  parentIncidentId: uuid("parent_incident_id"),
  severity: text("severity", { enum: ["urgent", "standard", "low"] }).notNull(),
  status: text("status", {
    enum: ["awaiting_owner", "approved", "declined", "executing", "done", "failed", "logged_only"],
  }).notNull(),
  checkedOrderCount: integer("checked_order_count").notNull(),
  affectedOrderCount: integer("affected_order_count").notNull(),
  totalRefundCents: integer("total_refund_cents").notNull(),
  brief: jsonb("brief").notNull(),
  statusReason: text("status_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const affectedItems = pgTable(
  "affected_items",
  {
    id: id(),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id),
    orderItemId: uuid("order_item_id").notNull().references(() => orderItems.id),
    rule: text("rule", { enum: ["lot", "best_by", "whole_product"] }).notNull(),
    refundCents: integer("refund_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("affected_items_incident").on(t.incidentId)],
);

export const actions = pgTable(
  "actions",
  {
    id: id(),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id),
    affectedItemId: uuid("affected_item_id").references(() => affectedItems.id),
    type: text("type", {
      enum: ["refund", "notice", "listing_flag", "dispute_evidence", "dispute_accept"],
    }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["planned", "sent", "pending", "succeeded", "failed", "skipped"] }).notNull(),
    request: jsonb("request"),
    response: jsonb("response"),
    paypalRef: text("paypal_ref"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("actions_idempotency_key").on(t.idempotencyKey), index("actions_incident").on(t.incidentId)],
);

export const disputes = pgTable(
  "disputes",
  {
    id: id(),
    storeId: uuid("store_id").notNull().references(() => stores.id),
    paypalDisputeId: text("paypal_dispute_id").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    status: text("status").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("disputes_paypal_id").on(t.paypalDisputeId)],
);

export const notices = pgTable("notices", {
  id: id(),
  incidentId: uuid("incident_id").notNull().references(() => incidents.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["draft", "sent"] }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    storeId: uuid("store_id"),
    incidentId: uuid("incident_id"),
    actor: text("actor", { enum: ["agent", "owner", "system"] }).notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audit_events_at").on(t.at)],
);
