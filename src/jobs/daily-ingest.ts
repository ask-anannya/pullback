import "dotenv/config";
import { fetchRecalls } from "@/recalls/openfda";
import { ingestAndProcess, type ProcessSummary } from "@/pipeline/process-recall";
import { audit } from "@/audit/log";

/** Daily job: pull recent openFDA food recalls and run the pipeline on new or changed ones. */
export async function dailyIngest(opts: { days?: number } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - (opts.days ?? 30) * 86_400_000);
  const records = await fetchRecalls({ from, to });
  const results: ProcessSummary[] = [];
  for (const r of records) results.push(await ingestAndProcess(r));
  const summary = {
    window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    fetched: records.length,
    new: results.filter((r) => r.change === "new").length,
    changed: results.filter((r) => r.change === "changed").length,
    incidents: results.flatMap((r) => r.incidentIds).length,
    nearMisses: results.flatMap((r) => r.nearMisses).length,
  };
  await audit({ actor: "system", eventType: "daily_ingest", payload: summary });
  return summary;
}

if (process.argv[1] && /daily-ingest\.ts$/.test(process.argv[1])) {
  const { closeDb } = await import("@/db/client");
  console.log(await dailyIngest());
  await closeDb();
}
