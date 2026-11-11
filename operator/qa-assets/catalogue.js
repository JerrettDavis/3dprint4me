// Owner-only private merchandising UI. Values enter textContent/value, never HTML.
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
function button(text, action) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }
function field(label, control) {
  const wrapper = el('label', null, 'catalogue-owner-field');
  control.setAttribute('aria-label', label);
  wrapper.append(el('span', label), control); return wrapper;
}

export async function openCatalogueDialog({ api, sourceWorkId = null, onAuthError = () => {} }) {
  document.querySelector('#catalogue-dialog')?.remove();
  const dialog = el('dialog', null, 'catalogue-owner'); dialog.id = 'catalogue-dialog';
  dialog.setAttribute('aria-labelledby', 'catalogue-dialog-title');
  const heading = el('h2', 'Product catalogue'); heading.id = 'catalogue-dialog-title';
  const content = el('div');
  const status = el('p', 'Loading private catalogue…'); status.setAttribute('role', 'status');
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.append(button('Close catalogue', close), heading, content, status);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal();
  const fail = error => {
    if ([401, 403].includes(error?.status)) { close(); onAuthError(); return; }
    status.textContent = error?.message || 'The catalogue could not load. Your previous draft is preserved.';
  };
  async function run(action) {
    if (dialog.getAttribute('aria-busy') === 'true') return;
    dialog.setAttribute('aria-busy', 'true');
    const controls = [...dialog.querySelectorAll('button,input,select,textarea')].filter(node => !node.disabled);
    controls.forEach(node => { node.disabled = true; });
    try { await action(); } catch (error) { fail(error); }
    finally { dialog.removeAttribute('aria-busy'); controls.forEach(node => { if (node.isConnected) node.disabled = false; }); }
  }
  async function showProduct(id) {
    const data = await api.catalogue(id);
    const p = data.product;
    content.replaceChildren();
    content.append(button('All catalogue products', () => run(showList)), el('p', `${p.status.replaceAll('_', ' ')} · revision ${p.revision}`));
    if (p.status === 'publishing') content.append(el('p', 'Waiting for the public release to be verified.'));
    if (p.published) content.append(el('p', `${p.published.source === 'bundled_projection' ? 'Current' : 'Verified'} public revision ${p.published.revision}.`));
    if (data.previewUrl) {
      const inspect = el('a', 'Inspect these settings in the design tool'); inspect.href = data.previewUrl; inspect.target = '_blank'; inspect.rel = 'noopener noreferrer';
      content.append(inspect);
    }
    let previewsAvailable = true;
    if (p.render?.outcome === 'ready') {
      const gallery = el('section', null, 'catalogue-owner-previews'); gallery.setAttribute('aria-label', 'Private studio previews');
      try {
      for (let index = 0; index < p.render.images.length; index++) {
        const preview = await api.cataloguePreview(p.id, index);
        const figure = el('figure'); const image = el('img');
        image.src = `data:image/webp;base64,${preview.base64}`; image.alt = p.render.images[index].alt; image.width = 480; image.height = 360;
        figure.append(image, el('figcaption', 'Private studio preview — review before publishing')); gallery.append(figure);
      }
      } catch (error) {
        if ([401, 403].includes(error?.status)) throw error;
        previewsAvailable = false;
        gallery.replaceChildren(el('p', 'Private previews are unavailable. Build fresh previews to review this product.'));
      }
      content.append(gallery);
    }
    const form = el('form', null, 'catalogue-owner-form');
    const inputs = {};
    for (const [key, label, max] of [['title', 'Product title', 100], ['category', 'Collection', 60], ['summary', 'Short description', 400], ['description', 'Product description', 2000], ['limitations', 'Use and limitations', 1000], ['permissionNote', 'Permission and rights evidence', 1000]]) {
      const input = el(['summary', 'description', 'limitations', 'permissionNote'].includes(key) ? 'textarea' : 'input');
      input.name = key; input.value = p[key] ?? ''; input.maxLength = max; inputs[key] = input;
      form.append(field(label, input));
    }
    const imageAlts = [0, 1].map(index => {
      const input = el('input'); input.maxLength = 300;
      input.value = p.imageAlts?.[index] || p.render?.images?.[index]?.alt || p.published?.snapshot?.images?.[index]?.alt || (p.title ? `${p.title}, ${index ? 'alternate' : 'primary'} studio view` : '');
      form.append(field(index ? 'Alternate image description' : 'Primary image description', input)); return input;
    });
    const camera = el('select');
    for (const [value, label] of [['standard', 'Standard studio views'], ['front', 'Lower front views'], ['overhead', 'Overhead views']]) {
      const option = el('option', label); option.value = value; camera.append(option);
    }
    camera.value = p.renderCamera ?? 'standard'; form.append(field('Studio camera', camera));
    const order = el('input'); order.type = 'number'; order.min = -10000; order.max = 10000; order.step = 1; order.value = p.order ?? 0;
    form.append(field('Display order (lower first)', order));
    const discoverable = el('input'); discoverable.type = 'checkbox'; discoverable.checked = p.discoverable !== false;
    form.append(field('Show in shop and generator galleries', discoverable));
    form.append(el('p', 'Use generic demonstration text or record permission to publish it. Customer names, contact details, private artwork and secrets must not appear in a public product.'));
    const settings = el('details'); settings.open = true; settings.append(el('summary', 'Model settings'));
    const params = new Map();
    for (const def of data.fields ?? []) {
      const value = p.params[def.key];
      let input;
      if (def.type === 'enum') {
        input = el('select');
        for (const option of def.options ?? []) { const choice = el('option', option.label); choice.value = option.value; input.append(choice); }
        input.value = value;
      } else if (def.type === 'profile') { input = el('textarea'); input.value = JSON.stringify(value); }
      else {
        input = el('input');
        input.type = def.type === 'bool' ? 'checkbox' : ['int', 'number'].includes(def.type) ? 'number' : def.type === 'color' ? 'color' : 'text';
        if (input.type === 'checkbox') input.checked = value === true; else input.value = value ?? '';
        if (input.type === 'number') { input.min = def.min; input.max = def.max; input.step = def.step ?? 'any'; }
        if (input.type === 'text' && def.max) input.maxLength = def.max;
      }
      input.name = def.key; params.set(def.key, { def, input });
      settings.append(field(`${def.label}${def.unit ? ` (${def.unit})` : ''}`, input));
    }
    form.append(settings);
    const save = el('button', 'Save private draft'); save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
      const values = Object.fromEntries([...params].map(([key, { def, input }]) => [key, def.type === 'bool' ? input.checked : ['int', 'number'].includes(def.type) ? Number(input.value) : def.type === 'profile' ? JSON.parse(input.value) : input.value]));
      await api.catalogueAction({ action: 'save', id: p.id, revision: p.revision, commandId: crypto.randomUUID(), edit: { ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])),
        imageAlts: imageAlts.map(input => input.value), renderCamera: camera.value, order: Number(order.value), discoverable: discoverable.checked, params: values } });
      await showProduct(p.id); status.textContent = 'Private draft saved. Build fresh previews before approval.';
    }); });
    content.append(form);
    if (p.status === 'publishing') form.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
    const actions = el('div', null, 'catalogue-owner-actions');
    const render = button('Build previews', () => run(async () => {
      await api.catalogueAction({ action: 'render', id: p.id, revision: p.revision, commandId: crypto.randomUUID() });
      await showProduct(p.id); status.textContent = 'Preview job queued. Refresh to check its progress.';
    }));
    render.disabled = !data.renderConfigured || ['rendering', 'publishing'].includes(p.status);
    const approve = button('Approve reviewed previews', () => run(async () => {
      await api.catalogueAction({ action: 'approve', id: p.id, revision: p.revision, commandId: crypto.randomUUID() });
      await showProduct(p.id); status.textContent = 'Review recorded. The product has not been published.';
    }));
    approve.disabled = p.status !== 'review_ready' || !previewsAvailable;
    const releaseAction = (label, action, allowed) => {
      const control = button(label, () => run(async () => {
        await api.catalogueAction({ action, id: p.id, revision: p.revision, commandId: crypto.randomUUID() });
        await showProduct(p.id); status.textContent = 'Release queued. Refresh to check public verification.';
      }));
      control.disabled = !data.publishConfigured || !allowed;
      return control;
    };
    actions.append(render, approve,
      releaseAction('Publish reviewed product', 'publish', p.status === 'approved' && previewsAvailable),
      releaseAction('Withdraw public product', 'withdraw', p.status !== 'publishing' && p.published?.snapshot?.status === 'published'),
      button('Refresh product', () => run(() => showProduct(p.id))));
    content.append(actions);
    if (!data.renderConfigured) content.append(el('p', 'The preview runner is not configured. Draft saving is available; previews have not been built.'));
    if (!data.publishConfigured) content.append(el('p', 'Publication is unavailable until the trusted release runner is configured. This draft is private.'));
    status.textContent = `Private product: ${p.title || p.id}.`;
  }
  async function showList() {
    const data = await api.catalogue(); content.replaceChildren();
    if (!data.configured) { status.textContent = 'Catalogue storage is not configured. Existing customer requests remain available.'; return; }
    if (sourceWorkId) {
      const form = el('form', null, 'catalogue-owner-form');
      const id = el('input'); id.name = 'id'; id.required = true; id.pattern = '[a-z0-9]+(-[a-z0-9]+)*'; id.maxLength = 100;
      id.value = `design-${crypto.randomUUID().slice(0, 8)}`;
      form.append(el('p', 'Create a reusable starting point from this request. Customer text is replaced with generic examples; the original model remains private.'), field('Product ID', id));
      const create = el('button', 'Create private draft'); create.type = 'submit'; form.append(create);
      form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
        const result = await api.catalogueAction({ action: 'promote', id: id.value, workId: sourceWorkId, commandId: crypto.randomUUID() });
        await showProduct(result.product.id);
      }); }); content.append(form);
    }
    const list = el('ul', null, 'catalogue-owner-list');
    for (const p of data.products) {
      const row = el('li'); row.dataset.productId = p.id;
      const open = button(p.title || p.id, () => run(() => showProduct(p.id)));
      const meta = el('span', `${p.id} · ${p.status.replaceAll('_', ' ')}`); meta.id = `catalogue-item-${p.id}`;
      open.setAttribute('aria-describedby', meta.id); row.append(open, meta); list.append(row);
    }
    content.append(list); status.textContent = `${data.products.length} private catalogue products.`;
  }
  await run(showList);
}
