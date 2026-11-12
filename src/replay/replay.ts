import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/audit/log";
import { loadFixture, listFixtures } from "@/recalls/fixtures";
import { ingestAndProcess } from "@/pipeline/process-recall";

/** Inject a fixture as a newly ingested recall and run the pipeline. */
export async function replayFixture(file: string) {
  const fx = loadFixture(file);
  await audit({ actor: "owner", eventType: "replay_started", payload: { fixture: fx.file, recallNumber: fx.record.recall_number, isSimulated: fx.is_simulated } });
  return ingestAndProcess(fx.record, { isSimulated: fx.is_simulated, sourceUrl: fx.source_url });
}

/** Replay every non-expansion fixture, in file order. */
export async function replayAll() {
  const out = [];
  for (const fx of listFixtures().filter((f) => f.kind !== "expansion")) out.push(await replayFixture(fx.file));
  return out;
}

/**
 * Reset demo: clears incidents, actions, notices and replayed recalls so a take can be recorded again.
 * It never reverses real sandbox refunds, and it keeps order_items.refunded_cents, so items that were
 * really refunded are not refunded again. Seed fresh sandbox orders for a full retake.
 */
export async function resetDemo() {
  const db = await getDb();
  await db.delete(schema.notices);
  await db.delete(schema.actions);
  await db.delete(schema.affectedItems);
  await db.delete(schema.incidents);
  await db.delete(schema.matches);
  await db.delete(schema.recallParsed);
  await db.delete(schema.recalls);
  const flagged = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.listingStatus, "flagged"));
  if (flagged.length) await db.update(schema.products).set({ listingStatus: "active" }).where(inArray(schema.products.id, flagged.map((f) => f.id)));
  await audit({ actor: "owner", eventType: "demo_reset", payload: { note: "Sandbox refunds were not reversed." } });
}
