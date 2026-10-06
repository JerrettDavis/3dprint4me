// Test-only: executes the real Neon migrations and adapter SQL on in-process PGlite
// (WASM Postgres), so SQL is verified without a network database or credentials.
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

import { splitStatements } from "../../scripts/migrate-neon.mjs";

export async function createMigratedDatabase(migrations = ["001_service_requests.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql"]) {
  const db = new PGlite();
  for (const name of migrations) {
    const source = await readFile(new URL(`../../neon/migrations/${name}`, import.meta.url), "utf8");
    for (const statement of splitStatements(source)) await db.query(statement);
  }
  /** Tagged-template adapter with the same contract as lib/neon.js queryNeon. */
  const query = async (strings, ...values) => {
    const text = strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, "");
    const result = await db.query(text, values.map(value => value === undefined ? null : value));
    return result.rows;
  };
  return { db, query, close: () => db.close() };
}
