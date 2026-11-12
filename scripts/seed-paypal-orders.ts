/**
 * Attach real PayPal sandbox payments to the demo orders that matter for the demo:
 * all hero orders in the recalled and expansion batches, plus a few unaffected ones (Option A, card).
 * The PayPal-wallet order (the one a buyer can dispute) is placed live on the storefront during the demo.
 *
 *   npm run seed:paypal      (stop the dev server first when using the embedded database)
 */
import "dotenv/config";
import { getDb, closeDb } from "../src/db/client";
import { env } from "../src/lib/env";
import { attachCardPayments } from "../src/paypal/seed-payments";

if (!env.paypalConfigured()) {
  console.error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in .env");
  process.exit(1);
}

await getDb();
console.log("Creating card-paid sandbox orders...");
const r = await attachCardPayments({ log: console.log });
console.log(`Done: ${r.succeeded} of ${r.attempted} paid.${r.errors.length ? ` ${r.errors.length} failed.` : ""}`);

console.log(`
Next: npm run dev, then open ${env.appBaseUrl()} and buy something as the shopper.`);
await closeDb();
if (r.errors.length) process.exit(1);
