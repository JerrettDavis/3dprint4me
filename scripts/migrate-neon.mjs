import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDatabase, closeDatabase, databaseProvider } from '../lib/database.js';

export const MIGRATIONS = Object.freeze(["001_service_requests.sql", "002_quick_inquiries.sql", "003_work_queue.sql", "004_print_estimation.sql", "005_print_estimate_rate_limits.sql", "006_model_packs.sql", "007_invoicing.sql", "008_platform.sql", "009_inquiry_workflow.sql", "010_filament_matching.sql"]);

export function assertMigrationTarget(migration, {driver=databaseProvider(), url=process.env.DATABASE_URL}={}) {
  if(migration==='009_inquiry_workflow.sql'&&(driver!=='postgres'||new URL(url).hostname.endsWith('.neon.tech')))
    throw new Error('Inquiry workflow migration requires the selected native PostgreSQL target.');
}

/** Split a migration into statements, keeping $$-quoted function bodies intact. */
export function splitStatements(source) {
  const text = source.replace(/^\s*--.*$/gm, "");
  const statements = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith("$$", index)) { quoted = !quoted; current += "$$"; index++; continue; }
    const character = text[index];
    if (character === ";" && !quoted) { statements.push(current); current = ""; continue; }
    current += character;
  }
  statements.push(current);
  if (quoted) throw new Error("Unterminated $$ block in migration.");
  return statements.map(statement => statement.trim()).filter(Boolean);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const migration = process.argv[2] || "001_service_requests.sql";
  if (!MIGRATIONS.includes(migration)) throw new Error("Unknown migration.");
  assertMigrationTarget(migration);
  const statements = splitStatements(await readFile(new URL(`../neon/migrations/${migration}`, import.meta.url), "utf8"));
  try { await getDatabase().transaction(statements.map(text => ({ text }))); }
  finally { await closeDatabase(); }
  console.log(`Applied ${statements.length} database schema statements.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
