import Link from "next/link";
import { getOverview, getRecentOrders } from "@/queries";
import { SHOPPER } from "@/shop/shopper";
import { RecallCheck } from "./recall-check";
import { LabelCheck } from "./label-check";
import { runDailyIngest } from "./replay/actions";
import { formatUsd } from "@/lib/money";
import { SeverityPill, StatusPill } from "../_components/pills";
import { fmtDate, fmtDuration } from "../_components/format";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const o = await getOverview();
  const recent = await getRecentOrders(6);
  if (!o.store) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold">No store yet</h1>
        <p className="mt-2 text-muted">
          Run <code>npm run seed</code> to create the demo store, then <code>npm run seed:paypal</code> to attach real sandbox payments.
        </p>
      </div>
    );
  }

  const open = o.incidents.filter((i) => ["awaiting_owner", "approved", "executing", "failed"].includes(i.status));
  const closed = o.incidents.filter((i) => !open.includes(i));

  const tally = [
    { label: "Orders checked", value: o.ordersChecked.toLocaleString() },
    { label: "Recalls checked", value: o.recallsChecked.toLocaleString() },
    { label: "Incidents", value: o.incidents.length.toLocaleString() },
    { label: "Orders affected", value: o.ordersAffected.toLocaleString() },
    { label: "Refunded", value: formatUsd(o.refundedCents) },
    { label: "Recall to refund", value: o.fastestMs === null ? "n/a" : fmtDuration(o.fastestMs) },
  ];

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-muted">{o.store.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {open.length ? `${open.length} recall${open.length === 1 ? "" : "s"} need${open.length === 1 ? "s" : ""} your attention` : "All clear"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Store profile built from {o.realSandboxOrders.toLocaleString()} PayPal sandbox orders and {(o.ordersChecked - o.realSandboxOrders).toLocaleString()} simulated orders.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {tally.map((t) => (
          <div key={t.label} className="card !p-4">
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{t.value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          <RecallCheck runDailyIngest={runDailyIngest} />
        </div>
        <div className="card min-w-0 lg:col-span-2">
          <h2 className="font-semibold">Recent orders</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium">
                    {r.customer}
                    {r.email === SHOPPER.email && <span className="pill ml-2 bg-accent-soft text-accent">storefront</span>}
                  </div>
                  <div className="truncate text-xs text-muted">{r.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="tabular-nums">{formatUsd(r.totalCents)}</div>
                  <div className="text-xs text-muted">{r.isRealSandbox ? "PayPal sandbox" : "simulated"} · {fmtDate(r.orderedAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <LabelCheck />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Open incidents</h2>
        {open.length === 0 ? (
          <div className="card text-muted">
            Nothing matched your store. Pullback checks the FDA recall feed every day and stays quiet unless a recall matches something you sold.
          </div>
        ) : (
          open.map((i) => <IncidentRow key={i.id} i={i} />)
        )}
      </section>

      {closed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">History</h2>
          {closed.map((i) => (
            <IncidentRow key={i.id} i={i} />
          ))}
        </section>
      )}
    </div>
  );
}

function IncidentRow({ i }: { i: Awaited<ReturnType<typeof getOverview>>["incidents"][number] }) {
  return (
    <Link href={`/seller/incidents/${i.id}`} className="card flex items-center justify-between gap-4 hover:border-accent">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <SeverityPill severity={i.severity} />
          <StatusPill status={i.status} />
          {i.parentIncidentId && <span className="pill bg-accent-soft text-accent">Expansion</span>}
          {i.brief.recall.isSimulated && <span className="pill bg-standard-soft text-standard">Simulated recall</span>}
        </div>
        <div className="mt-2 truncate font-medium">{i.brief.title}</div>
        <div className="mt-0.5 text-sm text-muted">
          {i.brief.recall.number} · {i.brief.recall.firm} · opened {fmtDate(i.createdAt)}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold tabular-nums">{formatUsd(i.totalRefundCents)}</div>
        <div className="text-xs text-muted">
          {i.affectedOrderCount} of {i.checkedOrderCount} orders
        </div>
      </div>
    </Link>
  );
}
