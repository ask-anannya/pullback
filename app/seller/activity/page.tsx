import { getActivity } from "@/queries";
import { fmtDateTime } from "../../_components/format";

export const dynamic = "force-dynamic";

function summarize(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "paypal_call": {
      const err = p.error as { name?: string; message?: string; details?: { issue?: string; description?: string; field?: string }[] } | undefined;
      const why = err
        ? `: ${[err.name, ...(err.details ?? []).map((d) => [d.field, d.issue, d.description].filter(Boolean).join(" "))].filter(Boolean).join("; ") || err.message || ""}`
        : "";
      return `${p.method} ${p.path} → ${p.status}${p.debugId ? ` (debug ${p.debugId})` : ""}${why}`;
    }
    case "llm_call":
      return `${p.promptVersion} on ${p.model}: ${p.valid ? "valid" : "rejected"}${p.totalTokens ? `, ${p.totalTokens} tokens` : ""}`;
    case "near_miss_ignored":
      return `${p.recallNumber}: ${p.product}. ${p.reason}`;
    case "recall_checked_no_match":
      return `${p.recallNumber}: checked ${p.productsChecked} products, no match`;
    case "incident_opened":
    case "incident_logged_only":
    case "incident_expansion_opened":
      return `${p.recallNumber}: ${p.product}, ${p.affected} of ${p.checked} orders (${p.severity})`;
    default: {
      const s = JSON.stringify(p);
      return s.length > 160 ? s.slice(0, 160) + "…" : s;
    }
  }
}

export default async function ActivityPage() {
  const { events, nearMisses } = await getActivity();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted">Every agent decision, owner action, PayPal call and notice. Append-only.</p>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">Ignored near-misses</h2>
        {nearMisses.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {nearMisses.map((n, k) => (
              <li key={k}>
                <span className="font-mono text-xs text-muted">{n.recall}</span> <span className="font-medium">{n.product}</span>: {n.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Event</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(e.at)}</td>
                <td className="text-xs">{e.actor}</td>
                <td className="whitespace-nowrap text-xs font-medium">{e.eventType.replaceAll("_", " ")}</td>
                <td className="break-all text-xs text-muted">{summarize(e.eventType, e.payload as Record<string, unknown>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
