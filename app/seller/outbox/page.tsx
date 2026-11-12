import Link from "next/link";
import { getOutbox } from "@/queries";
import { fmtDateTime } from "../../_components/format";

export const dynamic = "force-dynamic";

export default async function OutboxPage() {
  const notices = await getOutbox();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Outbox</h1>
        <p className="mt-1 text-sm text-muted">Customer notices as sent. Demo customers use example.com addresses, so notices are kept here instead of being emailed.</p>
      </div>
      {notices.length === 0 && <div className="card text-muted">No notices yet.</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {notices.map((n) => (
          <article key={n.id} className="card space-y-2 text-sm">
            <div className="flex justify-between text-xs text-muted">
              <span>
                To {n.customer} &lt;{n.email}&gt;
              </span>
              <span>{fmtDateTime(n.createdAt)}</span>
            </div>
            <div className="font-medium">{n.subject}</div>
            <pre className="whitespace-pre-wrap font-sans leading-relaxed">{n.body}</pre>
            <Link href={`/seller/incidents/${n.incidentId}`} className="text-xs text-accent underline">
              View incident
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
