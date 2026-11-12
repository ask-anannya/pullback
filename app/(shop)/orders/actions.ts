"use server";

import { revalidatePath } from "next/cache";
import { getShopper } from "@/shop/shopper";
import { removeShopperOrders } from "@/shop/remove-orders";

/** Remove one storefront order (or all of them) from "My orders". PayPal is not touched. */
export async function removeOrders(orderId?: string): Promise<number> {
  const shopper = await getShopper();
  if (!shopper) return 0;
  const n = await removeShopperOrders(shopper.id, orderId ? [orderId] : undefined);
  revalidatePath("/orders");
  revalidatePath("/seller");
  return n;
}
