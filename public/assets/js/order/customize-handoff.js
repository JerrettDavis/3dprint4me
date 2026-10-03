// Order-page reader for the customizer hand-off (writer: customizer/framework/handoff.js).
// The record is read and deleted in one transaction, so it is used at most once. Any failure
// (private window, blocked storage, stale or malformed record) reads as "no hand-off" and the
// order page behaves exactly as it does without one. Top-level names are prefixed because the
// isolated browser harness concatenates the order modules into one script.
const HANDOFF_DB_NAME = "3dp-customize";
const HANDOFF_STORE_NAME = "handoff";
const HANDOFF_RECORD_KEY = "pending";
const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

function handoffIndexedDB() { try { return globalThis.indexedDB; } catch { return undefined; } }

function openHandoffStore(idb, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!idb || typeof idb.open !== "function") { reject(new Error("IndexedDB is unavailable.")); return; }
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("Opening IndexedDB timed out.")); } }, timeoutMs);
    const request = idb.open(HANDOFF_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDOFF_STORE_NAME);
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

function isUsableHandoff(record, now) {
  if (!record || typeof record !== "object") return false;
  if (typeof Blob === "undefined" || !(record.file instanceof Blob)) return false;
  if (typeof record.filename !== "string" || !/\.3mf$/i.test(record.filename)) return false;
  if (typeof record.generatorId !== "string" || !Number.isInteger(record.generatorVersion)) return false;
  return Number.isFinite(record.createdAt) && now - record.createdAt <= HANDOFF_MAX_AGE_MS;
}

/** Returns the pending hand-off once (deleting it), or null. Never throws. */
export async function takeHandoff(options = {}) {
  const idb = Object.hasOwn(options, "indexedDB") ? options.indexedDB : handoffIndexedDB();
  const now = options.now ?? Date.now;
  try {
    const db = await openHandoffStore(idb, options.timeoutMs ?? 3000);
    try {
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDOFF_STORE_NAME, "readwrite");
        const store = tx.objectStore(HANDOFF_STORE_NAME);
        const read = store.get(HANDOFF_RECORD_KEY);
        store.delete(HANDOFF_RECORD_KEY);
        tx.oncomplete = () => resolve(read.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("The hand-off could not be read."));
      });
      return isUsableHandoff(record, now()) ? record : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
