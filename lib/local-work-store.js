import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HttpError } from "./http.js";

const emptyState = () => ({ version: 1, requests: [], workItems: [], notes: [], events: [], outbox: [], subscriptions: [] });
const clone = value => structuredClone(value);
const makeId = prefix => `${prefix}_${randomBytes(16).toString("hex")}`;

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.workItems)) throw new Error("Unsupported local work state.");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export function createLocalWorkStore({ path }) {
  if (!path) throw new TypeError("A local work-store path is required.");
  let pending = Promise.resolve();
  const exclusive = operation => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    completeRequestWithWork(id, request, files) {
      return exclusive(async () => {
        const state = await readState(path);
        if (state.requests.some(item => item.id === id) || state.workItems.some(item => item.requestId === id)) {
          throw new HttpError(409, "The project request is missing or has already been completed.");
        }
        const now = new Date().toISOString();
        const workItem = { id: makeId("work"), requestId: id, status: "submitted", previousStatus: null, priority: "normal", acknowledgedAt: null, acknowledgedBy: null, targetDate: null, assignedOperatorId: null, revision: 1, createdAt: now, updatedAt: now, completedAt: null };
        const event = { id: String(state.events.length + 1), workItemId: workItem.id, requestId: id, type: "work.created", actorType: "system", actorId: null, data: { version: 1 }, occurredAt: now };
        const outbox = { id: String(state.outbox.length + 1), eventId: event.id, kind: "new_work", payload: { version: 1, eventId: event.id, workId: workItem.id, route: `/work/${workItem.id}` }, state: "pending", attemptCount: 0, nextAttemptAt: now, createdAt: now, updatedAt: now };
        state.requests.push({ id, request: clone(request), files: clone(files), status: "submitted", submittedAt: now });
        state.workItems.push(workItem);
        state.events.push(event);
        state.outbox.push(outbox);
        await writeState(path, state);
        return { workItem: clone(workItem), event: { id: event.id, type: event.type }, outbox: { id: outbox.id, state: outbox.state } };
      });
    },
    async snapshot() { await pending; return clone(await readState(path)); }
  };
}
