// Catalog page entry: one card per public generator. renderCatalogHtml is pure (tested in Node).
import { listPublicGenerators } from "../../public/assets/js/customize/registry.js";
import { esc } from "./form.js";

const CATEGORY_LABELS = { badges: "Badges and signs", tags: "Tags", cards: "Cards", plates: "Name plates" };
export const categoryLabel = category => CATEGORY_LABELS[category] ?? String(category ?? "Other").replace(/^./, c => c.toUpperCase());

export function renderCatalogHtml(generators) {
  if (!generators.length) return `<p class="cz-empty">No customizable models are published yet. <a href="/order.html">Start a custom request</a> instead.</p>`;
  return `<ul class="cz-catalog-grid" role="list">${generators.map(g => `
  <li class="cz-card">
    <span class="cz-card-category">${esc(categoryLabel(g.category))}</span>
    <h2 class="cz-card-title"><a class="cz-card-link" href="/customize/g/${encodeURIComponent(g.id)}/">${esc(g.title)}</a></h2>
    <p class="cz-card-blurb">${esc(g.blurb)}</p>
    <span class="cz-card-action" aria-hidden="true">Customize</span>
  </li>`).join("")}
</ul>`;
}

if (typeof document !== "undefined") {
  const root = document.querySelector("#cz-catalog");
  if (root) root.innerHTML = renderCatalogHtml(listPublicGenerators());
}
