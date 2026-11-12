/** Integer cents to a PayPal amount string ("12.34"). */
export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  return (cents / 100).toFixed(2);
}

/** PayPal amount string to integer cents. */
export function valueToCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Invalid amount: ${value}`);
  const [w, f = ""] = value.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
