import { createOperatorApiHandler } from '../operator-api.js';
import { readJson, HttpError } from '../http.js';
import { assertCatalogueOwner } from './domain.js';
import { createCatalogueRuntime } from './runtime.js';
import { readCataloguePreview } from './previews.js';

export function createCatalogueOperatorHandler({ authorize, allowedOrigins, application, getRuntime, workRepository, localPath } = {}) {
  let runtime;
  const resolved = () => runtime ??= application ? { configured: true, application }
    : getRuntime ? getRuntime() : createCatalogueRuntime({ workRepository, localPath });
  return createOperatorApiHandler({ methods: ['GET', 'POST'], allowedOrigins, authorize, handle: async ({ req, operator }) => {
    assertCatalogueOwner(operator);
    const current = resolved();
    if (!current.configured) {
      if (req.method === 'POST') throw new HttpError(409, 'Catalogue storage is not configured. Existing customer requests remain available.');
      return { configured: false, renderConfigured: false, publishConfigured: false, products: [] };
    }
    if (req.method === 'GET') {
      const url = new URL(req.url, 'https://operator.invalid');
      if ([...url.searchParams.keys()].some(key => !['resource', 'id', 'preview'].includes(key))) throw new HttpError(400, 'Unsupported catalogue query.');
      if (url.searchParams.has('preview')) {
        const index = url.searchParams.get('preview');
        if (!/^[0-5]$/.test(index ?? '') || !url.searchParams.has('id')) throw new HttpError(400, 'A valid private preview is required.');
        const detail = await current.application.get(url.searchParams.get('id'), operator);
        return readCataloguePreview({ privateRoot: current.privateRoot, product: detail.product, index: Number(index) });
      }
      const body = url.searchParams.has('id') ? await current.application.get(url.searchParams.get('id'), operator) : await current.application.list(operator);
      return { configured: true, ...body };
    }
    const command = await readJson(req, 32 * 1024);
    if (Buffer.byteLength(JSON.stringify(command)) > 32 * 1024) throw new HttpError(413, 'Catalogue command is too large.');
    return { product: await current.application.execute(command, operator) };
  } });
}
