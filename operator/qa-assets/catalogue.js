// Owner-only private merchandising UI. Values enter textContent/value, never HTML.
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
function button(text, action) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; }
function field(label, control) {
  const wrapper = el('label', null, 'catalogue-owner-field');
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
    if (p.published) content.append(el('p', `Verified public revision ${p.published.revision}.`));
    if (data.previewUrl) {
      const inspect = el('a', 'Inspect these settings in the design tool'); inspect.href = data.previewUrl; inspect.target = '_blank'; inspect.rel = 'noopener noreferrer';
      content.append(inspect);
    }
    if (p.render?.outcome === 'ready') {
      const gallery = el('section', null, 'catalogue-owner-previews'); gallery.setAttribute('aria-label', 'Private studio previews');
      for (let index = 0; index < p.render.images.length; index++) {
        const preview = await api.cataloguePreview(p.id, index);
        const figure = el('figure'); const image = el('img');
        image.src = `data:image/webp;base64,${preview.base64}`; image.alt = p.render.images[index].alt; image.width = 480; image.height = 360;
        figure.append(image, el('figcaption', 'Private studio preview — review before publishing')); gallery.append(figure);
      }
      content.append(gallery);
    }
    const form = el('form', null, 'catalogue-owner-form');
    const inputs = {};
    for (const [key, label, max] of [['title', 'Product title', 100], ['category', 'Collection', 60], ['summary', 'Short description', 400], ['permissionNote', 'Permission and rights evidence', 1000]]) {
      const input = el(['summary', 'permissionNote'].includes(key) ? 'textarea' : 'input');
      input.name = key; input.value = p[key] ?? ''; input.maxLength = max; inputs[key] = input;
      form.append(field(label, input));
    }
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
      await api.catalogueAction({ action: 'save', id: p.id, revision: p.revision, commandId: crypto.randomUUID(), edit: { ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])), params: values } });
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
    approve.disabled = p.status !== 'review_ready';
    const releaseAction = (label, action, allowed) => {
      const control = button(label, () => run(async () => {
        await api.catalogueAction({ action, id: p.id, revision: p.revision, commandId: crypto.randomUUID() });
        await showProduct(p.id); status.textContent = 'Release queued. Refresh to check public verification.';
      }));
      control.disabled = !data.publishConfigured || !allowed;
      return control;
    };
    actions.append(render, approve,
      releaseAction('Publish reviewed product', 'publish', p.status === 'approved'),
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
      const row = el('li'); row.append(button(p.title || p.id, () => run(() => showProduct(p.id))), el('span', p.status.replaceAll('_', ' '))); list.append(row);
    }
    content.append(list); status.textContent = `${data.products.length} private catalogue products.`;
  }
  await run(showList);
}
