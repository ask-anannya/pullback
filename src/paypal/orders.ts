import * as z from "zod/v4";
import { paypalFetch } from "./auth";
import { centsToValue } from "@/lib/money";

export type OrderLine = { name: string; sku: string; quantity: number; unitPriceCents: number };

const Capture = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: z.looseObject({ value: z.string(), currency_code: z.string() }).optional(),
});

export const OrderResponse = z.looseObject({
  id: z.string(),
  status: z.string(),
  purchase_units: z
    .array(
      z.looseObject({
        payments: z.looseObject({ captures: z.array(Capture).optional() }).optional(),
      }),
    )
    .optional(),
  payer: z.looseObject({ email_address: z.string().optional() }).optional(),
  links: z.array(z.looseObject({ href: z.string(), rel: z.string() })).optional(),
});
export type OrderResponse = z.infer<typeof OrderResponse>;

export function firstCapture(o: OrderResponse) {
  return o.purchase_units?.[0]?.payments?.captures?.[0];
}

function purchaseUnit(lines: OrderLine[], currency: string, customId: string, referenceId: string, description?: string) {
  const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  return {
    reference_id: referenceId.slice(0, 256),
    custom_id: customId.slice(0, 127),
    description: description ?? "Pullback demo store order (simulated store, real sandbox payment)",
    amount: {
      currency_code: currency,
      value: centsToValue(totalCents),
      breakdown: { item_total: { currency_code: currency, value: centsToValue(totalCents) } },
    },
    items: lines.map((l) => ({
      name: l.name.slice(0, 127),
      sku: l.sku.slice(0, 127),
      quantity: String(l.quantity),
      unit_amount: { currency_code: currency, value: centsToValue(l.unitPriceCents) },
      category: "PHYSICAL_GOODS",
    })),
  };
}

/**
 * Option A: create and capture server-side using a sandbox test card. No buyer approval.
 * PayPal-Request-Id is required when payment_source is present. The create call may return
 * COMPLETED directly; otherwise we call capture.
 */
export async function createAndCaptureCardOrder(args: {
  lines: OrderLine[];
  currency?: string;
  customId: string;
  requestId: string;
  card: { number: string; expiry: string; securityCode: string; name: string };
}): Promise<{ orderId: string; captureId: string; status: string; raw: OrderResponse }> {
  const currency = args.currency ?? "USD";
  let order = await paypalFetch(`/v2/checkout/orders`, {
    method: "POST",
    label: "create_order_card",
    idempotencyKey: args.requestId,
    headers: { Prefer: "return=representation" },
    schema: OrderResponse,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(args.lines, currency, args.customId, args.customId)],
      payment_source: {
        card: {
          number: args.card.number,
          expiry: args.card.expiry,
          security_code: args.card.securityCode,
          name: args.card.name,
        },
      },
    },
  });
  if (order.status !== "COMPLETED" || !firstCapture(order)) {
    order = await captureOrder(order.id, `${args.requestId}-capture`);
  }
  const cap = firstCapture(order);
  if (!cap) throw new Error(`Order ${order.id} has no capture (status ${order.status})`);
  return { orderId: order.id, captureId: cap.id, status: cap.status, raw: order };
}

/** Option B: create an order the buyer approves in the PayPal popup (storefront checkout). */
export async function createBuyerOrder(args: { lines: OrderLine[]; customId: string; currency?: string; brandName?: string; description?: string }) {
  return paypalFetch(`/v2/checkout/orders`, {
    method: "POST",
    label: "create_order_buyer",
    schema: OrderResponse,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(args.lines, args.currency ?? "USD", args.customId, args.customId, args.description)],
      // A demo store: skip the shipping address step in the popup.
      application_context: { brand_name: (args.brandName ?? "Pullback demo store").slice(0, 127), shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
    },
  });
}

/** Line items PayPal recorded on an order (what the buyer actually approved and paid for). */
export function orderItemsOf(o: unknown): { sku: string; quantity: number; unitPriceCents: number }[] {
  type Item = { sku?: string; quantity?: string; unit_amount?: { value?: string } };
  const items = (o as { purchase_units?: { items?: Item[] }[] })?.purchase_units?.[0]?.items ?? [];
  return items
    .filter((i) => i.sku)
    .map((i) => ({ sku: i.sku!, quantity: Number(i.quantity ?? 1), unitPriceCents: Math.round(Number(i.unit_amount?.value ?? 0) * 100) }));
}

export async function captureOrder(orderId: string, requestId: string) {
  return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    label: "capture_order",
    idempotencyKey: requestId,
    headers: { Prefer: "return=representation" },
    schema: OrderResponse,
    body: {},
  });
}

export async function getOrder(orderId: string) {
  return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { label: "get_order", schema: OrderResponse });
}

const CaptureDetails = z.looseObject({
  id: z.string(),
  status: z.string(),
  amount: z.looseObject({ value: z.string(), currency_code: z.string() }),
});

export async function getCapture(captureId: string) {
  return paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    label: "get_capture",
    schema: CaptureDetails,
  });
}
