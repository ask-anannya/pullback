import { getDb, schema } from "@/db/client";

export type AuditInput = {
  actor: "agent" | "owner" | "system";
  eventType: string;
  payload?: Record<string, unknown>;
  storeId?: string | null;
  incidentId?: string | null;
};

/** Append-only audit log. Never update or delete rows in audit_events. */
export async function audit(e: AuditInput): Promise<void> {
  const db = await getDb();
  await db.insert(schema.auditEvents).values({
    actor: e.actor,
    eventType: e.eventType,
    payload: e.payload ?? {},
    storeId: e.storeId ?? null,
    incidentId: e.incidentId ?? null,
  });
}
