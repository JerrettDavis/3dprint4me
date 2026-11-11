import { productHref, isCurrentProduct } from './contract.js?v=bd77a68212febac1';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const esc = escapeHtml;
export function latestProducts(products) {
  const latest = new Map();
  for (const p of products) if (!latest.has(p.id) || latest.get(p.id).revision < p.revision) latest.set(p.id, p);
  return [...latest.values()];
}
export function filterProducts(products, { category = '', query = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return latestProducts(products).filter(p => p.status === 'published' && p.discoverable !== false && isCurrentProduct(p) && (!category || p.category === category)
    && (!needle || `${p.title} ${p.summary} ${p.category}`.toLocaleLowerCase().includes(needle))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function renderCard(p) {
  return `<li class="catalogue-card" data-product-id="${esc(p.id)}"><a href="/shop/${esc(p.id)}/"><figure><img src="${esc(p.images[0].src)}" alt="${esc(p.images[0].alt)}" width="960" height="720" loading="lazy"><figcaption>Studio render</figcaption></figure><div class="catalogue-card-copy"><span class="catalogue-category">${esc(p.category)}</span><h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p><span class="catalogue-card-action">See this design</span></div></a></li>`;
}

export function renderShop(products) {
  const publicProducts = filterProducts(products);
  const categories = [...new Set(publicProducts.map(p => p.category))].sort();
  return `<section class="catalogue-opening"><div><h1>Find your next favorite thing.</h1><p>Useful organizers, personal signs and something just for fun. Start with a design you like; we’ll make it yours.</p></div><p class="catalogue-promise">Choose a design. Change it if you like. We confirm the details and price before making it.</p></section>
<form class="catalogue-filters" action="/shop/" method="get" role="search" aria-label="Search products"><label for="catalogue-search">Find a design<input type="search" id="catalogue-search" name="q" placeholder="Try pumpkins, signs or organizers" autocomplete="off"></label><label for="catalogue-category">Shop by collection<select id="catalogue-category" name="category"><option value="">All collections</option>${categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label><button class="button secondary" type="submit">Find designs</button></form>
<p class="catalogue-count" id="catalogue-count" role="status">${publicProducts.length} designs to make your own</p><ul class="catalogue-grid" id="catalogue-grid" role="list">${publicProducts.map(renderCard).join('')}</ul><div class="catalogue-empty" id="catalogue-empty" hidden><h2>No designs found.</h2><p>Try another word or collection.</p><button class="button secondary" id="catalogue-reset" type="button">Show all designs</button></div>
<section class="catalogue-custom"><h2>Have something else in mind?</h2><p>A starting point is just that. Use our design tools or tell us what you need.</p><a class="button secondary" href="/customize/">Browse design tools</a><a href="/order.html?service=design">Request a custom design</a></section>`;
}

export function renderProduct(product, media = {}) {
  const p = product;
  if (!isCurrentProduct(p)) return `<section class="catalogue-opening"><h1>This design needs review after a generator update.</h1><p>Choose a current design or start a new one.</p><a class="button primary" href="/shop/">Return to the shop</a></section>`;
  if (p.status === 'withdrawn') return `<section class="catalogue-opening"><div><h1>This design is unavailable.</h1><p>It has been withdrawn from the catalogue. You can choose another starting point or ask us about a custom design.</p><a class="button primary" href="/shop/">Return to the shop</a></div></section>`;
  const size = Array.isArray(media.dimensionsMm) && media.dimensionsMm.length === 3 && media.dimensionsMm.every(Number.isFinite)
    ? `${media.dimensionsMm.map(n => Math.round(n * 10) / 10).join(' × ')} mm` : '';
  const figure = (image, index = 0) => `<figure><img src="${esc(image.src)}" alt="${esc(image.alt)}" width="960" height="720" ${index ? 'loading="lazy"' : 'fetchpriority="high"'}><figcaption>Studio render of this design</figcaption></figure>`;
  return `<nav class="catalogue-breadcrumb" aria-label="Breadcrumb"><a href="/shop/">Shop</a><span aria-hidden="true">/</span><a href="/shop/?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a></nav>
<article class="catalogue-product">
  <header class="catalogue-product-heading"><p class="catalogue-category">${esc(p.category)}</p><h1>${esc(p.title)}</h1></header>
  <div class="catalogue-product-images">${figure(p.images[0])}</div>
  <div class="catalogue-product-copy">
<p class="catalogue-description">${esc(p.summary)}</p>
${p.description ? `<p>${esc(p.description)}</p>` : ''}
${p.limitations ? `<p><strong>Use and limitations:</strong> ${esc(p.limitations)}</p>` : ''}
    <div class="catalogue-actions"><a class="button primary" href="${esc(productHref(p, { request: true }))}">Request this design</a><a class="button secondary" href="${esc(productHref(p))}">Customize this design</a></div>
    <p class="catalogue-quote-note">Made to order. We confirm materials, scope and price before production. Online estimates are non-binding.</p>
    ${size ? `<dl class="catalogue-product-facts"><div><dt>Model size</dt><dd>${esc(size)}</dd></div></dl>` : ''}
    <p>Like it as shown? Review the model and request a quote. Want a different size, color or detail? Make it your own first.</p>
    <details class="catalogue-details"><summary>About this preview</summary><p>These images are digital renders of the selected model settings. Printed color and surface finish vary with material and process. Hardware, accessories and physical fit are confirmed separately. Model dimensions describe the design, not a tested fit.</p></details>
    <a class="catalogue-more" href="/shop/?generator=${esc(p.generatorId)}">See more designs from this tool</a>
  </div>
  ${p.images.length > 1 ? `<section class="catalogue-product-extra" aria-label="Additional product views">${p.images.slice(1).map((image, index) => figure(image, index + 1)).join('')}</section>` : ''}
</article>`;
}
