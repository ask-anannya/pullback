import { getShopProducts } from "@/queries";
import { env } from "@/lib/env";
import { toCatalog } from "../_components/catalog";
import { PayPalCheckout } from "./paypal-checkout";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Checkout</h1>
      {!env.paypalConfigured() ? (
        <div className="shop-card mt-8 p-6 text-tomato">PayPal sandbox credentials are not set. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.</div>
      ) : (
        <PayPalCheckout catalog={toCatalog(await getShopProducts())} clientId={process.env.PAYPAL_CLIENT_ID ?? ""} />
      )}
    </div>
  );
}
