import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PRODUCTS } from '../public/assets/js/catalogue/products.js';
import { validateProduct } from '../public/assets/js/catalogue/contract.js';
import { escapeHtml as esc, renderProduct, renderShop, filterProducts, latestProducts } from '../public/assets/js/catalogue/views.js';

const root = new URL('../', import.meta.url);
const home = await readFile(new URL('public/index.html', root), 'utf8');
const assetVersion = home.match(/(?:href|src)="\/assets\/[^"\n]+\.(?:js|css)\?v=([a-f0-9]{16})"/)?.[1];
let media = {};
try { media = JSON.parse(await readFile(new URL('scripts/catalogue-media.json', root), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const products = PRODUCTS.map(p => validateProduct(p));
const shell = (title, description, path, content, shop = false) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#ffffff"><title>${esc(title)} | 3dprint4.me</title><link rel="canonical" href="https://3dprint4.me${path}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/css/site.css"><link rel="stylesheet" href="/assets/css/shared.css"><link rel="stylesheet" href="/assets/css/catalogue.css"></head>
<body><div id="site-header"></div><main id="main" class="catalogue-page">${content}</main><div id="site-footer"></div><script type="module" src="/assets/js/site.js"></script>${shop ? '<script type="module" src="/assets/js/catalogue/shop.js"></script>' : ''}</body></html>\n`.replace(/((?:href|src)="\/assets\/[^"\n]+\.(?:js|css))"/g, (_, prefix) => `${prefix}${assetVersion ? `?v=${assetVersion}` : ''}"`);

await mkdir(new URL('public/shop/', root), { recursive: true });
await writeFile(new URL('public/shop/index.html', root), shell('Shop designs made for you', 'Browse customizable signs, organizers, gifts and seasonal designs. Pick a design and request a quote.', '/shop/', renderShop(products), true));
for (const p of latestProducts(products)) {
  await mkdir(new URL(`public/shop/${p.id}/`, root), { recursive: true });
  const description = p.summary.length >= 60 ? p.summary : `${p.summary} Customize this design and request a reviewed quote from 3dprint4.me.`;
  await writeFile(new URL(`public/shop/${p.id}/index.html`, root), shell(p.title, description, `/shop/${p.id}/`, renderProduct(p, media[`catalogue-${p.id}-r${p.revision}`])));
}
console.log(`Built shop and ${filterProducts(products).length} product detail pages.`);
const sitemapPath = new URL('public/sitemap.xml', root);
const sitemap = await readFile(sitemapPath, 'utf8');
const stripped = sitemap.replace(/\s*<url>\s*<loc>https:\/\/3dprint4\.me\/shop\/[^<]*<\/loc>[\s\S]*?<\/url>/g, '');
const urls = ['/shop/', ...filterProducts(products).map(p => `/shop/${p.id}/`)];
await writeFile(sitemapPath, stripped.replace('</urlset>', `${urls.map(path => `  <url><loc>https://3dprint4.me${path}</loc></url>`).join('\n')}\n</urlset>`));
