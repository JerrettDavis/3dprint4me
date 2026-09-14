import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const statements = (await readFile(new URL("../neon/migrations/001_service_requests.sql", import.meta.url), "utf8"))
  .split(";").map(statement => statement.trim()).filter(Boolean);
const sql = neon(process.env.DATABASE_URL);
for (const statement of statements) await sql.query(statement);
console.log(`Applied ${statements.length} Neon schema statements.`);
