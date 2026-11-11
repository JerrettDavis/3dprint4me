import { dirname, resolve } from 'node:path';
import { createCataloguePublisher, catalogueBuildEnvironment } from './publisher.js';
import { cataloguePrivateRoot, runCatalogueProcess } from './render-adapter.js';

// Trusted checkout scripts run with runtime paths, without API/database secrets.
export async function buildCatalogueRelease(cwd) {
  const npm = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const options = { cwd, env: catalogueBuildEnvironment(), timeoutMs: 600000 };
  await runCatalogueProcess(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], options);
  for (const script of ['catalogue:build', 'customizer:build', 'assets:version', 'validate']) {
    await runCatalogueProcess(process.execPath, [npm, 'run', script], options);
  }
}
export function cataloguePublisherRuntime(env = process.env) {
  if (env.CATALOGUE_PUBLISH_ENABLED !== '1' || !env.CATALOGUE_PUBLISH_REMOTE || !env.SITE_URL) return { configured: false };
  try {
    return { configured: true, publish: createCataloguePublisher({ remote: env.CATALOGUE_PUBLISH_REMOTE,
      branch: env.CATALOGUE_PUBLISH_BRANCH || 'main', publicSiteUrl: env.SITE_URL,
      privateRoot: env.CATALOGUE_RELEASE_PATH || resolve(cataloguePrivateRoot(env.CATALOGUE_PRIVATE_PATH), 'releases'),
      previewRoot: cataloguePrivateRoot(env.CATALOGUE_PRIVATE_PATH), build: buildCatalogueRelease }) };
  } catch { return { configured: false }; }
}
