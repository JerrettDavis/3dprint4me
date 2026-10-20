import { createNeonInvoiceRepository } from './repository.js';
import { createLocalInvoiceRepository } from './local-repository.js';
import { createInvoiceNinja } from './invoice-ninja.js';
import { createInvoicingService } from './service.js';

export function createInvoicingRuntime({ workRepository, localPath } = {}) {
  const configured = process.env.INVOICE_NINJA_ENABLED === '1' && Boolean(process.env.INVOICE_NINJA_TOKEN?.trim()) && /^[A-Za-z0-9]{4,64}$/.test(process.env.INVOICE_NINJA_GROUP_ID ?? '');
  const repository = localPath ? createLocalInvoiceRepository({ path: localPath, getWork: id => workRepository.getWork(id) }) : createNeonInvoiceRepository();
  return { configured, service: createInvoicingService({ repository, workRepository, provider: createInvoiceNinja() }) };
}
