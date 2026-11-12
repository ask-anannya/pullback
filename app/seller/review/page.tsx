import Link from "next/link";
import { getReview } from "@/queries";
import { ResultPill } from "../../_components/pills";
import { fmtDate, shortId } from "../../_components/format";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { matches, items } = await getReview();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Needs review</h1>
        <p className="mt-1 text-sm text-muted">Uncertain matches and items Pullback could not decide. Nothing on this list is ever refunded automatically.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Uncertain matches</h2>
        {matches.length === 0 && <div className="card text-muted">None.</div>}
        {matches.map((m) => (
          <div key={m.id} className="card space-y-2">
            <div className="font-medium">
              {m.product} <span className="text-muted">vs</span> {m.recall}
            </div>
            <p className="text-sm text-muted">{m.recallDesc}</p>
            <p className="text-sm">{m.reason}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {m.evidence.map((e, k) => (
                <span key={k} className="flex items-center gap-1">
                  {e.field} <ResultPill result={e.result} />
                </span>
              ))}
            </div>
            <div className="text-xs text-muted">{fmtDate(m.createdAt)}</div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Undecided order items</h2>
        {items.length === 0 ? (
          <div className="card text-muted">None.</div>
        ) : (
          <div className="card">
            <table className="data">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Order</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.orderItemId}>
                    <td>
                      <Link className="text-accent underline" href={`/seller/incidents/${i.incidentId}`}>
                        {i.title}
                      </Link>
                    </td>
                    <td className="font-mono text-xs">{shortId(i.orderId)}</td>
                    <td>{i.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
