import { NextResponse } from "next/server";
import { declineIncident } from "@/executor/execute";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await declineIncident(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ status: "declined" });
}
