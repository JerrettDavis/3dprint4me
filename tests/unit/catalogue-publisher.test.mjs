import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createCataloguePublisher } from '../../lib/product-catalogue/publisher.js';
import { catalogueSnapshotHash } from '../../lib/product-catalogue/publication.js';
import { catalogueConfigurationHash } from '../../lib/product-catalogue/domain.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';
import { createLocalCatalogueRepository } from '../../lib/product-catalogue/local-repository.js';
import { createCatalogueApplication } from '../../lib/product-catalogue/application.js';
import { createCatalogueWorker } from '../../lib/product-catalogue/worker.js';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
async function fixture(t, existing = [PRODUCTS.find(p => p.id === 'name-plate-classic')]) {
  const root = await mkdtemp(join(tmpdir(), 'catalogue-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); await mkdir(join(source, 'public/assets/js/catalogue'), { recursive: true });
  await writeFile(join(source, 'public/assets/js/catalogue/products.js'), `export const PRODUCTS = ${JSON.stringify(existing)};\n`);
  await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { 'catalogue:build': 'node build.mjs' } }));
  git(source, 'init', '-b', 'main'); git(source, 'add', '.');
  git(source, '-c', 'user.name=Catalogue Test', '-c', 'user.email=catalogue@example.test', 'commit', '-m', 'Initial catalogue');
  const remote = join(root, 'remote.git'); git(root, 'clone', '--bare', source, remote);
  const p = structuredClone(PRODUCTS.find(p => p.id === 'pumpkin-witch'));
  const previewRoot = join(root, 'previews'); const preview = join(previewRoot, 'render-sample'); await mkdir(preview, { recursive: true });
  const hashes = [];
  for (let i = 0; i < p.images.length; i++) {
    const bytes = await readFile(new URL(`../../public${p.images[i].src}`, import.meta.url));
    hashes.push(createHash('sha256').update(bytes).digest('hex'));
    await writeFile(join(preview, `preview-${i}.webp`), bytes);
  }
  await writeFile(join(preview, 'result.json'), JSON.stringify({ jobId: 'render-sample', configurationSha256: catalogueConfigurationHash(p), images: p.images, imageSha256s: hashes }));
  const job = { id: 'publish-test', kind: 'publish', operation: 'publish', productId: p.id, snapshot: p,
    snapshotSha256: catalogueSnapshotHash(p), renderJobId: 'render-sample', releaseId: 'release-test' };
  const build = async directory => {
    await mkdir(join(directory, 'public/shop'), { recursive: true });
    await writeFile(join(directory, 'public/shop/index.html'), '<!doctype html><title>Shop</title>');
  };
  const options = { remote, branch: 'main', privateRoot: join(root, 'releases'), previewRoot, publicSiteUrl: 'https://shop.example.test', allowLocalRemote: true, build };
  const verifiedFetch = async (url, options) => {
    assert.equal(String(url), 'https://shop.example.test/catalogue-releases/release-test.json');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(git(remote, 'show', 'main:public/catalogue-releases/release-test.json'), { status: 200 });
  };
  return { root, remote, job, options, verifiedFetch };
}

test('publisher writes only reviewed snapshots/images and verifies the actual pushed release', async t => {
  const f = await fixture(t);
  const result = await createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })(f.job);
  assert.equal(result.verified, true);
  assert.equal(result.snapshotSha256, f.job.snapshotSha256);
  assert.match(result.commit, /^[a-f0-9]{40}$/);
  const projection = git(f.remote, 'show', 'main:public/assets/js/catalogue/products.js');
  assert.match(projection, /name-plate-classic/); assert.match(projection, /pumpkin-witch/);
  assert.doesNotMatch(projection, /sourceWorkId|permissionNote|render-sample/);
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '2');
  const files = git(f.remote, 'ls-tree', '-r', '--name-only', 'main');
  assert.doesNotMatch(files, /\.private|input\.json|preview-0/);
});

test('an unconfirmed deployment remains pending and a retry verifies without duplicating the commit', async t => {
  const f = await fixture(t);
  const pending = await createCataloguePublisher({ ...f.options, fetchImpl: async () => new Response('Not deployed', { status: 404 }) })(f.job);
  assert.equal(pending.pending, true);
  assert.equal(pending.verified, undefined);
  const result = await createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })({ ...f.job, delivery: pending, awaitingRelease: true });
  assert.equal(result.verified, true);
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '2');
});

test('immutable revision conflicts cannot overwrite an existing public product', async t => {
  const original = structuredClone(PRODUCTS.find(p => p.id === 'pumpkin-witch'));
  const f = await fixture(t, [{ ...original, title: 'Previously published title' }]);
  await assert.rejects(createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })(f.job));
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '1');
});
test('a worker restart reconciles an already pushed release without another commit', async t => {
  const f = await fixture(t);
  await createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })(f.job);
  const result = await createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })(f.job);
  assert.equal(result.verified, true);
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '2');
});
test('a mismatched public receipt remains pending', async t => {
  const f = await fixture(t);
  const result = await createCataloguePublisher({ ...f.options, fetchImpl: async () => Response.json({ releaseId: f.job.releaseId, snapshotSha256: '0'.repeat(64) }) })(f.job);
  assert.equal(result.pending, true);
  assert.equal(result.verified, undefined);
});
test('publication cannot replace bytes behind an existing immutable image URL', async t => {
  const f = await fixture(t);
  const source = join(f.root, 'source');
  const target = join(source, 'public', new URL(f.job.snapshot.images[0].src, f.options.publicSiteUrl).pathname);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, 'Previously published bytes');
  git(source, 'add', '.');
  git(source, '-c', 'user.name=Catalogue Test', '-c', 'user.email=catalogue@example.test', 'commit', '-m', 'Existing image');
  git(source, 'push', f.remote, 'main');
  await assert.rejects(createCataloguePublisher({ ...f.options, fetchImpl: f.verifiedFetch })(f.job));
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '2');
});

test('publisher rejects credential-bearing URLs, unsafe branches and public staging directories', () => {
  const options = { remote: 'https://github.com/example/catalogue.git', publicSiteUrl: 'https://shop.example.test', privateRoot: join(tmpdir(), 'catalogue-release-test'), branch: 'main' };
  assert.throws(() => createCataloguePublisher({ ...options, remote: 'https://token:PRIVATE@github.com/example/repo.git' }));
  assert.throws(() => createCataloguePublisher({ ...options, branch: '../main' }));
  assert.throws(() => createCataloguePublisher({ ...options, privateRoot: new URL('../../public/releases/', import.meta.url) }));
  assert.throws(() => createCataloguePublisher({ ...options, publicSiteUrl: 'https://user:PRIVATE@shop.example.test' }));
});
test('durable worker publishes then withdraws through actual Git and public receipt adapters', async t => {
  const f = await fixture(t);
  const repository = createLocalCatalogueRepository({ path: join(f.root, 'catalogue.json') });
  const job = { ...f.job, draftRevision: 1, status: 'queued', attempts: 0, createdAt: new Date().toISOString() };
  const draft = { ...job.snapshot, revision: 1, status: 'publishing', publicationCounter: 1,
    publication: { jobId: job.id, releaseId: job.releaseId, snapshotSha256: job.snapshotSha256 } };
  await repository.command({ id: draft.id, revision: 0, commandId: 'seed', fingerprint: 'a'.repeat(64), apply: async () => ({ draft, job }) });
  const publisher = createCataloguePublisher({ ...f.options, fetchImpl: async url => new Response(git(f.remote, 'show', `main:public${new URL(url).pathname}`)) });
  const worker = createCatalogueWorker({ repository, workerId: 'publisher', publish: publisher });
  assert.equal(await worker.tick(), 'ready');
  const published = (await repository.get(draft.id)).draft;
  assert.equal(published.status, 'published');
  const app = createCatalogueApplication({ repository, publishConfigured: true });
  await app.execute({ action: 'withdraw', id: draft.id, revision: published.revision, commandId: 'withdraw' }, { id: 'owner', role: 'owner' });
  assert.equal(await worker.tick(), 'ready');
  assert.equal((await repository.get(draft.id)).draft.status, 'withdrawn');
  const projection = git(f.remote, 'show', 'main:public/assets/js/catalogue/products.js');
  assert.match(projection, /"status": "withdrawn"/);
  assert.equal(git(f.remote, 'rev-list', '--count', 'main'), '3');
});
