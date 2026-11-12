import { resolveProductLink, resolveCataloguePreview } from '../../public/assets/js/catalogue/contract.js';
import { restoreParams, storableParams } from './form.js';
import { validateParams } from '../../public/assets/js/customize/schema.js';

export function productDraftKey(generator, product = null) {
  const ordinary = `3dp-customize:${generator.id}:v${generator.version ?? 1}`;
  if (product?.privatePreview) return `${ordinary}:catalogue-preview`;
  return product ? `${ordinary}:product:${product.id}:r${product.revision}` : ordinary;
}

export function initialProductState(generator, search, draft, products, hash = '', { resume = false, readProductDraft } = {}) {
  const preview = resolveCataloguePreview(generator, hash);
  if (preview.status !== 'none') {
    const query = new URLSearchParams(search);
    if (preview.status !== 'ready' || query.has('product') || query.has('revision')) return { params: null, product: null, error: preview.message ?? 'Choose either a shop product or a private preview.', preserveDraft: true };
    return { params: restoreParams(generator, JSON.stringify(preview.params)), product: preview.product, preview: true, error: '', preserveDraft: true };
  }
  const resolved = resolveProductLink(generator, search, products);
  if (resolved.status === 'none') return { params: restoreParams(generator, draft), product: null, error: '', preserveDraft: false };
  if (resolved.status !== 'ready') return { params: null, product: null, error: resolved.message, preserveDraft: true };
  // Restore fills sensitive fields from empty schema defaults; a linked snapshot never contains them.
  let params = restoreParams(generator, JSON.stringify(resolved.params));
  let resumed = false;
  if (resume && typeof readProductDraft === 'function') {
    try {
      const saved = JSON.parse(readProductDraft(productDraftKey(generator, resolved.product)));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        const merged = { ...resolved.params, ...storableParams(generator, saved) };
        if (validateParams(generator, merged, { skipSensitive: true }).ok) {
          params = restoreParams(generator, JSON.stringify(merged)); resumed = true;
        }
      }
    } catch { /* A missing or invalid product draft cannot replace the pictured settings. */ }
  }
  return { params, product: resolved.product, resumed, error: '', preserveDraft: true };
}
