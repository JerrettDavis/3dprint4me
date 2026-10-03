import assert from "node:assert/strict";
import test from "node:test";
import { writeHandoff } from "../../customizer/framework/handoff.js";
import { takeHandoff } from "../../public/assets/js/order/customize-handoff.js";
import { continueToOrder, ORDER_FALLBACK_URL, ORDER_URL } from "../../customizer/framework/continue.js";

// A minimal in-memory IndexedDB double: open/upgrade, one object store, put/get/delete,
// requests that resolve asynchronously, and transactions that complete after their requests.
function fakeIndexedDB({ failOpen = false } = {}) {
  const databases = new Map();
  const later = fn => setTimeout(fn, 0);
  return {
    databases,
    open(name, version) {
      const request = {};
      later(() => {
        if (failOpen) { request.error = new Error("blocked"); request.onerror?.(); return; }
        let db = databases.get(name);
        const isNew = !db;
        if (isNew) {
          db = { version, stores: new Map() };
          databases.set(name, db);
        }
        const handle = {
          createObjectStore(store) { db.stores.set(store, new Map()); },
          close() { handle.closed = true; },
          transaction(store, mode) {
            const data = db.stores.get(store);
            const tx = {};
            const pending = [];
            const make = run => { const r = {}; pending.push(() => { r.result = run(); }); return r; };
            tx.objectStore = () => ({
              put: (value, key) => { assert.equal(mode, "readwrite"); return make(() => { data.set(key, structuredClone(value)); return key; }); },
              get: key => make(() => data.get(key)),
              delete: key => { assert.equal(mode, "readwrite"); return make(() => { data.delete(key); }); }
            });
            later(() => { for (const step of pending) step(); tx.oncomplete?.(); });
            return tx;
          }
        };
        request.result = handle;
        if (isNew) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };
}

const record = () => ({ file: new Blob([new Uint8Array([80, 75, 3, 4])], { type: "model/3mf" }), filename: "route-shield.3mf", generatorId: "route-shield", generatorVersion: 1, generatorTitle: "Route shield", params: { top_text: "ROUTE" } });

test("write then take returns the record once; a second take returns null", async () => {
  const indexedDB = fakeIndexedDB();
  await writeHandoff(record(), { indexedDB, now: () => 1_000 });
  const taken = await takeHandoff({ indexedDB, now: () => 2_000 });
  assert.equal(taken.filename, "route-shield.3mf");
  assert.equal(taken.generatorId, "route-shield");
  assert.equal(taken.createdAt, 1_000);
  assert.deepEqual([...new Uint8Array(await taken.file.arrayBuffer())], [80, 75, 3, 4]);
  assert.equal(await takeHandoff({ indexedDB, now: () => 3_000 }), null);
});

test("a record older than 30 minutes is discarded (and deleted)", async () => {
  const indexedDB = fakeIndexedDB();
  await writeHandoff(record(), { indexedDB, now: () => 0 });
  assert.equal(await takeHandoff({ indexedDB, now: () => 31 * 60 * 1000 }), null);
  await writeHandoff(record(), { indexedDB, now: () => 0 });
  assert.notEqual(await takeHandoff({ indexedDB, now: () => 30 * 60 * 1000 }), null);
});

test("a malformed record is ignored", async () => {
  const indexedDB = fakeIndexedDB();
  await writeHandoff({ ...record(), file: "not a blob" }, { indexedDB, now: () => 0 });
  assert.equal(await takeHandoff({ indexedDB, now: () => 1 }), null);
  await writeHandoff({ ...record(), filename: "evil.exe" }, { indexedDB, now: () => 0 });
  assert.equal(await takeHandoff({ indexedDB, now: () => 1 }), null);
});

test("take with nothing written is null; an unavailable IndexedDB rejects the writer and reads as null", async () => {
  assert.equal(await takeHandoff({ indexedDB: fakeIndexedDB(), now: () => 0 }), null);
  await assert.rejects(() => writeHandoff(record(), { indexedDB: undefined }));
  await assert.rejects(() => writeHandoff(record(), { indexedDB: fakeIndexedDB({ failOpen: true }) }));
  assert.equal(await takeHandoff({ indexedDB: undefined }), null);
  assert.equal(await takeHandoff({ indexedDB: fakeIndexedDB({ failOpen: true }) }), null);
});

test("an open that never answers times out instead of freezing Continue", async () => {
  const silent = { open: () => ({}) };
  await assert.rejects(() => writeHandoff(record(), { indexedDB: silent, timeoutMs: 20 }), /timed out/i);
});

test("continueToOrder writes the hand-off and opens the print request", async () => {
  const calls = [];
  const payload = { ...record(), warnings: ["w"] };
  const outcome = await continueToOrder(payload, {
    writeHandoff: async value => calls.push(["write", value]),
    download: () => calls.push(["download"]),
    navigate: url => calls.push(["navigate", url])
  });
  assert.equal(outcome, "handoff");
  assert.equal(ORDER_URL, "/order.html?service=print&from=customize");
  assert.deepEqual(calls.map(([kind]) => kind), ["write", "navigate"]);
  assert.equal(calls[0][1].warnings, undefined, "warnings stay on the generator page");
  assert.equal(calls[0][1].generatorId, "route-shield");
  assert.equal(calls[1][1], ORDER_URL);
});

test("continueToOrder downloads the 3MF and explains when the hand-off is blocked", async () => {
  const calls = [];
  const payload = record();
  const outcome = await continueToOrder(payload, {
    writeHandoff: async () => { throw new Error("IndexedDB unavailable"); },
    download: (file, filename) => calls.push(["download", file, filename]),
    navigate: url => calls.push(["navigate", url])
  });
  assert.equal(outcome, "download");
  assert.deepEqual(calls.map(([kind]) => kind), ["download", "navigate"]);
  assert.equal(calls[0][1], payload.file);
  assert.equal(calls[0][2], "route-shield.3mf");
  assert.equal(calls[1][1], ORDER_FALLBACK_URL);
  assert.match(ORDER_FALLBACK_URL, /^\/order\.html\?service=print&from=customize&handoff=download$/);
});
