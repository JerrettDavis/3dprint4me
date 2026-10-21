import { authorizeOperator, createConfiguredIdentityProvider } from '../operator-auth.js';
import { configuredOperatorOrigins, createOperatorApiHandler } from '../operator-api.js';
import { resolveWorkManagementRuntime } from '../work-management/runtime.js';
import { createInvoicingRuntime } from './runtime.js';
import { calculateBilling } from './domain.js';
import { HttpError, readJson } from '../http.js';

function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new HttpError(400, 'A supported invoice action is required.');
}
function present(record) {
  return record ? { operationId: record.operationId, state: record.state, provider: record.provider ?? null,
    updatedAt: record.updatedAt, errorCode: record.errorCode ?? null, ...(record.payload ? { totals: calculateBilling(record.payload) } : {}) } : null;
}
export function createOperatorInvoiceHandler({ store, runtime, invoicing, localPath, identityProvider, authorize, allowedOrigins = configuredOperatorOrigins() } = {}) {
  const work = resolveWorkManagementRuntime({ runtime, repository: store }); let identity;
  const authorizeRequest = authorize ?? (req => authorizeOperator(req, work.repository, identity ??= identityProvider ?? createConfiguredIdentityProvider()));
  const billing = () => invoicing ?? createInvoicingRuntime({ workRepository: work.repository, localPath });
  return createOperatorApiHandler({ methods: ['GET', 'POST'], allowedOrigins, authorize: authorizeRequest, handle: async ({ req, operator }) => {
    if (operator.role !== 'owner' || operator.enabled === false) throw new HttpError(403, 'Only an enabled owner can manage invoices.');
    const resolved = billing();
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://operator-api.invalid');
      if ([...url.searchParams.keys()].some(k => !['resource', 'workId'].includes(k))) throw new HttpError(400, 'Unsupported invoice query.');
      if (!resolved.configured) return { configured: false, dispatch: 'manual', operation: null };
      return { configured: true, dispatch: 'manual', operation: present(await resolved.service.get(url.searchParams.get('workId'), operator)) };
    }
    if (!resolved.configured) throw new HttpError(409, 'Invoice integration is not configured. Intake remains available.');
    const body = await readJson(req, 80 * 1024);
    if (Buffer.byteLength(JSON.stringify(body)) > 80 * 1024) throw new HttpError(413, 'Invoice request is too large.');
    if (['preview', 'create'].includes(body?.action)) {
      exact(body, ['action', 'command']);
      const result = await resolved.service[body.action](body.command, operator);
      return body.action === 'preview' ? result : { operation: present(result) };
    }
    if (['refresh', 'reconcile'].includes(body?.action)) {
      exact(body, ['action', 'workId']); return { operation: present(await resolved.service[body.action](body.workId, operator)) };
    }
    throw new HttpError(400, 'A supported invoice action is required.');
  } });
}
