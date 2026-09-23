import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { resolveWorkManagementRuntime } from "../lib/work-management/runtime.js";

export function createSessionHandler({ store, runtime, identityProvider, allowedOrigins = configuredOperatorOrigins() } = {}) {
  const work = resolveWorkManagementRuntime({ runtime, repository: store });
  let provider = identityProvider;
  return createOperatorApiHandler({
    methods: ["GET"],
    allowedOrigins,
    authorize: req => authorizeOperator(req, work.repository, provider ??= createNeonIdentityProvider()),
    handle: async ({ operator }) => ({ authenticated: true, operator: { id: operator.id, displayName: operator.displayName, role: operator.role } })
  });
}

export default async function handler(req, res) { return createSessionHandler()(req, res); }
