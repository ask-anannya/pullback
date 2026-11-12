/**
 * Offline smoke test of the whole loop on an in-memory database:
 * seed, replay every fixture, approve the hero incident, replay the expansion.
 * PayPal calls are only made when credentials are set; otherwise refunds are skipped and labeled.
 *
 *   DATABASE_URL=pglite:memory:// npx tsx scripts/smoke.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, closeDb, schema } from "../src/db/client";
import { seed } from "../src/db/seed";
import { replayAll, replayFixture } from "../src/replay/replay";
import { approveIncident, buildPlan, executeIncident } from "../src/executor/execute";
import { formatUsd } from "../src/lib/money";

process.env.DATABASE_URL ||= "pglite:memory://";

const db = await getDb();
await seed();
const results = await replayAll();
for (const r of results) console.log(r.recallNumber, { matched: r.matched, nearMisses: r.nearMisses, review: r.needsReview, incidents: r.incidentIds.length, silent: r.silent });

for (const m of await db.select().from(schema.matches)) console.log(`  match ${m.decision}/${m.confidence}/${m.method}: ${m.reason}`);
for (const p of await db.select().from(schema.recallParsed))
  console.log(`  parsed upcs=${p.upcs.join(",")} lots=${p.lots.join(",")} dates=${JSON.stringify(p.dateRanges)} hazard=${p.hazardType} (${p.parserVersion})`);

const incidents = await db.select().from(schema.incidents);
for (const i of incidents) {
  const b = i.brief as { title: string; summary: string; briefSource: string; hazardSource: string; noticeSource: string; hazardExplanation: string; notice: { body: string } };
  console.log(`- [${i.severity}/${i.status}] ${b.title} total ${formatUsd(i.totalRefundCents)}`);
  console.log(`  sources: brief=${b.briefSource} hazard=${b.hazardSource} notice=${b.noticeSource}`);
  if (process.env.SMOKE_VERBOSE) console.log(`  summary: ${b.summary}\n  hazard: ${b.hazardExplanation}\n  notice:\n${b.notice.body}`);
}

const hero = incidents.find((i) => i.status === "awaiting_owner");
if (hero) {
  const plan = await buildPlan(hero.id);
  console.log("plan:", { refunds: plan.refunds.length, caps: plan.caps, notices: plan.notices.length, totals: plan.totals });
  console.log(await approveIncident(hero.id));
  console.log(await executeIncident(hero.id));
  console.log("second run:", await executeIncident(hero.id));
  const acts = await db.select().from(schema.actions).where(eq(schema.actions.incidentId, hero.id));
  const by = acts.reduce<Record<string, number>>((m, a) => ((m[`${a.type}:${a.status}`] = (m[`${a.type}:${a.status}`] ?? 0) + 1), m), {});
  console.log("actions:", by);
}

const exp = await replayFixture("06-hero-expansion.json");
console.log("expansion:", exp);
for (const i of await db.select().from(schema.incidents).where(eq(schema.incidents.status, "awaiting_owner"))) {
  console.log(`- child=${Boolean(i.parentIncidentId)} ${(i.brief as { title: string }).title}`);
}
await closeDb();
