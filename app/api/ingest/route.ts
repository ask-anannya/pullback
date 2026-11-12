import { NextResponse } from "next/server";
import { dailyIngest } from "@/jobs/daily-ingest";

export const maxDuration = 300;

/** Runs the daily openFDA ingest. If CRON_SECRET is set, require it as a bearer token. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await dailyIngest());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
