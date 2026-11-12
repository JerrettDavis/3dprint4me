import { databaseProvider, getDatabase, hasDatabase } from '../database.js';
import { createPostgresCatalogueRepository } from './repository.js';
import { createLocalCatalogueRepository } from './local-repository.js';
import { createCatalogueApplication } from './application.js';
import { cataloguePrivateRoot } from './render-adapter.js';
import { createCatalogueRenderAdapter } from './render-adapter.js';
import { createCatalogueWorker } from './worker.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { cataloguePublisherRuntime } from './publisher-runtime.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';

const localWorkers = new Map();
function startLocalWorker({ localPath, repository, privateRoot, env, publisher }) {
  const key = resolve(localPath).toLowerCase();
  if (localWorkers.has(key)) return;
  const worker = createCatalogueWorker({ repository, workerId: `local-${randomUUID()}`,
    publish: publisher.publish,
    render: createCatalogueRenderAdapter({ privateRoot, blender: env.BLENDER_BIN, python: env.PYTHON_BIN }) });
  const timer = setInterval(() => { worker.tick().catch(() => console.error('Local catalogue worker unavailable.')); }, 1000);
  timer.unref(); localWorkers.set(key, { worker, timer });
}

export function createCatalogueRuntime({ workRepository, localPath, env = process.env } = {}) {
  if (!localPath && (!hasDatabase(env) || databaseProvider(env) !== 'postgres')) return { configured: false };
  const repository = localPath ? createLocalCatalogueRepository({ path: localPath }) : createPostgresCatalogueRepository({ database: getDatabase() });
  const renderConfigured = env.CATALOGUE_WORKER_ENABLED === '1';
  const publisher = renderConfigured ? cataloguePublisherRuntime(env) : { configured: false };
  const privateRoot = cataloguePrivateRoot(env.CATALOGUE_PRIVATE_PATH);
  // Loopback development runs inside the API process, sharing its serialized file
  // adapter. A standalone production worker always uses native Postgres leases.
  if (localPath && env.LOCAL_DEV === '1' && renderConfigured) startLocalWorker({ localPath, repository, privateRoot, env, publisher });
  // Release capability is enabled only once the trusted publisher is installed.
  return { configured: true, repository, privateRoot,
    application: createCatalogueApplication({ repository, workRepository, publicProducts: PRODUCTS, renderConfigured, publishConfigured: publisher.configured, publicSiteUrl: env.SITE_URL }) };
}
