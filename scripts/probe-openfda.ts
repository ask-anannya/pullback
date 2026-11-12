/** Quick openFDA check: one 30-day query, count and one sample record. */
import { fetchRecalls } from "../src/recalls/openfda";
import { parseDeterministic } from "../src/recalls/parse";

const to = new Date();
const from = new Date(to.getTime() - 30 * 86_400_000);
const recalls = await fetchRecalls({ from, to, maxRecords: 500 });
console.log(`openFDA food enforcement, report_date ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}: ${recalls.length} record(s)`);
const s = recalls[0];
if (s) {
  console.log({ recall_number: s.recall_number, classification: s.classification, firm: s.recalling_firm, product: s.product_description.slice(0, 120), code_info: s.code_info?.slice(0, 120) });
  console.log("deterministic parse:", parseDeterministic(s));
}
