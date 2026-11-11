import test from 'node:test';
import assert from 'node:assert/strict';
import { renderShop, renderProduct, filterProducts } from '../../public/assets/js/catalogue/views.js';
import { PRODUCTS } from '../../public/assets/js/catalogue/products.js';

test('shop exposes product detail links and genuine generator categories', () => {
  const html = renderShop(PRODUCTS);
  assert.equal((html.match(/class="catalogue-card"/g) ?? []).length, 30);
  assert.match(html, /href="\/shop\/pumpkin-witch\/"/);
  assert.match(html, /type="search"/);
  assert.match(html, /name="category"/);
  assert.doesNotMatch(html, /customer@example|checkout|\$0/);
});

test('product detail links request and editing to its exact revision, with honest quote and render labels', () => {
  const p = PRODUCTS.find(p => p.id === 'pumpkin-witch');
  const html = renderProduct(p, { dimensionsMm: [80, 80, 105] });
  assert.match(html, /product=pumpkin-witch&amp;revision=1&amp;intent=request/);
  assert.match(html, /Request this design/);
  assert.match(html, /Customize this design/);
  assert.match(html, /quote/i);
  assert.match(html, /studio render/i);
  assert.match(html, /80 × 80 × 105 mm/);
  assert.doesNotMatch(html, /sourceWorkId|operatorId/);
});

test('search and category filters combine, ignore withdrawn snapshots and escape public text', () => {
  assert.equal(filterProducts(PRODUCTS, { category: 'Seasonal', query: 'witch' }).length, 1);
  assert.equal(filterProducts(PRODUCTS, { category: 'Organization', query: 'witch' }).length, 0);
  assert.equal(filterProducts([{ ...PRODUCTS[0], status: 'withdrawn' }]).length, 0);
  const changed = { ...PRODUCTS[0], title: '<script>bad()</script>', summary: '<img onerror="bad()">' };
  const html = renderProduct(changed);
  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.match(html, /&lt;script&gt;/);
});

test('withdrawn product pages offer recovery without displaying an order action or images', () => {
  const html = renderProduct({ ...PRODUCTS[0], status: 'withdrawn' });
  assert.match(html, /unavailable/i);
  assert.match(html, /href="\/shop\/"/);
  assert.doesNotMatch(html, /Request this design|<img/);
});
