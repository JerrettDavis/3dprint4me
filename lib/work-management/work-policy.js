const STATUSES = ["submitted", "triage", "waiting_customer", "quoted", "approved", "scheduled", "in_progress", "completed", "declined", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];
const SERVICES = ["print", "design", "repair", "consult"];
const VIEWS = ["unacknowledged", "active", "waiting", "completed", "all"];
const TERMINAL = new Set(["completed", "declined", "cancelled"]);
const FORWARD = new Map([
  ["submitted", new Set(["triage", "waiting_customer", "declined", "cancelled"])],
  ["triage", new Set(["quoted", "waiting_customer", "declined", "cancelled"])],
  ["quoted", new Set(["approved", "waiting_customer", "declined", "cancelled"])],
  ["approved", new Set(["scheduled", "cancelled"])],
  ["scheduled", new Set(["in_progress", "cancelled"])],
  ["in_progress", new Set(["completed", "cancelled"])]
]);

export const WORK_STATUSES = Object.freeze([...STATUSES]);
export const WORK_PRIORITIES = Object.freeze([...PRIORITIES]);

function invalid(message) { throw new TypeError(message); }
function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object.`);
  return value;
}
function exactFields(value, allowed) {
  const extra = Object.keys(value).find(key => !allowed.includes(key));
  if (extra) invalid(`Unexpected field: ${extra}.`);
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) invalid("Revision must be a positive integer.");
  return value;
}
function normalizedChoice(value, allowed, label) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!allowed.includes(normalized)) invalid(`A valid ${label} is required.`);
  return normalized;
}
function isoDate(value, { nullable = false } = {}) {
  if (nullable && (value === null || value === "")) return null;
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) invalid("A valid target date is required.");
  return text;
}

export function canTransition(from, to, context = {}) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to) || TERMINAL.has(from) || from === to) return false;
  if (from === "waiting_customer") return to === context.previousStatus && ["submitted", "triage", "quoted"].includes(to);
  if (to === "scheduled" && !context.targetDate) return false;
  return FORWARD.get(from)?.has(to) ?? false;
}

export function parseWorkCommand(input) {
  const value = plainObject(input, "Work command");
  const type = String(value.type ?? "").trim();
  const base = { type, revision: revision(value.revision) };
  if (type === "acknowledge") { exactFields(value, ["type", "revision"]); return base; }
  if (type === "set-priority") {
    exactFields(value, ["type", "priority", "revision"]);
    return { type, priority: normalizedChoice(value.priority, PRIORITIES, "priority"), revision: base.revision };
  }
  if (type === "set-target-date") {
    exactFields(value, ["type", "targetDate", "revision"]);
    return { type, targetDate: isoDate(value.targetDate, { nullable: true }), revision: base.revision };
  }
  if (type === "set-status") {
    exactFields(value, ["type", "status", "revision"]);
    return { type, status: normalizedChoice(value.status, STATUSES, "status"), revision: base.revision };
  }
  if (type === "set-assignee") {
    exactFields(value, ["type", "operatorId", "revision"]);
    const operatorId = value.operatorId === null ? null : boundedId(value.operatorId, "operator ID");
    return { type, operatorId, revision: base.revision };
  }
  if (type === "add-note") {
    exactFields(value, ["type", "body", "revision"]);
    const body = String(value.body ?? "").trim();
    if (!body || [...body].length > 4000) invalid("Note must contain 1 to 4000 characters.");
    return { type, body, revision: base.revision };
  }
  invalid("A valid work command type is required.");
}

function boundedId(value, label) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(text)) invalid(`A valid ${label} is required.`);
  return text;
}

export function encodeWorkCursor(cursor) {
  const value = plainObject(cursor, "Cursor");
  const sort = new Date(value.sort);
  if (Number.isNaN(sort.getTime())) invalid("Cursor contains an invalid sort value.");
  const id = boundedId(value.id, "cursor ID");
  return Buffer.from(JSON.stringify({ sort: sort.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeWorkCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const sort = new Date(parsed.sort);
    if (Number.isNaN(sort.getTime())) invalid("Cursor contains an invalid sort value.");
    return { sort: sort.toISOString(), id: boundedId(parsed.id, "cursor ID") };
  } catch (error) {
    if (error instanceof TypeError && /Cursor/.test(error.message)) throw error;
    invalid("A valid cursor is required.");
  }
}

export function parseWorkQuery(input = {}) {
  const value = plainObject(input, "Work query");
  exactFields(value, ["view", "service", "priority", "limit", "cursor"]);
  const view = value.view === undefined ? "active" : normalizedChoice(value.view, VIEWS, "view");
  const service = value.service === undefined || value.service === "" ? null : normalizedChoice(value.service, SERVICES, "service");
  const priority = value.priority === undefined || value.priority === "" ? null : normalizedChoice(value.priority, PRIORITIES, "priority");
  const limit = value.limit === undefined || value.limit === "" ? 30 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid("Limit must be between 1 and 100.");
  const cursor = value.cursor ? decodeWorkCursor(value.cursor) : null;
  return { view, service, priority, limit, cursor };
}

export function parsePushSubscription(input) {
  const value = plainObject(input, "Push subscription");
  exactFields(value, ["endpoint", "expirationTime", "keys"]);
  let endpoint;
  try { endpoint = new URL(String(value.endpoint ?? "")); } catch { invalid("Push endpoint must be a valid HTTPS URL."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.href.length > 2048) invalid("Push endpoint must be a valid HTTPS URL.");
  const keys = plainObject(value.keys, "Push subscription keys");
  exactFields(keys, ["p256dh", "auth"]);
  const p256dh = String(keys.p256dh ?? "");
  const auth = String(keys.auth ?? "");
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,128}$/.test(auth)) invalid("Complete Push subscription keys are required.");
  const expirationTime = value.expirationTime == null ? null : Number(value.expirationTime);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) invalid("Push expiration time is invalid.");
  return { endpoint: endpoint.href, expirationTime, keys: { p256dh, auth } };
}
