import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";

import { MIGRATIONS } from "../../scripts/migrate-neon.mjs";

test("every migration on disk is in the migrate script allowlist", () => {
  const onDisk = readdirSync(new URL("../../neon/migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort();
  assert.deepEqual([...MIGRATIONS].sort(), onDisk);
});
