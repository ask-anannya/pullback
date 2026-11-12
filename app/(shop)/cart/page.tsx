import { getShopProducts } from "@/queries";
import { toCatalog } from "../_components/catalog";
import { CartView } from "./cart-view";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Your cart</h1>
      <CartView catalog={toCatalog(await getShopProducts())} />
    </div>
  );
}
