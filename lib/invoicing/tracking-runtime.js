import { getDatabase } from '../database.js';
import { createInvoiceTrackingRepository } from './tracking-repository.js';
import { createInvoiceTrackingProvider } from './tracking-provider.js';
import { createInvoiceTrackingService } from './tracking-service.js';
import { createHomeAssistantBillingDelivery, drainBillingEvents } from './home-assistant-delivery.js';
import { createLocalInvoiceTrackingRepository } from './local-tracking-repository.js';
export async function createLocalInvoiceTrackingRuntime({ path, invoicePath, workRepository, now } = {}) {
  const repository = await createLocalInvoiceTrackingRepository({ path, invoicePath, getWork: id => workRepository.getWork(id) });
  // Development data is never reconciled against the production provider.
  const provider = { readSnapshot: async () => { throw new Error('Local provider tracking is not configured.'); } };
  return { repository, service: createInvoiceTrackingService({ repository, provider, workRepository, now }) };
}
export function createInvoiceTrackingRuntime({ database, workRepository, env = process.env, now } = {}) {
  const repository = createInvoiceTrackingRepository({ database: database ?? getDatabase() });
  const provider = createInvoiceTrackingProvider({ token: env.INVOICE_TRACKING_ENABLED === '1' ? env.INVOICE_NINJA_TOKEN : null, groupId: env.INVOICE_NINJA_GROUP_ID ?? null });
  const service = createInvoiceTrackingService({ repository, provider, workRepository, now });
  return { repository, service };
}
export function createInvoiceTrackingTasks({ runtime, env = process.env, now } = {}) {
  const resolve = () => runtime ??= createInvoiceTrackingRuntime({ env, now });
  const delivery = createHomeAssistantBillingDelivery({ origin: env.HOME_ASSISTANT_BILLING_ORIGIN, token: env.HOME_ASSISTANT_BILLING_TOKEN });
  return {
    reconcile: async () => {
      if (env.INVOICE_TRACKING_ENABLED !== '1') return { skipped: 1 };
      const result = await resolve().service.sync();
      return { ...result, errors: result.status === 'unavailable' ? 1 : 0 };
    },
    advanceTax: () => resolve().service.advanceTax(),
    deliver: () => drainBillingEvents({ repository: resolve().repository, delivery, now })
  };
}
