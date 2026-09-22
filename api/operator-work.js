import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { createNeonWorkStore } from "../lib/work-store.js";
import { parseWorkQuery } from "../lib/work-validation.js";
import { HttpError } from "../lib/http.js";

function workId(value) {
  const id = String(value ?? "");
  if (!/^work_[A-Za-z0-9_-]{8,123}$/.test(id)) throw new HttpError(400, "A valid work ID is required.");
  return id;
}
function eventCursor(value) {
  const cursor = String(value ?? "0");
  if (!/^\d{1,20}$/.test(cursor)) throw new HttpError(400, "A valid event cursor is required.");
  return cursor;
}
function eventLimit(value) {
  const limit = value == null ? 100 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Event limit must be between 1 and 100.");
  return limit;
}

export function createWorkHandler({ store = createNeonWorkStore(), identityProvider, authorize, allowedOrigins = configuredOperatorOrigins() } = {}) {
  let provider = identityProvider;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, store, provider ??= createNeonIdentityProvider()));
  return createOperatorApiHandler({ methods: ["GET"], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    const url = new URL(req.url ?? "/api/operator-work", "https://operator-api.invalid");
    if (url.searchParams.has("id")) return store.getWork(workId(url.searchParams.get("id")), operator);
    if (url.searchParams.has("eventsAfter")) return store.listEvents(eventCursor(url.searchParams.get("eventsAfter")), eventLimit(url.searchParams.get("limit")), operator);
    const input = Object.fromEntries(url.searchParams);
    return store.listWork(parseWorkQuery(input), operator);
  } });
}

export default async function handler(req, res) { return createWorkHandler()(req, res); }
