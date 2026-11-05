// Catalog page entry: one card per public generator. renderCatalogHtml is pure (tested in Node).
import { listPublicGenerators } from "../../public/assets/js/customize/registry.js";
import { esc } from "./form.js";
import { PRODUCT_MEDIA } from "../../public/assets/js/customize/product-media.js";

const CATEGORY_LABELS = { badges: "Badges and signs", tags: "Tags", cards: "Cards", plates: "Name plates", seasonal: "Seasonal" };
export const categoryLabel = category => CATEGORY_LABELS[category] ?? String(category ?? "Other").replace(/^./, c => c.toUpperCase());

const cardMedia = g => {
  const media = PRODUCT_MEDIA[g.id];
  if (!media) return "";
  return `<figure class="cz-card-media"><img src="${esc(media.src)}" alt="${esc(media.alt)}" loading="lazy" width="640" height="480"><figcaption class="cz-card-media-label">${esc(media.label)}</figcaption></figure>`;
};

export function renderCatalogHtml(generators) {
  if (!generators.length) return `<p class="cz-empty">No customizable models are published yet. <a href="/order.html">Start a custom request</a> instead.</p>`;
  return `<ul class="cz-catalog-grid" role="list">${generators.map(g => `
  <li class="cz-card">
    ${cardMedia(g)}<div class="cz-card-body">
    <span class="cz-card-category">${esc(categoryLabel(g.category))}</span>
    <h2 class="cz-card-title"><a class="cz-card-link" href="/customize/g/${encodeURIComponent(g.id)}/">${esc(g.title)}</a></h2>
    <p class="cz-card-blurb">${esc(g.blurb)}</p>
    <span class="cz-card-action" aria-hidden="true">Customize</span>
  </div></li>`).join("")}
</ul>`;
}

if (typeof document !== "undefined") {
  const root = document.querySelector("#cz-catalog");
  if (root) root.innerHTML = renderCatalogHtml(listPublicGenerators());
}
