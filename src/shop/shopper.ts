import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

/**
 * The one shopper profile the presenter plays on the storefront (no login: it is a demo).
 * The PayPal payment itself is made by whichever sandbox account logs in to the PayPal popup.
 */
export const SHOPPER = { name: "Sam Rivera", email: "sam.rivera@shopper.example.com" } as const;

export async function getShopper() {
  const db = await getDb();
  return (await db.select().from(schema.customers).where(eq(schema.customers.email, SHOPPER.email)))[0] ?? null;
}
