"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = { recallNumber: string; change: string; matched: string[]; nearMisses: string[]; needsReview: string[]; incidentIds: string[]; silent: boolean };

function describe(r: Result): string {
  if (r.change === "unchanged") return `${r.recallNumber}: already processed, nothing changed.`;
  const parts = [`${r.recallNumber}`];
  if (r.matched.length) parts.push(`matched ${r.matched.join(", ")}`);
  if (r.nearMisses.length) parts.push(`near-miss ignored (${r.nearMisses.join(", ")})`);
  if (r.needsReview.length) parts.push(`needs review: ${r.needsReview.join(", ")}`);
  if (r.silent) parts.push("not sold here, stayed silent");
  return parts.join(": ") + ".";
}

const NEAR_MISSES = ["02-near-miss-lot.json", "03-near-miss-brand.json", "04-unrelated.json", "05-class-iii.json"];

/** One card that runs every recall check the demo needs, without leaving the overview. */
export function RecallCheck({ runDailyIngest }: { runDailyIngest: () => Promise<string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ text: string; incidentIds: string[] }[]>([]);

  async function replay(key: string, fixtures: string[]) {
    setBusy(key);
    try {
      const out: { text: string; incidentIds: string[] }[] = [];
      for (const fixture of fixtures) {
        const r = await fetch("/api/replay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "replay", fixture }) });
        const j = await r.json();
        if (!r.ok) out.push({ text: `Error: ${j.error}`, incidentIds: [] });
        else for (const res of j.results as Result[]) out.push({ text: describe(res), incidentIds: res.incidentIds });
      }
      setLog((l) => [...out.reverse(), ...l]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function live() {
    setBusy("live");
    try {
      const msg = await runDailyIngest();
      setLog((l) => [{ text: msg, incidentIds: [] }, ...l]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!confirm("Clear incidents, notices and replayed recalls? Orders and real sandbox refunds are kept.")) return;
    setBusy("reset");
    try {
      await fetch("/api/replay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset" }) });
      setLog([{ text: "Demo reset. Orders kept; sandbox refunds are never reversed.", incidentIds: [] }]);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const btn = "btn btn-ghost justify-start text-left";
  return (
    <section className="card space-y-4">
      <div>
        <h2 className="font-semibold">Run a recall check</h2>
        <p className="mt-1 text-sm text-muted">Pullback runs this every morning against the FDA feed. Run it now, or replay a real recall from the demo set.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn btn-primary justify-start text-left" disabled={busy !== null} onClick={() => replay("hero", ["01-hero-match.json"])}>
          {busy === "hero" ? "Checking" : "Check for disputes"}
        </button>
        <button className={btn} disabled={busy !== null} onClick={live}>
          {busy === "live" ? "Checking openFDA" : "Check the live FDA feed (last 30 days)"}
        </button>
        <button className={btn} disabled={busy !== null} onClick={() => replay("near", NEAR_MISSES)}>
          {busy === "near" ? "Checking" : "Replay near-misses and unrelated recalls"}
        </button>
        <button className={btn} disabled={busy !== null} onClick={() => replay("exp", ["06-hero-expansion.json"])}>
          {busy === "exp" ? "Checking" : "Replay lot expansion (simulated)"}
        </button>
      </div>
      {log.length > 0 && (
        <ul className="space-y-2 rounded-lg bg-paper p-3 text-sm">
          {log.map((l, k) => (
            <li key={k} className="flex flex-wrap items-center justify-between gap-2">
              <span>{l.text}</span>
              {l.incidentIds.map((id) => (
                <Link key={id} href={`/seller/incidents/${id}`} className="btn btn-primary !py-1 text-xs">
                  Open incident
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-2 text-xs text-muted">
        <Link href="/seller/replay" className="underline">
          All demo recalls
        </Link>
        <button className="underline disabled:opacity-50" disabled={busy !== null} onClick={reset}>
          Reset demo
        </button>
      </div>
    </section>
  );
}
