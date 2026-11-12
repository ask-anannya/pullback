const SEV: Record<string, string> = {
  urgent: "bg-urgent-soft text-urgent",
  standard: "bg-standard-soft text-standard",
  low: "bg-low-soft text-low",
};

export function SeverityPill({ severity }: { severity: string }) {
  return <span className={`pill ${SEV[severity] ?? SEV.low}`}>{severity}</span>;
}

const STATUS: Record<string, [string, string]> = {
  awaiting_owner: ["Awaiting your approval", "bg-standard-soft text-standard"],
  approved: ["Approved", "bg-accent-soft text-accent"],
  executing: ["Running", "bg-accent-soft text-accent"],
  done: ["Done", "bg-good-soft text-good"],
  failed: ["Needs retry", "bg-urgent-soft text-urgent"],
  declined: ["Declined", "bg-low-soft text-low"],
  logged_only: ["Logged only", "bg-low-soft text-low"],
};

export function StatusPill({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, "bg-low-soft text-low"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

const RESULT: Record<string, string> = {
  match: "bg-good-soft text-good",
  partial: "bg-standard-soft text-standard",
  mismatch: "bg-urgent-soft text-urgent",
  missing: "bg-low-soft text-low",
  succeeded: "bg-good-soft text-good",
  skipped: "bg-low-soft text-low",
  failed: "bg-urgent-soft text-urgent",
  sent: "bg-accent-soft text-accent",
  pending: "bg-standard-soft text-standard",
  planned: "bg-low-soft text-low",
};

export function ResultPill({ result }: { result: string }) {
  return <span className={`pill ${RESULT[result] ?? RESULT.missing}`}>{result}</span>;
}

export function SourceTag({ source }: { source: "ai" | "template" }) {
  return (
    <span className="pill bg-low-soft text-low" title={source === "ai" ? "Written by Gemini" : "Template used because the AI was unavailable"}>
      {source === "ai" ? "AI written" : "Template"}
    </span>
  );
}
