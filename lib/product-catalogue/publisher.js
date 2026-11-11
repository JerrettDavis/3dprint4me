import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, sep } from 'node:path';
import { cataloguePrivateRoot } from './render-adapter.js';
import { catalogueConfigurationHash } from './domain.js';
import { catalogueSnapshotHash, mergeCatalogueSnapshot } from './publication.js';
import { readCataloguePreview } from './previews.js';
import { validateProduct } from '../../public/assets/js/catalogue/contract.js';

const execute = promisify(execFile);
export const catalogueBuildEnvironment = () => Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'LANG', 'SSH_AUTH_SOCK'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
export function createCataloguePublisher({ remote, branch = 'main', privateRoot, previewRoot, publicSiteUrl, authorName, authorEmail, allowLocalRemote = false, build, fetchImpl = fetch } = {}) {
  const staging = cataloguePrivateRoot(privateRoot);
  const site = new URL(publicSiteUrl);
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/') throw new TypeError('A public HTTPS site origin is required.');
  if (typeof remote !== 'string' || /[\r\n\0]/.test(remote)) throw new TypeError('A catalogue Git remote is required.');
  let remoteUrl;
  try { if (!isAbsolute(remote)) remoteUrl = new URL(remote); } catch { /* Local fixture remotes are explicitly opt-in. */ }
  if (remoteUrl ? remoteUrl.protocol !== 'https:' || remoteUrl.username || remoteUrl.password || remoteUrl.search || remoteUrl.hash : !allowLocalRemote) throw new TypeError('A credential-free HTTPS Git remote is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.split('/').some(part => part.endsWith('.lock'))) throw new TypeError('A safe branch name is required.');
  if (typeof authorName !== 'string' || !authorName.trim() || authorName.length > 100 || /[\r\n\0<>]/.test(authorName)
    || typeof authorEmail !== 'string' || authorEmail.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(authorEmail)) throw new TypeError('An authorized deployment author name and email are required.');
  const git = async (cwd, ...args) => (await execute('git', args, { cwd, env: catalogueBuildEnvironment(), windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  return async function publish(job) {
    const snapshot = validateProduct(job.snapshot, { allowHistorical: job.operation === 'withdraw' });
    if (!/^release-[A-Za-z0-9-]{1,90}$/.test(job.releaseId ?? '') || job.snapshotSha256 !== catalogueSnapshotHash(snapshot) || job.productId !== snapshot.id || !['publish', 'withdraw'].includes(job.operation) || (job.operation === 'withdraw') !== (snapshot.status === 'withdrawn')) throw new Error('Invalid catalogue publication.');
    const receipt = { releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, productId: snapshot.id, revision: snapshot.revision, operation: job.operation };
    let commit = job.delivery?.commit;
    const verify = async () => {
      const pending = { pending: true, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256, commit };
      try {
        const response = await fetchImpl(new URL(`/catalogue-releases/${job.releaseId}.json`, site), { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!response.ok) return pending;
        const actual = await response.json();
        if (!Object.entries(receipt).every(([key, value]) => actual[key] === value)) return pending;
        return { verified: true, ...receipt, commit };
      } catch { return pending; }
    };
    if (commit && !job.delivery?.uncertain) {
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new Error('Invalid release delivery.');
      return verify();
    }
    await mkdir(staging, { recursive: true });
    const work = await mkdtemp(resolve(staging, 'release-'));
    try {
      await git(work, 'init');
      await git(work, 'remote', 'add', 'origin', remote);
      await git(work, 'fetch', '--depth=1', 'origin', `refs/heads/${branch}`);
      await git(work, 'checkout', '--detach', 'FETCH_HEAD');
      const productsPath = resolve(work, 'public/assets/js/catalogue/products.js');
      const source = await readFile(productsPath, 'utf8');
      const match = source.match(/^(?:\s*\/\/[^\n]*\n)*\s*export const PRODUCTS =\s*([\s\S]*);\s*$/);
      if (!match) throw new Error('Invalid catalogue projection.');
      const products = mergeCatalogueSnapshot(JSON.parse(match[1]), snapshot);
      const receiptPath = resolve(work, `public/catalogue-releases/${job.releaseId}.json`);
      let previousReceipt;
      try { previousReceipt = JSON.parse(await readFile(receiptPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (previousReceipt) {
        if (!Object.entries(receipt).every(([key, value]) => previousReceipt[key] === value)
          || !JSON.parse(match[1]).some(p => catalogueSnapshotHash(p) === job.snapshotSha256)) throw new Error('Conflicting release receipt.');
        commit = await git(work, 'rev-parse', 'HEAD');
        return verify();
      }
      if (job.operation === 'publish') {
        for (let index = 0; index < snapshot.images.length; index++) {
          const image = await readCataloguePreview({ privateRoot: previewRoot, index, product: { render: { outcome: 'ready', jobId: job.renderJobId, configurationSha256: job.renderConfigurationSha256 || catalogueConfigurationHash(snapshot), images: snapshot.images } } });
          const target = resolve(work, `public${new URL(snapshot.images[index].src, site).pathname}`);
          if (!target.startsWith(resolve(work, 'public/assets/images/products') + sep)) throw new Error('Invalid public image path.');
          await mkdir(dirname(target), { recursive: true });
          const bytes = Buffer.from(image.base64, 'base64');
          let existing;
          try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (existing && !existing.equals(bytes)) throw new Error('An immutable public image cannot change.');
          await writeFile(target, bytes);
        }
      }
      await writeFile(productsPath, `// Immutable catalogue revision snapshots.\nexport const PRODUCTS = ${JSON.stringify(products, null, 2)};\n`);
      await mkdir(dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, JSON.stringify(receipt) + '\n');
      if (build) await build(work);
      else throw new Error('A trusted catalogue build adapter is required.');
      await git(work, 'add', '--', 'public');
      await git(work, '-c', `user.name=${authorName}`, '-c', `user.email=${authorEmail}`, 'commit', '-m', `Catalogue release ${job.releaseId}`);
      commit = await git(work, 'rev-parse', 'HEAD');
      // Once push is attempted, preserve uncertainty for reconciliation.
      try { await git(work, 'push', 'origin', `HEAD:refs/heads/${branch}`); }
      catch { return { pending: true, uncertain: true, ...receipt, commit }; }
      return verify();
    } catch { throw new Error('Catalogue publication could not be prepared. The private draft is preserved.'); }
  };
}


