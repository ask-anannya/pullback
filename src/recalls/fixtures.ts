import fs from "node:fs";
import path from "node:path";
import * as z from "zod/v4";
import { OpenFdaRecall } from "./openfda";

export const Fixture = z.object({
  kind: z.enum(["true_match", "near_miss", "unrelated", "class_iii", "expansion"]),
  label: z.string(),
  is_simulated: z.boolean(),
  source_url: z.string(),
  record: OpenFdaRecall,
});
export type Fixture = z.infer<typeof Fixture> & { file: string };

const DIR = path.join(process.cwd(), "fixtures", "recalls");

export function listFixtures(): Fixture[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ ...Fixture.parse(JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"))), file }));
}

export function loadFixture(file: string): Fixture {
  const safe = path.basename(file);
  const full = path.join(DIR, safe);
  if (!safe.endsWith(".json") || !fs.existsSync(full)) throw new Error(`Unknown fixture: ${safe}`);
  return { ...Fixture.parse(JSON.parse(fs.readFileSync(full, "utf8"))), file: safe };
}
