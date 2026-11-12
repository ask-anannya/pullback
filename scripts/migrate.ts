import "dotenv/config";
import { getDb, closeDb } from "../src/db/client";

await getDb();
console.log("Migrations applied.");
await closeDb();
