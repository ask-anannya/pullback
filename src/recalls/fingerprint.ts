import { createHash } from "node:crypto";

/** Hash of the fields whose change means the recall itself changed (used for expansion detection). */
export function contentHash(r: {
  product_description: string;
  code_info?: string | null;
  classification: string;
  status?: string | null;
}): string {
  const s = [r.product_description, r.code_info ?? "", r.classification, r.status ?? ""].map((x) => x.trim()).join("␟");
  return createHash("sha256").update(s).digest("hex");
}
