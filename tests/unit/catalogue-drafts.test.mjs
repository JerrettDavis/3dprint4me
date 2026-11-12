import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueDraft, editCatalogueDraft, queueCatalogueRender, finishCatalogueRender, approveCatalogueDraft, publicCatalogueSnapshot } from '../../lib/product-catalogue/domain.js';
import { getGenerator } from '../../public/assets/js/customize/registry.js';

const owner = { id: 'owner-1', role: 'owner' };
const now = '2026-11-11T18:00:00.000Z';
const create = (input = {}) => createCatalogueDraft({ id: 'guest-wifi-card', customization: { generatorId: 'wifi-tag', generatorVersion: 2,
  params: { format: 'card', security: 'WPA', ssid: 'Customer private home', password: '[redacted]', title: 'Customer name' } }, actor: owner, now, ...input });
const edits = { title: 'Guest Wi-Fi card', category: 'Wi-Fi signs', summary: 'A pocket-size guest network sign.', permissionNote: 'House design with generic demonstration text.', params: { security: 'nopass', ssid: 'Guest Wi-Fi' } };
const image = { src: '/assets/images/products/catalogue/guest-wifi-card-r1.webp', alt: 'Guest Wi-Fi card, studio render', kind: 'render' };

test('promotion copies geometry choices but replaces customer text and drops secrets and private metadata', () => {
  const draft = create();
  assert.equal(draft.params.format, 'card');
  assert.equal(draft.params.ssid, getGenerator('wifi-tag').schema.ssid.default);
  assert.equal(draft.params.title, getGenerator('wifi-tag').schema.title.default);
  assert.equal(Object.hasOwn(draft.params, 'password'), false);
  assert.equal(draft.revision, 1);
  assert.equal(draft.status, 'draft');
  assert.doesNotMatch(JSON.stringify(draft), /Customer private|Customer name|\[redacted\]/);
});

test('only owners can promote, edit or review catalogue products', () => {
  for (const actor of [null, { id: 'partner', role: 'partner' }, { id: 'operator', role: 'operator' }]) {
    assert.throws(() => create({ actor }), e => e.status === 403);
    assert.throws(() => editCatalogueDraft(create(), edits, { actor, now }), e => e.status === 403);
  }
});

test('promotion refuses stale versions and unpublished generators instead of silently reinterpreting geometry', () => {
  assert.throws(() => create({ customization: { generatorId: 'wifi-tag', generatorVersion: 1, params: {} } }), e => e.status === 409);
  assert.throws(() => create({ customization: { generatorId: 'missing', generatorVersion: 1, params: {} } }), e => e.status === 400);
});

test('editing requires an explicit safe configuration and refuses sensitive or unknown values', () => {
  const draft = create();
  const changed = editCatalogueDraft(draft, edits, { actor: owner, now });
  assert.equal(changed.params.ssid, 'Guest Wi-Fi');
  assert.equal(changed.params.format, 'card');
  assert.equal(changed.revision, 2);
  for (const params of [{ password: 'private' }, { password: '[redacted]' }, { unexpected: 'x' }, { font: 'custom' }]) {
    assert.throws(() => editCatalogueDraft(draft, { ...edits, params }, { actor: owner, now }));
  }
  assert.throws(() => editCatalogueDraft(draft, { ...edits, sourceWorkId: 'injected' }, { actor: owner, now }));
});

test('render jobs and approval bind to exact current configuration and reject stale results', () => {
  const edited = editCatalogueDraft(create(), edits, { actor: owner, now });
  const queued = queueCatalogueRender(edited, { jobId: 'job-1', actor: owner, now });
  assert.equal(queued.status, 'rendering');
  const outcome = { jobId: 'job-1', configurationSha256: queued.render.configurationSha256, images: [image], renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64) };
  const ready = finishCatalogueRender(queued, outcome, { now });
  assert.equal(ready.status, 'review_ready');
  assert.equal(ready.review, null);
  const changed = editCatalogueDraft(queued, { ...edits, params: { security: 'nopass', format: 'placard' } }, { actor: owner, now });
  assert.equal(changed.render, null);
  assert.throws(() => finishCatalogueRender(changed, outcome, { now }), e => e.status === 409);
  assert.throws(() => finishCatalogueRender(queued, { ...outcome, configurationSha256: 'c'.repeat(64) }, { now }), e => e.status === 409);
  assert.throws(() => publicCatalogueSnapshot(ready, { revision: 1 }), e => e.status === 409);
  const approved = approveCatalogueDraft(ready, { actor: owner, now });
  const snapshot = publicCatalogueSnapshot(approved, { revision: 1 });
  assert.equal(snapshot.id, 'guest-wifi-card');
  assert.equal(snapshot.params.ssid, 'Guest Wi-Fi');
  assert.equal(snapshot.images[0].src, image.src);
  assert.doesNotMatch(JSON.stringify(snapshot), /owner-1|permissionNote|review|source|private|job-1/);
  assert.throws(() => publicCatalogueSnapshot(editCatalogueDraft(approved, edits, { actor: owner, now }), { revision: 1 }), e => e.status === 409);
});

test('public release requires complete copy, permission evidence and genuine matching studio output', () => {
  assert.throws(() => queueCatalogueRender(create(), { jobId: 'job-1', actor: owner, now }), e => e.status === 400);
  const edited = editCatalogueDraft(create(), { ...edits, permissionNote: '' }, { actor: owner, now });
  const queued = queueCatalogueRender(edited, { jobId: 'job-1', actor: owner, now });
  assert.throws(() => finishCatalogueRender(queued, { jobId: 'job-1', configurationSha256: queued.render.configurationSha256, images: [image], renderer: 'AI image', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64) }, { now }));
  const ready = finishCatalogueRender(queued, { jobId: 'job-1', configurationSha256: queued.render.configurationSha256, images: [image], renderer: 'Blender Cycles', inputSha256: 'a'.repeat(64), meshSha256: 'b'.repeat(64) }, { now });
  assert.throws(() => approveCatalogueDraft(ready, { actor: owner, now }), e => e.status === 400);
});
