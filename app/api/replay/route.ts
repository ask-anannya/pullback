import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { replayAll, replayFixture, resetDemo } from "@/replay/replay";

const Body = z.object({
  action: z.enum(["replay", "replay_all", "reset"]),
  fixture: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, fixture } = parsed.data;
  try {
    if (action === "reset") {
      await resetDemo();
      return NextResponse.json({ ok: true });
    }
    if (action === "replay_all") return NextResponse.json({ results: await replayAll() });
    if (!fixture) return NextResponse.json({ error: "fixture is required" }, { status: 400 });
    return NextResponse.json({ results: [await replayFixture(fixture)] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
