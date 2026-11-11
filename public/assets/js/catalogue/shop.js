import { PRODUCTS } from './products.js?v=c5f2923807d19a64';
import { filterProducts } from './views.js?v=c5f2923807d19a64';

const form = document.querySelector('.catalogue-filters');
if (form) {
  const search = form.elements.q;
  const category = form.elements.category;
  const cards = [...document.querySelectorAll('[data-product-id]')];
  const count = document.querySelector('#catalogue-count');
  const empty = document.querySelector('#catalogue-empty');
  function paint({ writeUrl = true } = {}) {
    const url = new URL(location.href);
    const generator = url.searchParams.get('generator');
    const visible = new Set(filterProducts(PRODUCTS, { category: category.value, query: search.value })
      .filter(p => !generator || p.generatorId === generator).map(p => p.id));
    for (const card of cards) card.hidden = !visible.has(card.dataset.productId);
    count.textContent = `${visible.size} ${visible.size === 1 ? 'design' : 'designs'} to make your own`;
    empty.hidden = visible.size !== 0;
    if (writeUrl) {
      for (const [key, value] of [['q', search.value], ['category', category.value]]) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      history.replaceState(null, '', url);
    }
  }
  function restore() {
    const query = new URLSearchParams(location.search);
    search.value = query.get('q') ?? '';
    category.value = query.get('category') ?? '';
    paint({ writeUrl: false });
  }
  form.addEventListener('submit', event => { event.preventDefault(); paint(); });
  search.addEventListener('input', () => paint());
  category.addEventListener('change', () => paint());
  document.querySelector('#catalogue-reset')?.addEventListener('click', () => {
    search.value = ''; category.value = '';
    const url = new URL(location.href); url.searchParams.delete('generator'); history.replaceState(null, '', url);
    paint(); search.focus();
  });
  addEventListener('popstate', restore);
  restore();
}
