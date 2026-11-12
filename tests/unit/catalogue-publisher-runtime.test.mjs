import test from 'node:test';
import assert from 'node:assert/strict';
import { cataloguePublisherRuntime } from '../../lib/product-catalogue/publisher-runtime.js';
test('publication is disabled without explicit trusted runner configuration', () => {
  for (const env of [{}, { CATALOGUE_PUBLISH_ENABLED: '1' }, { CATALOGUE_PUBLISH_ENABLED: '1', CATALOGUE_PUBLISH_REMOTE: 'https://github.com/example/store.git', SITE_URL: 'https://shop.example.test' }, { CATALOGUE_PUBLISH_ENABLED: '1', CATALOGUE_PUBLISH_REMOTE: 'https://token:PRIVATE@example.test/repo.git', SITE_URL: 'https://shop.example.test' }]) {
    assert.deepEqual(cataloguePublisherRuntime(env), { configured: false });
  }
});
test('valid publication configuration exposes a publisher port without executing it', () => {
  const result = cataloguePublisherRuntime({ CATALOGUE_PUBLISH_ENABLED: '1', CATALOGUE_PUBLISH_REMOTE: 'https://github.com/example/store.git', SITE_URL: 'https://shop.example.test', CATALOGUE_PUBLISH_AUTHOR_NAME: 'Authorized Owner', CATALOGUE_PUBLISH_AUTHOR_EMAIL: 'owner@example.test' });
  assert.equal(result.configured, true);
  assert.equal(typeof result.publish, 'function');
});
