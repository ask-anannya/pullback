"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { LabelCheck as Result } from "@/matching/label-check";

const TONE: Record<Result["verdict"], { box: string; text: string }> = {
  recalled: { box: "border-urgent bg-urgent-soft", text: "text-urgent" },
  check_code: { box: "border-standard bg-standard-soft", text: "text-standard" },
  not_this_batch: { box: "border-good bg-good-soft", text: "text-good" },
  no_recall: { box: "border-good bg-good-soft", text: "text-good" },
  not_stocked: { box: "border-line bg-low-soft", text: "text-low" },
  unreadable: { box: "border-line bg-low-soft", text: "text-low" },
};

const RESULT_STYLE: Record<string, string> = {
  match: "bg-good-soft text-good",
  partial: "bg-standard-soft text-standard",
  mismatch: "bg-urgent-soft text-urgent",
  missing: "bg-low-soft text-low",
};

/** Owner points a phone at a package; Pullback reads the label and says whether that exact package is recalled. */
export function LabelCheck() {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
  }

  async function check() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      const r = await fetch("/api/label-check", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
      if (!r.ok) setError(j.error ?? `Server error ${r.status}`);
      else setResult(j as Result);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const reading = result?.reading;
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold">Check a package on your shelf</h2>
        <p className="mt-1 text-sm text-muted">
          Take a photo of the label with the lot or best-by stamp. Pullback reads it with AI and checks that exact package against every recall it has processed.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0]);
          }}
          className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-line bg-paper text-sm text-muted hover:border-accent sm:w-40"
        >
          {preview ? <img src={preview} alt="Package photo" className="h-full w-full object-cover" /> : <span className="px-3 text-center">Tap to take or choose a photo, or drop one here</span>}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
          <div className="text-sm text-muted">
            {file ? (
              <>
                <span className="font-medium text-ink">{file.name}</span> · {(file.size / 1024).toFixed(0)} KB
              </>
            ) : (
              "No photo yet."
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!file || busy} onClick={check}>
              {busy ? "Reading the label" : "Check this package"}
            </button>
            {file && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => input.current?.click()}>
                Use another photo
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-urgent bg-urgent-soft p-3 text-sm text-urgent">{error}</div>}

      {result && reading && (
        <div className="space-y-4">
          <div className={`rounded-lg border-2 p-4 ${TONE[result.verdict].box}`}>
            <div className={`text-lg font-semibold ${TONE[result.verdict].text}`}>{result.headline}</div>
            <p className="mt-1 text-sm text-ink">{result.reason}</p>
            {result.recall && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="pill bg-white text-ink">
                  {result.recall.number} · {result.recall.classification}
                </span>
                {result.recall.isSimulated && <span className="pill bg-standard-soft text-standard">Simulated recall</span>}
                {result.recall.reason && <span className="text-muted">{result.recall.reason}</span>}
              </div>
            )}
            {result.verdict === "recalled" && result.sold && result.sold.orders > 0 && (
              <p className="mt-2 text-sm text-ink">
                You sold {result.sold.units} unit{result.sold.units === 1 ? "" : "s"} from this batch in {result.sold.orders} order{result.sold.orders === 1 ? "" : "s"}
                {result.sold.refundedOrders ? `; ${result.sold.refundedOrders} already refunded` : ""}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {result.recall?.incidentId && (
                <Link href={`/seller/incidents/${result.recall.incidentId}`} className="btn btn-primary !py-1 text-sm">
                  Open the incident
                </Link>
              )}
              {result.recall && (
                <a href={result.recall.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-ghost !py-1 text-sm">
                  FDA record
                </a>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Read from the photo</h3>
              <dl className="mt-2 divide-y divide-line rounded-lg border border-line text-sm">
                {[
                  ["Brand", reading.brand],
                  ["Product", reading.product_name],
                  ["Size", reading.size],
                  ["Barcode", reading.upc],
                  ["Lot", reading.lot_code],
                  ["Best by", reading.best_by_as_printed ? `${reading.best_by_as_printed}${reading.best_by ? ` (${reading.best_by})` : ""}` : reading.best_by],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className={`text-right font-mono ${v ? "" : "text-muted"}`}>{v ?? "not readable"}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1 text-xs text-muted">
                Legibility: {reading.legibility}
                {reading.notes ? ` · ${reading.notes}` : ""}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Your store records</h3>
              {result.product ? (
                <dl className="mt-2 divide-y divide-line rounded-lg border border-line text-sm">
                  <div className="flex justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted">Product</dt>
                    <dd className="text-right">{result.product.name}</dd>
                  </div>
                  <div className="flex justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted">Matched by</dt>
                    <dd className="text-right">{result.product.matchedBy}</dd>
                  </div>
                  <div className="flex justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted">SKU</dt>
                    <dd className="text-right font-mono">{result.product.sku}</dd>
                  </div>
                  <div className="flex justify-between gap-3 px-3 py-1.5">
                    <dt className="text-muted">Batch</dt>
                    <dd className="text-right">{result.batch?.inStoreRecords ? `${result.batch.lotCode} (on record)` : "not in your batch records"}</dd>
                  </div>
                  {result.sold && (
                    <div className="flex justify-between gap-3 px-3 py-1.5">
                      <dt className="text-muted">Sold from batch</dt>
                      <dd className="text-right">
                        {result.sold.units} units, {result.sold.orders} orders
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted">No matching product.</p>
              )}
            </div>
          </div>

          {result.evidence.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Package vs recall</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Field</th>
                      <th className="py-1 pr-3 font-medium">Recall says</th>
                      <th className="py-1 pr-3 font-medium">This package</th>
                      <th className="py-1 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.evidence.map((e) => (
                      <tr key={e.field}>
                        <td className="py-1.5 pr-3">{e.field}</td>
                        <td className="py-1.5 pr-3 text-muted">{e.recall ?? "not stated"}</td>
                        <td className="py-1.5 pr-3">{e.store ?? "n/a"}</td>
                        <td className="py-1.5">
                          <span className={`pill ${RESULT_STYLE[e.result]}`}>{e.result}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs text-muted">Checked against {result.recallsChecked} processed recall{result.recallsChecked === 1 ? "" : "s"}. Run a recall check first if this list is empty.</p>
        </div>
      )}
    </section>
  );
}
