import { authorizeOperator, createNeonIdentityProvider } from "../lib/operator-auth.js";
import { configuredOperatorOrigins, createOperatorApiHandler } from "../lib/operator-api.js";
import { createNeonWorkStore } from "../lib/work-store.js";

export function createSessionHandler({ store = createNeonWorkStore(), identityProvider, allowedOrigins = configuredOperatorOrigins() } = {}) {
  let provider = identityProvider;
  return createOperatorApiHandler({
    methods: ["GET"],
    allowedOrigins,
    authorize: req => authorizeOperator(req, store, provider ??= createNeonIdentityProvider()),
    handle: async ({ operator }) => ({ authenticated: true, operator: { id: operator.id, displayName: operator.displayName, role: operator.role } })
  });
}

export default async function handler(req, res) { return createSessionHandler()(req, res); }
