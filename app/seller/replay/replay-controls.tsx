"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Fx = { file: string; kind: string; label: string; isSimulated: boolean; recallNumber: string; product: string; sourceUrl: string };
type Result = { recallNumber: string; change: string; matched: string[]; nearMisses: string[]; needsReview: string[]; incidentIds: string[]; silent: boolean };

const KIND: Record<string, string> = {
  true_match: "True match",
  near_miss: "Near-miss",
  unrelated: "Unrelated",
  class_iii: "Class III",
  expansion: "Expansion",
};

export function ReplayControls({ fixtures, runDailyIngest }: { fixtures: Fx[]; runDailyIngest: () => Promise<string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  function describe(r: Result): string {
    if (r.change === "unchanged") return `${r.recallNumber}: already processed, nothing changed.`;
    const parts = [`${r.recallNumber} (${r.change})`];
    if (r.matched.length) parts.push(`matched ${r.matched.join(", ")}`);
    if (r.nearMisses.length) parts.push(`near-miss ignored: ${r.nearMisses.join(", ")}`);
    if (r.needsReview.length) parts.push(`needs review: ${r.needsReview.join(", ")}`);
    if (r.silent) parts.push("no match, stayed silent");
    if (r.incidentIds.length) parts.push(`${r.incidentIds.length} incident(s) opened`);
    return parts.join(". ") + ".";
  }

  async function call(key: string, body: object) {
    setBusy(key);
    try {
      const r = await fetch("/api/replay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) setLog((l) => [`Error: ${j.error}`, ...l]);
      else if (j.results) setLog((l) => [...(j.results as Result[]).map(describe).reverse(), ...l]);
      else setLog((l) => ["Demo reset. Sandbox refunds were not reversed.", ...l]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {fixtures.map((f) => (
          <div key={f.file} className="card flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="pill bg-accent-soft text-accent">{KIND[f.kind] ?? f.kind}</span>
                {f.isSimulated && <span className="pill bg-standard-soft text-standard">Simulated for demo</span>}
                <a className="font-mono text-xs text-muted underline" href={f.sourceUrl} target="_blank" rel="noreferrer">
                  {f.recallNumber}
                </a>
              </div>
              <div className="mt-2 text-sm font-medium">{f.product}</div>
              <div className="mt-1 text-xs text-muted">{f.label}</div>
            </div>
            <button className="btn btn-primary shrink-0" disabled={busy !== null} onClick={() => call(f.file, { action: "replay", fixture: f.file })}>
              {busy === f.file ? "Running" : f.kind === "expansion" ? "Replay expansion" : "Replay"}
            </button>
          </div>
        ))}
      </div>
      <aside className="space-y-3">
        <div className="card space-y-2">
          <button className="btn btn-primary w-full" disabled={busy !== null} onClick={() => call("all", { action: "replay_all" })}>
            {busy === "all" ? "Running" : "Replay all (except expansion)"}
          </button>
          <button
            className="btn btn-ghost w-full"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("ingest");
              const msg = await runDailyIngest();
              setLog((l) => [msg, ...l]);
              setBusy(null);
              router.refresh();
            }}
          >
            {busy === "ingest" ? "Checking openFDA" : "Run today's live openFDA check"}
          </button>
          <button className="btn btn-ghost w-full" disabled={busy !== null} onClick={() => call("reset", { action: "reset" })}>
            Reset demo
          </button>
          <p className="text-xs text-muted">Reset clears incidents, actions, notices and replayed recalls. It never reverses real sandbox refunds.</p>
        </div>
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold">Results</h2>
          {log.length === 0 ? (
            <p className="text-xs text-muted">Nothing run yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {log.map((l, k) => (
                <li key={k}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
