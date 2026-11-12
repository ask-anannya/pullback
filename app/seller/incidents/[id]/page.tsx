import Link from "next/link";
import { notFound } from "next/navigation";
import { getIncident } from "@/queries";
import { buildPlan } from "@/executor/execute";
import { syncDisputes } from "@/disputes/sync";
import { buyerRequestedCents, disputeReason } from "@/paypal/disputes";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { ResultPill, SeverityPill, SourceTag, StatusPill } from "../../../_components/pills";
import { fmtDate, fmtDateTime, shortId } from "../../../_components/format";
import { ApprovalPanel } from "./approval-panel";
import { unescapeNewlines } from "@/agents/notice-writer";

export const dynamic = "force-dynamic";

const RULE: Record<string, string> = { lot: "Lot in recall", best_by: "Best-by in recall", whole_product: "Whole product recalled" };

export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data = await getIncident(id);
  if (!data) notFound();
  // The preview must show the same dispute paths approval will take, so pull disputes first.
  // Also while a partial-refund offer waits for the buyer, so the refund shows up once they accept.
  const offerPending = data.actions.some((a) => a.status === "pending");
  if ((data.incident.status === "awaiting_owner" || offerPending) && env.paypalConfigured()) {
    await syncDisputes(data.incident.storeId);
    data = (await getIncident(id))!;
  }
  const { incident, items, actions, timeline, children, disputes } = data;
  const b = incident.brief;
  const plan = await buildPlan(id);
  const actionByItem = new Map(actions.filter((a) => a.affectedItemId).map((a) => [a.affectedItemId!, a]));
  const disputeByOrder = new Map(disputes.map((d) => [d.orderId, d]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/seller" className="text-sm text-muted hover:text-ink">
          Back to overview
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SeverityPill severity={incident.severity} />
          <StatusPill status={incident.status} />
          {incident.parentIncidentId && (
            <Link href={`/seller/incidents/${incident.parentIncidentId}`} className="pill bg-accent-soft text-accent">
              Expansion of an earlier incident
            </Link>
          )}
          {b.recall.isSimulated && <span className="pill bg-standard-soft text-standard">Simulated recall change for demo</span>}
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{b.title}</h1>
        {incident.statusReason && <p className="mt-2 rounded-lg bg-standard-soft px-3 py-2 text-sm text-standard">{incident.statusReason}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Brief</h2>
              <SourceTag source={b.briefSource} />
            </div>
            <p className="leading-relaxed">{b.summary}</p>
            <p className="font-medium">{b.recommendation}</p>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold">The recall</h2>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Recall</dt>
              <dd>
                <a href={b.recall.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  {b.recall.number}
                </a>{" "}
                ({b.recall.classification}, reported {b.recall.reportDate})
              </dd>
              <dt className="text-muted">Firm</dt>
              <dd>{b.recall.firm}</dd>
              <dt className="text-muted">Product</dt>
              <dd>{b.recall.description}</dd>
              <dt className="text-muted">Reason</dt>
              <dd>{b.recall.reason}</dd>
              <dt className="text-muted">Codes {b.expansion ? "(new)" : ""}</dt>
              <dd>{b.recall.codes}</dd>
              <dt className="text-muted">Severity</dt>
              <dd>
                <span className="font-medium capitalize">{b.severity}</span>: {b.severityResponse}
              </dd>
              <dt className="text-muted">Hazard</dt>
              <dd>
                {b.hazardExplanation} <SourceTag source={b.hazardSource} />
              </dd>
            </dl>
          </section>

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Evidence: {b.match.productName}</h2>
              <span className="text-sm text-muted">
                Confidence <span className="font-medium text-ink">{b.match.confidence}</span> by {b.match.method.replace("_", " ")}
              </span>
            </div>
            <p className="text-sm">{b.match.reason}</p>
            <table className="data">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Recall says</th>
                  <th>Your store</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {b.match.evidence.map((e, k) => (
                  <tr key={k}>
                    <td className="font-medium">{e.field}</td>
                    <td className="text-muted">{e.recall ?? "not stated"}</td>
                    <td className="text-muted">{e.store ?? "not recorded"}</td>
                    <td>
                      <ResultPill result={e.result} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold">
              {incident.affectedOrderCount} of {incident.checkedOrderCount} orders affected
              <span className="ml-2 font-normal text-muted">total {formatUsd(incident.totalRefundCents)}</span>
            </h2>
            <div className="max-h-[28rem] overflow-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Batch</th>
                    <th>Rule</th>
                    <th>Payment</th>
                    <th className="text-right">Refund</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const d = disputeByOrder.get(it.orderId);
                    // Items refunded through a dispute have no refund action of their own; show the dispute action.
                    const a =
                      actionByItem.get(it.affectedItemId) ??
                      (d ? actions.find((x) => x.type === "dispute_accept" && x.paypalRef === d.paypalDisputeId) : undefined);
                    return (
                      <tr key={it.affectedItemId}>
                        <td className="font-mono text-xs">{shortId(it.orderId)}</td>
                        <td>{fmtDate(it.orderedAt)}</td>
                        <td>{it.customer}</td>
                        <td className="text-xs">
                          {it.lot ?? "none"}
                          {it.bestBy && <div className="text-muted">best by {it.bestBy}</div>}
                        </td>
                        <td className="text-xs">{RULE[it.rule]}</td>
                        <td className="text-xs">
                          {it.isRealSandbox ? (
                            <span title={it.captureId ?? ""}>PayPal sandbox</span>
                          ) : (
                            <span className="text-muted">Simulated</span>
                          )}
                          {d && <div className="text-standard">Dispute {d.status.toLowerCase().replaceAll("_", " ")}</div>}
                        </td>
                        <td className="text-right tabular-nums">{formatUsd(it.refundCents)}</td>
                        <td>
                          {a ? <ResultPill result={a.status} /> : <span className="text-xs text-muted">not started</span>}
                          {a?.type === "dispute_accept" && <div className="text-xs text-muted">via dispute</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {b.needsReview.length > 0 && (
              <p className="text-sm text-standard">
                {b.needsReview.length} more item(s) could not be decided and are on the <Link href="/seller/review" className="underline">review list</Link>. They are never refunded automatically.
              </p>
            )}
          </section>

          {b.nearMisses.length > 0 && (
            <section className="card space-y-2">
              <h2 className="font-semibold">Ignored near-misses</h2>
              <ul className="space-y-1 text-sm">
                {b.nearMisses.map((n, k) => (
                  <li key={k}>
                    <span className="font-medium">{n.productName}</span>: <span className="text-muted">{n.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Customer notice (draft)</h2>
              <SourceTag source={b.noticeSource} />
            </div>
            <div className="rounded-lg border border-line bg-paper p-4 text-sm">
              <div className="font-medium">{b.notice.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed">{unescapeNewlines(b.notice.body)}</pre>
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <ApprovalPanel
            incidentId={incident.id}
            initialStatus={incident.status}
            preview={{
              refunds: plan.refunds.map((r) => ({
                orderId: shortId(r.orderId),
                customer: r.customerName,
                amount: formatUsd(r.amountCents),
                path: r.path,
                note: r.skipReason ?? (r.coveredByDisputeCents ? `${formatUsd(r.coveredByDisputeCents)} already refunded through dispute ${r.disputeId}; refunding the rest` : undefined),
                dispute: disputeLine(disputes.find((d) => d.paypalDisputeId === r.disputeId) ?? disputeByOrder.get(r.orderId)),
              })),
              notices: plan.notices.length,
              sampleNotice: plan.notices[0] ? { to: `${plan.notices[0].name} <${plan.notices[0].email}>`, subject: plan.notices[0].subject, body: plan.notices[0].body } : null,
              listingFlag: plan.listingFlag?.productName ?? null,
              disputeAccepts: plan.disputeAccepts.length,
              disputeEvidence: plan.disputeEvidence.length,
              caps: plan.caps.ok ? null : plan.caps.reason,
              total: formatUsd(plan.totals.refundCents),
              realTotal: formatUsd(plan.totals.realRefundCents),
              skipped: plan.totals.skippedCount,
            }}
          />

          {children.length > 0 && (
            <section className="card space-y-2">
              <h2 className="font-semibold">Later expansions</h2>
              {children.map((c) => (
                <Link key={c.id} href={`/seller/incidents/${c.id}`} className="block text-sm text-accent underline">
                  {(c.brief as { title: string }).title}
                </Link>
              ))}
            </section>
          )}

          <section className="card space-y-2">
            <h2 className="font-semibold">Timeline</h2>
            <ol className="space-y-2 text-sm">
              {timeline
                .filter((t) => t.eventType !== "llm_call")
                .map((t) => (
                  <li key={t.id} className="border-l-2 border-line pl-3">
                    <div className="text-xs text-muted">
                      {fmtDateTime(t.at)} · {t.actor}
                    </div>
                    <div>{t.eventType.replaceAll("_", " ")}</div>
                  </li>
                ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** One line for the preview: the buyer's reason as PayPal gives it, so the owner can check it fits a recall. */
function disputeLine(d: { paypalDisputeId: string; status: string; raw: unknown } | undefined) {
  if (!d) return undefined;
  const reason = disputeReason(d.raw);
  const asked = buyerRequestedCents(d.raw) ?? (() => {
    const v = (d.raw as { dispute_amount?: { value?: string } } | null)?.dispute_amount?.value;
    return v ? Math.round(Number(v) * 100) : null;
  })();
  return {
    id: d.paypalDisputeId,
    reason: reason.label,
    aboutProduct: reason.aboutProduct,
    asked: asked === null ? null : formatUsd(asked),
    status: d.status.toLowerCase().replaceAll("_", " "),
  };
}
