import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync } from 'node:fs';
import { listPublicGenerators } from '../../public/assets/js/customize/registry.js';
import { renderCatalogHtml } from '../../customizer/framework/catalog.js';

const home = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const cards = [...home.matchAll(/<a class="cat-tile"[\s\S]*?<\/a>/g)].map(m => m[0]);

test('every public generator has the same representative local image on both browsing catalogs', () => {
  const catalog = renderCatalogHtml(listPublicGenerators());
  for (const g of listPublicGenerators()) {
    const homeCard = cards.find(c => c.includes(`href="/customize/g/${g.id}/"`));
    assert.ok(homeCard, `${g.id} discoverable on home`);
    const catalogCard = catalog.split('<li class="cz-card">').find(c => c.includes(`href="/customize/g/${g.id}/"`));
    const image = homeCard.match(/<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/);
    assert.ok(image, `${g.id} has an image and meaningful alt`);
    assert.ok(image[2].length > 20);
    assert.ok(catalogCard.includes(`src="${image[1]}"`), `${g.id} media agrees`);
    assert.ok(catalogCard.includes(`alt="${image[2]}"`), `${g.id} alt agrees`);
    if (image[1].endsWith('.webp')) {
      assert.match(homeCard, /Illustrative render/);
      assert.match(catalogCard, /Illustrative render/);
    }
  }
});

test('all home products have shipped raster images and name plate does not reuse display sign', () => {
  assert.equal(cards.length, 14);
  for (const card of cards) {
    const src = card.match(/<img[^>]+src="([^"]+)"/)?.[1];
    assert.ok(src?.startsWith('/assets/images/'), card);
    const file = new URL(`../../public${src}`, import.meta.url);
    assert.ok(statSync(file).size > 1000);
    if (src.endsWith('.webp')) assert.ok(statSync(file).size < 250000, `${src} optimized`);
    assert.doesNotMatch(card, /class="cat-art"/);
  }
  const name = cards.find(c => c.includes('/g/name-plate/'));
  const display = cards.find(c => c.includes('/g/display-sign/'));
  assert.match(name, /name-plate\.webp/);
  assert.doesNotMatch(name, /QR code|plate-plug-signs/);
  assert.match(display, /plate-plug-signs\.jpg/);
});
