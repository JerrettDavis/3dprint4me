import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { createFilamentUseCases } from "../lib/print-estimation/application/filament.js";
import { createPrintEstimationRuntime } from "../lib/print-estimation/runtime.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";
import { HttpError, readJson } from "../lib/http.js";

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "An operator print action object is required.");
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
}

/** Private operator print operations: filament cost basis (and, later, model downloads). */
export function createOperatorPrintHandler({ store, runtime, printRuntime, identityProvider, authorize, allowedOrigins = configuredOperatorOrigins() } = {}) {
  const work = resolveWorkManagementRuntime({ runtime, repository: store });
  let provider = identityProvider;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, work.repository, provider ??= createNeonIdentityProvider()));
  const print = () => {
    const resolved = printRuntime ?? createPrintEstimationRuntime();
    if (!resolved.repository) throw new HttpError(503, "Print estimation storage is not configured.");
    return resolved;
  };
  return createOperatorApiHandler({ methods: ["GET", "POST"], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    const url = new URL(req.url ?? "/api/operator-print", "https://operator-api.invalid");
    if (req.method === "GET") {
      if (url.searchParams.get("resource") === "filament") return createFilamentUseCases({ repository: print().repository }).list();
      throw new HttpError(400, "A supported print resource is required.");
    }
    const body = await readJson(req, 16 * 1024);
    if (body.action === "save-filament") {
      exact(body, ["action", "filament"]);
      return { filament: await createFilamentUseCases({ repository: print().repository }).save(body.filament, operator) };
    }
    throw new HttpError(400, "A valid operator print action is required.");
  } });
}

export default async function handler(req, res) { return createOperatorPrintHandler()(req, res); }
