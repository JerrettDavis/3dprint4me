// Catalog page entry: one card per public generator. renderCatalogHtml is pure (tested in Node).
import { listPublicGenerators } from "../../public/assets/js/customize/registry.js";
import { esc } from "./form.js";

const CATEGORY_LABELS = { badges: "Badges and signs", tags: "Tags", cards: "Cards", plates: "Name plates", seasonal: "Seasonal" };
export const categoryLabel = category => CATEGORY_LABELS[category] ?? String(category ?? "Other").replace(/^./, c => c.toUpperCase());

const IMG = "/assets/images/projects/";
const ICON_BASE = '<svg class="cz-card-art" viewBox="0 0 320 240" aria-hidden="true" focusable="false">';
const CARD_ART = {
  "name-plate": { img: IMG + "plate-plug-signs.jpg" },
  "route-shield": { img: IMG + "route-66-magnets.jpg" },
  "wifi-tag": { svg: ICON_BASE + '<rect x="96" y="40" width="128" height="160" rx="10" class="a-card"/><circle cx="160" cy="62" r="7" class="a-hole"/><path d="M122 120a54 54 0 0 1 76 0M134 133a37 37 0 0 1 52 0M147 146a19 19 0 0 1 26 0" class="a-stroke"/><circle cx="160" cy="161" r="4.5" class="a-dot"/><rect x="132" y="178" width="56" height="8" rx="2" class="a-bar"/></svg>' },
  "pumpkin": { svg: ICON_BASE + '<path d="M160 70c-52 0-90 34-90 74s38 54 90 54 90-14 90-54-38-74-90-74Z" class="a-card"/><path d="M160 72c-22 14-30 50-30 124M160 72c22 14 30 50 30 124M160 72c-46 10-62 52-48 120M160 72c46 10 62 52 48 120" class="a-stroke"/><path d="M152 70c0-16 4-26 10-34h8c-4 8-4 20-4 34Z" class="a-dot"/><path d="M128 126l12-10 12 10ZM168 126l12-10 12 10Z" class="a-bar"/></svg>' },
  "rating-card": { svg: ICON_BASE + '<rect x="70" y="52" width="180" height="136" rx="8" class="a-card"/><path d="m160 80 9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3 9-19Z" class="a-dot"/><rect x="104" y="150" width="112" height="9" rx="2" class="a-bar"/><rect x="124" y="167" width="72" height="7" rx="2" class="a-bar" opacity=".6"/></svg>' },
};
const cardMedia = g => {
  const art = CARD_ART[g.id];
  if (!art) return "";
  return `<div class="cz-card-media" aria-hidden="true">${art.img ? `<img src="${art.img}" alt="" loading="lazy" width="640" height="480">` : art.svg}</div>`;
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
