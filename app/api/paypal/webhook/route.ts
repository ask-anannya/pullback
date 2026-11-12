import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { verifyWebhook } from "@/paypal/webhooks";
import { audit } from "@/audit/log";
import { syncDisputes } from "@/disputes/sync";

type WebhookEvent = { id?: string; event_type?: string; resource?: { id?: string; status?: string } };

export async function POST(req: Request) {
  const event = (await req.json().catch(() => null)) as WebhookEvent | null;
  if (!event?.event_type) return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, event);
  } catch {
    verified = false;
  }
  await audit({ actor: "system", eventType: "webhook_received", payload: { type: event.event_type, id: event.id, verified } });
  if (!verified) return NextResponse.json({ error: "Signature not verified" }, { status: 401 });

  const db = await getDb();
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" && event.resource?.id) {
    // resource is the refund; update the matching action's stored PayPal status.
    const action = (await db.select().from(schema.actions).where(eq(schema.actions.paypalRef, event.resource.id)))[0];
    if (action) await db.update(schema.actions).set({ response: event.resource as Record<string, unknown> }).where(eq(schema.actions.id, action.id));
  }
  if (event.event_type.startsWith("CUSTOMER.DISPUTE.")) {
    const store = (await db.select({ id: schema.stores.id }).from(schema.stores).limit(1))[0];
    if (store) await syncDisputes(store.id);
  }
  return NextResponse.json({ ok: true });
}
