import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const inc = (await db.select({ status: schema.incidents.status, statusReason: schema.incidents.statusReason }).from(schema.incidents).where(eq(schema.incidents.id, id)))[0];
  if (!inc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const acts = await db.select({ type: schema.actions.type, status: schema.actions.status }).from(schema.actions).where(eq(schema.actions.incidentId, id));
  const counts: Record<string, number> = {};
  for (const a of acts) counts[`${a.type}:${a.status}`] = (counts[`${a.type}:${a.status}`] ?? 0) + 1;
  return NextResponse.json({ ...inc, counts });
}
