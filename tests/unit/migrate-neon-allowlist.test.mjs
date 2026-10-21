import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

import { MIGRATIONS, assertMigrationTarget } from "../../scripts/migrate-neon.mjs";

test("every migration on disk is in the migrate script allowlist", () => {
  const onDisk = readdirSync(new URL("../../neon/migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual([...MIGRATIONS].sort(), onDisk);
});
test('inquiry workflow migration rejects Neon before opening any connection',()=>{
  assert.throws(()=>assertMigrationTarget('009_inquiry_workflow.sql',{driver:'neon',url:'postgresql://example.neon.tech/db'}));
  assert.throws(()=>assertMigrationTarget('009_inquiry_workflow.sql',{driver:'postgres',url:'postgresql://example.neon.tech/db'}));
  assert.doesNotThrow(()=>assertMigrationTarget('009_inquiry_workflow.sql',{driver:'postgres',url:'postgresql://postgres:5432/platform_live_test'}));
});
