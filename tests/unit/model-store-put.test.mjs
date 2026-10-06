import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBlobModelStore } from "../../lib/print-estimation/adapters/blob-model-store.js";
import { createLocalFileStore } from "../../lib/print-estimation/adapters/local-file-store.js";

const path = `print-estimates/est_${"a".repeat(32)}/abcdef0123-part1.stl`;

test("local store writes once and refuses to overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "pack-store-"));
  try {
    const store = createLocalFileStore({ root, origin: "http://127.0.0.1:4173" });
    await store.put(path, new Uint8Array([1, 2, 3]));
    assert.deepEqual([...await store.read(path, 100)], [1, 2, 3]);
    await assert.rejects(store.put(path, new Uint8Array([9])));
    await assert.rejects(store.put("../escape.stl", new Uint8Array([1])));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blob store delegates put to the private Blob writer", async () => {
  const calls = [];
  const store = createBlobModelStore({ store: { putPrivateObject: async (...args) => { calls.push(args); } } });
  await store.put(path, new Uint8Array([7]));
  assert.deepEqual(calls, [[path, new Uint8Array([7])]]);
});
