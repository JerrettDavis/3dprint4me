import { createOperatorApiHandler } from '../operator-api.js';
import { HttpError, readJson } from '../http.js';
import { createInvoiceTrackingRuntime, createLocalInvoiceTrackingRuntime } from './tracking-runtime.js';
export function createInvoiceTrackingHandler({ tracking, localPath, workRepository, authorize, allowedOrigins }) {
  let local;
  return createOperatorApiHandler({ methods: ['GET', 'POST'], authorize, allowedOrigins, handle: async ({ req, operator }) => {
    if (operator.role !== 'owner' || operator.enabled === false) throw new HttpError(403, 'Only an enabled owner can manage billing.');
    const resolved = tracking ?? (localPath ? await (local ??= createLocalInvoiceTrackingRuntime({ path: `${localPath}.tracking`, invoicePath: localPath, workRepository })) : createInvoiceTrackingRuntime({ workRepository }));
    if (req.method === 'GET') return resolved.service.read(operator);
    const input = await readJson(req, 80 * 1024);
    if (input?.action === 'reconcile') {
      if (Object.keys(input).some(key => key !== 'action')) throw new HttpError(400, 'A supported billing action is required.');
      await resolved.service.sync();
      return resolved.service.read(operator);
    }
    return resolved.service.execute(input, operator);
  } });
}
