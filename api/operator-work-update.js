import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { createNeonWorkStore } from "../lib/work-store.js";
import { parseWorkCommand } from "../lib/work-validation.js";
import { HttpError, readJson } from "../lib/http.js";

function parseEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "A work update object is required.");
  const extra = Object.keys(input).find(key => !["id", "command", "idempotencyKey"].includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
  const id = String(input.id ?? "");
  if (!/^work_[A-Za-z0-9_-]{8,123}$/.test(id)) throw new HttpError(400, "A valid work ID is required.");
  const idempotencyKey = String(input.idempotencyKey ?? "");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new HttpError(400, "A valid idempotency key is required.");
  try { return { id, command: parseWorkCommand(input.command), idempotencyKey }; }
  catch (error) { throw new HttpError(400, error.message); }
}

export function createWorkUpdateHandler({ store = createNeonWorkStore(), identityProvider, authorize, allowedOrigins = configuredOperatorOrigins() } = {}) {
  let provider = identityProvider;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, store, provider ??= createNeonIdentityProvider()));
  return createOperatorApiHandler({ methods: ["PATCH"], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    const { id, command, idempotencyKey } = parseEnvelope(await readJson(req, 16 * 1024));
    return store.applyWorkCommand(id, command, operator, idempotencyKey);
  } });
}

export default async function handler(req, res) { return createWorkUpdateHandler()(req, res); }
