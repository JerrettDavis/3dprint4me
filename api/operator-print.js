import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { createFilamentUseCases } from "../lib/print-estimation/application/filament.js";
import { createOperatorPrintView, normalizePrintRun } from "../lib/print-estimation/application/operator-view.js";
import { createPrintEstimationRuntime } from "../lib/print-estimation/runtime.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";
import { HttpError, readJson } from "../lib/http.js";
import { signRequestFile } from "../lib/operator-files.js";

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "An operator print action object is required.");
  const extra = Object.keys(value).find(key => !fields.includes(key));
  if (extra) throw new HttpError(400, `Unexpected field: ${extra}.`);
}
function workId(value) {
  const id = String(value ?? "");
  if (!/^work_[A-Za-z0-9_-]{8,123}$/.test(id)) throw new HttpError(400, "A valid work ID is required.");
  return id;
}

/** Private operator print operations: filament cost basis, short-lived model downloads, and actual production runs. */
export function createOperatorPrintHandler({ store, runtime, printRuntime, signFile, identityProvider, authorize, allowedOrigins = configuredOperatorOrigins() } = {}) {
  const work = resolveWorkManagementRuntime({ runtime, repository: store });
  let provider = identityProvider;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, work.repository, provider ??= createNeonIdentityProvider()));
  const print = () => {
    const resolved = printRuntime ?? createPrintEstimationRuntime();
    if (!resolved.repository) throw new HttpError(503, "Print estimation storage is not configured.");
    return resolved;
  };
  const view = () => { const resolved = print(); return createOperatorPrintView({ repository: resolved.repository, fileStore: resolved.fileStore }); };
  return createOperatorApiHandler({ methods: ["GET", "POST"], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    const url = new URL(req.url ?? "/api/operator-print", "https://operator-api.invalid");
    if (req.method === "GET") {
      const resource = url.searchParams.get("resource");
      if (resource === "filament") return createFilamentUseCases({ repository: print().repository }).list();
      if (resource === "request-file") {
        const detail = await work.repository.getWork(workId(url.searchParams.get("workId")), operator);
        return signRequestFile({ work: detail, index: url.searchParams.get("index"), ...(signFile ? { sign: signFile } : {}) });
      }
      if (resource === "asset-download") {
        const detail = await work.repository.getWork(workId(url.searchParams.get("workId")), operator);
        return view().signDownload({ work: detail, assetId: url.searchParams.get("assetId") });
      }
      throw new HttpError(400, "A supported print resource is required.");
    }
    const body = await readJson(req, 16 * 1024);
    if (body.action === "save-filament") {
      exact(body, ["action", "filament"]);
      return { filament: await createFilamentUseCases({ repository: print().repository }).save(body.filament, operator) };
    }
    if (body.action === "record-run") {
      exact(body, ["action", "workId", "run"]);
      const detail = await work.repository.getWork(workId(body.workId), operator);
      return { run: await view().recordRun({ work: detail, run: normalizePrintRun(body.run), operator }) };
    }
    throw new HttpError(400, "A valid operator print action is required.");
  } });
}

export default async function handler(req, res) { return createOperatorPrintHandler()(req, res); }
