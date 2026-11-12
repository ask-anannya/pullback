"use server";

import { dailyIngest } from "@/jobs/daily-ingest";

export async function runDailyIngest(): Promise<string> {
  try {
    const r = await dailyIngest({ days: 30 });
    return `Checked ${r.fetched} recalls from ${r.window.from} to ${r.window.to}: ${r.new} new, ${r.changed} changed, ${r.incidents} incident(s), ${r.nearMisses} near-miss(es).`;
  } catch (e) {
    return `Daily check failed: ${(e as Error).message}`;
  }
}
