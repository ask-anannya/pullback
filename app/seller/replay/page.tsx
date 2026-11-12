import { listFixtures } from "@/recalls/fixtures";
import { ReplayControls } from "./replay-controls";
import { runDailyIngest } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReplayPage() {
  const fixtures = listFixtures().map((f) => ({
    file: f.file,
    kind: f.kind,
    label: f.label,
    isSimulated: f.is_simulated,
    recallNumber: f.record.recall_number,
    product: f.record.product_description,
    sourceUrl: f.source_url,
  }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Replay a recall</h1>
        <p className="mt-1 text-sm text-muted">
          openFDA can lag behind real announcements by weeks, so the demo replays stored recall records through the same pipeline the daily job uses.
          Every fixture is a real openFDA record except the expansion, which is marked simulated.
        </p>
      </div>
      <ReplayControls fixtures={fixtures} runDailyIngest={runDailyIngest} />
    </div>
  );
}
