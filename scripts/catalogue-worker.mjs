import { databaseProvider, hasDatabase, getDatabase, closeDatabase } from '../lib/database.js';
import { createPostgresCatalogueRepository } from '../lib/product-catalogue/repository.js';
import { createCatalogueRenderAdapter } from '../lib/product-catalogue/render-adapter.js';
import { createCatalogueWorker } from '../lib/product-catalogue/worker.js';
import { randomUUID } from 'node:crypto';
import { cataloguePublisherRuntime } from '../lib/product-catalogue/publisher-runtime.js';

async function main() {
  if (process.env.CATALOGUE_WORKER_ENABLED !== '1') { console.log('Catalogue worker is disabled.'); return; }
  if (!hasDatabase() || databaseProvider() !== 'postgres') throw new Error('not configured');
  const repository = createPostgresCatalogueRepository({ database: getDatabase() });
  const worker = createCatalogueWorker({ repository, render: createCatalogueRenderAdapter(), publish: cataloguePublisherRuntime().publish, workerId: `worker-${randomUUID()}` });
  let stopping = false;
  const stop = () => { stopping = true; worker.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  do {
    const state = await worker.tick(); console.log(`Catalogue worker: ${state}`);
    if (process.argv.includes('--once') || stopping) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping);
}
try { await main(); }
catch { console.error('Catalogue worker is not configured or unavailable.'); process.exitCode = 1; }
finally { await closeDatabase(); }
