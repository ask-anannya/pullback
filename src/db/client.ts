import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: DB; ready?: Promise<void>; close?: () => Promise<void> };
const g = globalThis as unknown as { __pullbackDb?: Holder };
const holder: Holder = (g.__pullbackDb ??= {});

const MIGRATIONS = path.join(process.cwd(), "drizzle");

function usingPglite(): boolean {
  const url = process.env.DATABASE_URL;
  return !url || url.startsWith("pglite:");
}

async function init(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (usingPglite()) {
    // Embedded Postgres (WASM). One process at a time may open the data directory.
    const dir = url?.startsWith("pglite:") ? url.slice("pglite:".length) : path.join(process.cwd(), ".data", "pglite");
    if (dir !== "memory://") fs.mkdirSync(dir, { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(dir);
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    holder.db = db as unknown as DB;
    holder.close = () => client.close();
  } else {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url!, { max: 5, onnotice: () => {} });
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    holder.db = db as unknown as DB;
    holder.close = () => client.end();
  }
}

/** Returns the database, running migrations once per process. */
export async function getDb(): Promise<DB> {
  holder.ready ??= init();
  await holder.ready;
  return holder.db!;
}

export async function closeDb(): Promise<void> {
  if (holder.close) await holder.close();
  holder.db = undefined;
  holder.ready = undefined;
  holder.close = undefined;
}

export { schema };
