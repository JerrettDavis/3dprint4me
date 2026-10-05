import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { createNeonWorkRepository } from "../../lib/work-management/adapters/neon-work-repository.js";

// Runs the real operator command SQL against Postgres. Mocked-query tests cannot catch
// parameter-typing failures (e.g. untyped parameters inside jsonb_build_object).
async function seededRepository() {
  const db = new PGlite();
  for (const file of ["001_service_requests.sql", "003_work_queue.sql"]) await db.exec(readFileSync(new URL(`../../neon/migrations/${file}`, import.meta.url), "utf8"));
  await db.query("INSERT INTO service_requests (id, status, service, project_title, contact_name, contact_email, payload) VALUES ('r1','submitted','print','Fixture','N','e@example.com','{}')");
  await db.query("INSERT INTO operators (id, auth_user_id, display_name) VALUES ('op_1','u1','Owner')");
  await db.query("INSERT INTO work_items (id, request_id) VALUES ('work_12345678','r1')");
  const query = async (strings, ...values) => (await db.query(strings.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values)).rows;
  return createNeonWorkRepository({ query });
}

test("every operator work command executes against Postgres and advances the revision", async () => {
  const repo = await seededRepository();
  const operator = { id: "op_1" };
  const steps = [
    [{ type: "acknowledge" }, item => assert.equal(item.acknowledged, true)],
    [{ type: "set-priority", priority: "high" }, item => assert.equal(item.priority, "high")],
    [{ type: "set-target-date", targetDate: "2026-11-01" }, item => assert.equal(item.targetDate, "2026-11-01")],
    [{ type: "add-note", body: "Check the build plate." }, () => {}],
    [{ type: "set-status", status: "triage" }, item => assert.equal(item.status, "triage")],
    [{ type: "set-status", status: "quoted" }, item => assert.equal(item.status, "quoted")],
    [{ type: "set-status", status: "approved" }, item => assert.equal(item.status, "approved")],
    [{ type: "set-status", status: "scheduled" }, item => assert.equal(item.status, "scheduled")],
    [{ type: "set-status", status: "in_progress" }, item => assert.equal(item.status, "in_progress")]
  ];
  let revision = 1;
  for (const [index, [command, check]] of steps.entries()) {
    const result = await repo.applyWorkCommand("work_12345678", { ...command, revision }, operator, `step-key-${index}-abcd`);
    revision += 1;
    assert.equal(result.item.revision, revision, command.type);
    check(result.item);
  }
});
