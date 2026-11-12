import * as z from "zod/v4";
import { paypalFetch } from "./auth";

const VerifyResponse = z.looseObject({ verification_status: z.string() });

/** Verify a webhook delivery with PayPal. Returns true only for SUCCESS. */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const r = await paypalFetch(`/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    label: "verify_webhook",
    schema: VerifyResponse,
    body: {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return r.verification_status === "SUCCESS";
}
