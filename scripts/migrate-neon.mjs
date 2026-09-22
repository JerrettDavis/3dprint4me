import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const migration = process.argv[2] || "001_service_requests.sql";
if (!["001_service_requests.sql", "002_quick_inquiries.sql", "003_work_queue.sql"].includes(migration)) throw new Error("Unknown migration.");
const statements = (await readFile(new URL(`../neon/migrations/${migration}`, import.meta.url), "utf8"))
  .replace(/^\s*--.*$/gm, "").split(";").map(statement => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
await sql.transaction(statements.map(statement => sql.query(statement)));
console.log(`Applied ${statements.length} Neon schema statements.`);
