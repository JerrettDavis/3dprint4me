// Customizer -> order page hand-off writer. The reader is public/assets/js/order/customize-handoff.js;
// both use the same database, store and key (the unit test exercises the pair together).
// The record holds the built 3MF and redacted provenance only, never a sensitive value.
const HANDOFF_DB = "3dp-customize";
const HANDOFF_STORE = "handoff";
const HANDOFF_KEY = "pending";

const browserIndexedDB = () => { try { return globalThis.indexedDB; } catch { return undefined; } };

function openHandoffDb(idb, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!idb || typeof idb.open !== "function") { reject(new Error("IndexedDB is unavailable.")); return; }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("Opening IndexedDB timed out.")); } }, timeoutMs);
    const request = idb.open(HANDOFF_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDOFF_STORE);
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) { request.result.close(); return; }
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(request.error ?? new Error("IndexedDB could not be opened.")); }
    };
  });
}

function handoffTransaction(db, mode, run) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDOFF_STORE, mode);
    const request = run(tx.objectStore(HANDOFF_STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The hand-off was not saved."));
  });
}

/** Stores the pending hand-off. Rejects when IndexedDB is unavailable, blocked or slow. */
export async function writeHandoff(record, options = {}) {
  const idb = Object.hasOwn(options, "indexedDB") ? options.indexedDB : browserIndexedDB();
  const now = options.now ?? Date.now;
  const db = await openHandoffDb(idb, options.timeoutMs ?? 3000);
  try {
    await handoffTransaction(db, "readwrite", store => store.put({ ...record, createdAt: now() }, HANDOFF_KEY));
  } finally {
    db.close();
  }
}
