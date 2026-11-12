import { NextResponse, after } from "next/server";
import { approveIncident, executeIncident } from "@/executor/execute";
import { audit } from "@/audit/log";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await approveIncident(id);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  // Run PayPal actions after the response so the page can show live progress.
  after(async () => {
    try {
      await executeIncident(id);
    } catch (e) {
      await audit({ actor: "system", eventType: "execution_crashed", incidentId: id, payload: { error: String((e as Error).message ?? e) } });
    }
  });
  return NextResponse.json({ status: "approved" });
}
