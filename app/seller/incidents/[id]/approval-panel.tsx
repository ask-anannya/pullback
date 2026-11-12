"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Preview = {
  refunds: { orderId: string; customer: string; amount: string; path: "refund" | "dispute_accept" | "skip"; note?: string;
    dispute?: { id: string; reason: string; aboutProduct: boolean; asked: string | null; status: string } }[];
  notices: number;
  sampleNotice: { to: string; subject: string; body: string } | null;
  listingFlag: string | null;
  disputeAccepts: number;
  disputeEvidence: number;
  caps: string | null;
  total: string;
  realTotal: string;
  skipped: number;
};

type Progress = { status: string; statusReason: string | null; counts: Record<string, number> };

const PATH_LABEL = { refund: "PayPal refund", dispute_accept: "Accept open dispute", skip: "Skipped" };

export function ApprovalPanel({ incidentId, initialStatus, preview }: { incidentId: string; initialStatus: string; preview: Preview }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [pending, start] = useTransition();

  const running = status === "approved" || status === "executing";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/incidents/${incidentId}/status`, { cache: "no-store" });
      if (!r.ok) return;
      const p: Progress = await r.json();
      setProgress(p);
      setStatus(p.status);
      router.refresh();
    }, 1000);
    return () => clearInterval(t);
  }, [running, incidentId, router]);

  async function post(action: "approve" | "decline" | "retry") {
    setError(null);
    const r = await fetch(`/api/incidents/${incidentId}/${action}`, { method: "POST" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(body.error ?? "Request failed");
      return;
    }
    setStatus(body.status ?? status);
    start(() => router.refresh());
  }

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold">Your decision</h2>

      <div className="rounded-lg bg-paper p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Refunds</span>
          <span className="font-medium tabular-nums">{preview.refunds.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Real PayPal refund total</span>
          <span className="font-medium tabular-nums">{preview.realTotal}</span>
        </div>
        {preview.skipped > 0 && (
          <div className="flex justify-between text-muted">
            <span>Skipped (no refund needed or possible)</span>
            <span className="tabular-nums">{preview.skipped}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Customer notices</span>
          <span className="font-medium tabular-nums">{preview.notices}</span>
        </div>
        {preview.disputeAccepts + preview.disputeEvidence > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Disputes resolved</span>
            <span className="font-medium tabular-nums">{preview.disputeAccepts + preview.disputeEvidence}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Flag listing</span>
          <span className="font-medium">{preview.listingFlag ? "Yes" : "No"}</span>
        </div>
      </div>

      {preview.caps && <p className="rounded-lg bg-urgent-soft p-3 text-sm text-urgent">{preview.caps}</p>}

      {status === "awaiting_owner" && (
        <>
          <button className="btn btn-ghost w-full" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? "Hide preview" : "Preview exactly what will happen"}
          </button>
          {showPreview && (
            <div className="max-h-96 space-y-3 overflow-auto rounded-lg border border-line p-3 text-xs">
              <ul className="space-y-1">
                {preview.refunds.map((r, k) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span>
                      <span className="font-mono">{r.orderId}</span> {r.customer}
                      <span className="block text-muted">{r.path === "skip" && r.note ? `Skipped: ${r.note}` : r.note ? `${PATH_LABEL[r.path]}: ${r.note}` : PATH_LABEL[r.path]}</span>
                      {r.dispute && (
                        <span className={`block ${r.dispute.aboutProduct ? "text-muted" : "text-standard"}`}>
                          Buyer&apos;s dispute reason: <span className="font-medium">{r.dispute.reason}</span>
                          {r.dispute.asked ? `, asked for ${r.dispute.asked}` : ""} ({r.dispute.status})
                          {!r.dispute.aboutProduct && ". Not about the product itself; check it before approving."}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{r.amount}</span>
                  </li>
                ))}
              </ul>
              {preview.sampleNotice && (
                <div className="rounded border border-line bg-paper p-2">
                  <div className="text-muted">To: {preview.sampleNotice.to}</div>
                  <div className="font-medium">{preview.sampleNotice.subject}</div>
                  <pre className="mt-1 whitespace-pre-wrap font-sans">{preview.sampleNotice.body}</pre>
                </div>
              )}
              <p className="text-muted">No PayPal call is made until you approve.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1" disabled={pending || Boolean(preview.caps)} onClick={() => post("approve")}>
              Approve
            </button>
            <button className="btn btn-ghost" disabled={pending} onClick={() => post("decline")}>
              Decline
            </button>
          </div>
        </>
      )}

      {running && (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 font-medium text-accent">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" /> Running PayPal actions
          </div>
          {progress && (
            <ul className="text-xs text-muted">
              {Object.entries(progress.counts).map(([k, v]) => (
                <li key={k}>
                  {k.replace(":", " ")}: {v}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status === "done" && <p className="rounded-lg bg-good-soft p-3 text-sm text-good">Done. Refunds issued, notices sent, everything recorded in the activity log.</p>}
      {status === "declined" && <p className="text-sm text-muted">Declined. Nothing was paid out. The decision is logged.</p>}
      {status === "logged_only" && <p className="text-sm text-muted">Low severity: logged for your records. No action is needed.</p>}
      {status === "failed" && (
        <button className="btn btn-primary w-full" disabled={pending} onClick={() => post("retry")}>
          Retry failed actions (same idempotency keys)
        </button>
      )}
      {error && <p className="text-sm text-urgent">{error}</p>}
    </section>
  );
}
