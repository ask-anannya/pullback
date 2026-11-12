import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { executeIncident } from "@/executor/execute";
import { audit } from "@/audit/log";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const inc = (await db.select({ status: schema.incidents.status }).from(schema.incidents).where(eq(schema.incidents.id, id)))[0];
  if (inc?.status !== "failed") return NextResponse.json({ error: "Only failed incidents can be retried." }, { status: 409 });
  await audit({ actor: "owner", eventType: "execution_retry_requested", incidentId: id, payload: {} });
  after(() => executeIncident(id));
  return NextResponse.json({ status: "executing" });
}
