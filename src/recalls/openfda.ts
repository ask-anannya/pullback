import * as z from "zod/v4";

export const OpenFdaRecall = z.looseObject({
  recall_number: z.string(),
  event_id: z.string().optional(),
  classification: z.string(),
  status: z.string().optional(),
  recalling_firm: z.string().optional(),
  product_description: z.string(),
  reason_for_recall: z.string().optional().default(""),
  code_info: z.string().optional().default(""),
  report_date: z.string().optional(),
  recall_initiation_date: z.string().optional(),
});
export type OpenFdaRecall = z.infer<typeof OpenFdaRecall>;

const Page = z.looseObject({
  meta: z.looseObject({ results: z.looseObject({ total: z.number(), skip: z.number(), limit: z.number() }) }).optional(),
  results: z.array(z.unknown()).optional(),
});

const BASE = "https://api.fda.gov/food/enforcement.json";

export function sourceUrlFor(recallNumber: string): string {
  return `${BASE}?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Fetch food enforcement records whose report_date falls in [from, to].
 * A 404 NOT_FOUND from openFDA means zero results, not an error.
 */
export async function fetchRecalls(args: { from: Date; to: Date; pageSize?: number; maxRecords?: number }): Promise<OpenFdaRecall[]> {
  const limit = args.pageSize ?? 100;
  const max = Math.min(args.maxRecords ?? 1000, 25000);
  const out: OpenFdaRecall[] = [];
  for (let skip = 0; skip < max; skip += limit) {
    const qs = `search=report_date:[${ymd(args.from)}+TO+${ymd(args.to)}]&limit=${limit}&skip=${skip}`;
    const apiKey = process.env.OPENFDA_API_KEY ? `&api_key=${encodeURIComponent(process.env.OPENFDA_API_KEY)}` : "";
    const res = await fetch(`${BASE}?${qs}${apiKey}`);
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`openFDA request failed (${res.status})`);
    const page = Page.parse(await res.json());
    const rows = page.results ?? [];
    for (const r of rows) {
      const parsed = OpenFdaRecall.safeParse(r);
      if (parsed.success) out.push(parsed.data);
    }
    const total = page.meta?.results.total ?? 0;
    if (rows.length < limit || skip + limit >= total) break;
  }
  return out;
}
