import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { HttpError } from "./http.js";
import { canTransition, encodeWorkCursor } from "./work-validation.js";

const emptyState = () => ({ version: 1, requests: [], workItems: [], notes: [], events: [], outbox: [], subscriptions: [], actions: [] });
const clone = value => structuredClone(value);
const makeId = prefix => `${prefix}_${randomBytes(16).toString("hex")}`;

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.workItems)) throw new Error("Unsupported local work state.");
    return { ...emptyState(), ...parsed };
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
    async findOperatorByAuthUserId(authUserId) {
      if (authUserId !== "local-development-owner") return null;
      return { id: "op_local_owner", authUserId, displayName: "Local owner", role: "owner", enabled: true };
    },
    async touchOperator() {},
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
    async listWork(query) {
      await pending;
      const state = await readState(path);
      const requestById = new Map(state.requests.map(item => [item.id, item]));
      const viewMatches = item => {
        if (query.view === "all") return true;
        if (query.view === "unacknowledged") return !item.acknowledgedAt && !["completed", "declined", "cancelled"].includes(item.status);
        if (query.view === "waiting") return item.status === "waiting_customer";
        if (query.view === "completed") return ["completed", "declined", "cancelled"].includes(item.status);
        return !["completed", "declined", "cancelled", "waiting_customer"].includes(item.status);
      };
      const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
      const items = state.workItems.filter(item => {
        const record = requestById.get(item.requestId);
        return viewMatches(item) && (!query.service || record?.request?.service === query.service) && (!query.priority || item.priority === query.priority);
      }).sort((a, b) => rank[a.priority] - rank[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const start = query.cursor ? Math.max(0, items.findIndex(item => item.id === query.cursor.id) + 1) : 0;
      const page = items.slice(start, start + query.limit);
      const summaries = page.map(item => {
        const record = requestById.get(item.requestId);
        return { id: item.id, requestId: item.requestId, status: item.status, service: record.request.service, projectTitle: record.request.projectTitle, priority: item.priority, acknowledged: Boolean(item.acknowledgedAt), submittedAt: record.submittedAt, targetDate: item.targetDate, revision: item.revision };
      });
      const last = page.at(-1);
      return { items: summaries, nextCursor: start + page.length < items.length && last ? encodeWorkCursor({ sort: last.createdAt, id: last.id }) : null };
    },
    async getWork(id) {
      await pending;
      const state = await readState(path);
      const item = state.workItems.find(candidate => candidate.id === id);
      if (!item) throw new HttpError(404, "Work item was not found.");
      const record = state.requests.find(candidate => candidate.id === item.requestId);
      return {
        item: presentItem(item), request: clone(record.request), files: clone(record.files),
        notes: clone(state.notes.filter(note => note.workItemId === id)),
        events: clone(state.events.filter(event => event.workItemId === id))
      };
    },
    applyWorkCommand(id, command, operator, idempotencyKey) {
      return exclusive(async () => {
        const state = await readState(path);
        const prior = state.actions.find(action => action.operatorId === operator.id && action.key === idempotencyKey);
        if (prior) return clone(prior.result);
        const item = state.workItems.find(candidate => candidate.id === id);
        if (!item) throw new HttpError(404, "Work item was not found.");
        if (item.revision !== command.revision) throw new HttpError(409, "Work changed before this update could be saved.", { code: "revision_conflict", currentRevision: item.revision });
        const now = new Date().toISOString();
        let type;
        let data;
        if (command.type === "acknowledge") {
          item.acknowledgedAt ??= now; item.acknowledgedBy ??= operator.id; type = "work.acknowledged"; data = {};
        } else if (command.type === "set-priority") {
          const previous = item.priority; item.priority = command.priority; type = "work.priority_changed"; data = { previous, priority: command.priority };
        } else if (command.type === "set-target-date") {
          const previous = item.targetDate; item.targetDate = command.targetDate; type = "work.target_date_changed"; data = { previous, targetDate: command.targetDate };
        } else if (command.type === "set-assignee") {
          const previous = item.assignedOperatorId; item.assignedOperatorId = command.operatorId; type = "work.assignee_changed"; data = { previous, operatorId: command.operatorId };
        } else if (command.type === "set-status") {
          if (!canTransition(item.status, command.status, { previousStatus: item.previousStatus, targetDate: item.targetDate })) throw new HttpError(422, "That work status transition is not allowed.");
          const previous = item.status;
          item.previousStatus = command.status === "waiting_customer" ? previous : null;
          item.status = command.status;
          item.completedAt = command.status === "completed" ? now : null;
          type = "work.status_changed"; data = { previous, status: command.status };
        } else if (command.type === "add-note") {
          const note = { id: makeId("note"), workItemId: id, operatorId: operator.id, body: command.body, createdAt: now };
          state.notes.push(note); type = "work.note_added"; data = { noteId: note.id };
        } else throw new HttpError(400, "Unsupported work command.");
        item.revision += 1;
        item.updatedAt = now;
        const event = { id: String(state.events.length + 1), workItemId: id, requestId: item.requestId, type, actorType: "operator", actorId: operator.id, data, occurredAt: now };
        state.events.push(event);
        const result = { item: presentItem(item), event: clone(event) };
        state.actions.push({ operatorId: operator.id, key: idempotencyKey, result: clone(result), createdAt: now });
        await writeState(path, state);
        return result;
      });
    },
    async listEvents(after, limit) {
      await pending;
      const state = await readState(path);
      const events = state.events.filter(event => BigInt(event.id) > BigInt(after)).slice(0, limit);
      return { events: clone(events), nextCursor: events.at(-1)?.id ?? String(after) };
    },
    async snapshot() { await pending; return clone(await readState(path)); }
  };
}

function presentItem(item) {
  return { ...clone(item), acknowledged: Boolean(item.acknowledgedAt) };
}
