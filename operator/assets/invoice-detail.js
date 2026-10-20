function decimal(value, digits, label) {
  if (typeof value !== 'string' || !new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(value)) throw new TypeError(`${label} must be a non-negative decimal with at most ${digits} decimal places.`);
  const [whole, fraction = ''] = value.split('.'); const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result)) throw new TypeError(`${label} is too large.`); return result;
}
export function billingFromFields(f) {
  return { clientId: f.clientId.trim(), date: f.date, dueDate: f.dueDate,
    receiptAddress: { street: f.street, city: f.city, region: f.region, postalCode: f.postalCode, country: 'US' },
    taxEvidence: { jurisdiction: f.jurisdiction, verifiedOn: f.verifiedOn, reference: f.evidence },
    priorPayment: { state: f.priorState, reference: f.priorReference },
    lines: f.lines.map(l => ({ item: l.item, description: l.description, quantityMilli: decimal(l.quantity, 3, 'Quantity'), unitCents: decimal(l.unitPrice, 2, 'Unit price'), taxRateMilli: decimal(l.taxRate, 3, 'Tax rate'), taxReason: l.taxReason })) };
}
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
function node(tag, text, className) { const n = document.createElement(tag); if (text) n.textContent = text; if (className) n.className = className; return n; }
function link(text, href) { const a = node('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

export function renderInvoiceDetail({ item, api, onAuthError = () => {} }) {
  const root = node('section', '', 'invoice-sheet'); root.setAttribute('aria-label', 'Invoice drafts');
  root.append(node('h3', 'Invoice drafts'), node('p', 'Invoices stay as drafts. Review and send them manually in Invoice Ninja.'));
  const content = node('div'), notice = node('p', 'Loading billing status…'); notice.setAttribute('role', 'status');
  root.append(content, notice); let busy = false;
  const report = error => {
    if (!root.isConnected) return;
    if (['signed-out', 'forbidden'].includes(error.kind)) { root.replaceChildren(); onAuthError(error); return; }
    notice.textContent = error.message || 'Billing is temporarily unavailable.';
  };
  async function run(action) {
    if (busy || !root.isConnected) return;
    busy = true; root.setAttribute('aria-busy', 'true'); const controls = [...root.querySelectorAll('button,input,select,textarea')]; controls.forEach(c => { c.disabled = true; });
    try { await action(); } catch (error) { report(error); }
    finally { busy = false; root.removeAttribute('aria-busy'); controls.forEach(c => { c.disabled = false; }); }
  }
  function showOperation(operation) {
    if (!root.isConnected) return; content.replaceChildren();
    const label = { prepared: 'Ready to create', creating: 'Creation started — reconcile before retrying', draft: 'Draft ready for review', linked: 'Linked Invoice Ninja invoice', needs_reconciliation: 'Creation needs reconciliation', needs_review: 'Invoice needs review' }[operation.state] ?? 'Review billing status';
    content.append(node('h4', label));
    if (operation.totals) content.append(node('p', `Confirmed subtotal ${money(operation.totals.subtotalCents)} · tax ${money(operation.totals.taxCents)} · total ${money(operation.totals.totalCents)}`));
    if (operation.provider) {
      const p = operation.provider;
      content.append(node('p', `${p.number} · ${p.status.replaceAll('_', ' ')} · balance ${money(p.balanceCents)}`));
      if (/^https:\/\/app\.invoicing\.co\/#\/invoices\/[A-Za-z0-9]{4,64}\/edit$/.test(p.editorUrl)) content.append(link('Review in Invoice Ninja', p.editorUrl));
    }
    if (operation.updatedAt) content.append(node('p', `Last checked ${new Date(operation.updatedAt).toLocaleString()}`));
    const refresh = node('button', operation.provider ? 'Refresh invoice status' : 'Reconcile invoice'); refresh.type = 'button';
    refresh.onclick = () => run(async () => { const result = await api.invoiceAction(operation.provider ? 'refresh' : 'reconcile', { workId: item.id }); showOperation(result.operation); });
    content.append(refresh); notice.textContent = 'Only Invoice Ninja can send this invoice. A payment return page does not verify payment.';
  }
  function showForm() {
    const details = node('details'), summary = node('summary', 'Create an invoice draft'), form = node('form'); details.append(summary, form); content.append(details);
    form.append(link('Find or create a client in Invoice Ninja', 'https://app.invoicing.co/#/clients'));
    function field(parent, label, name, options = {}) {
      const wrapper = node('label', label), input = node(options.multiline ? 'textarea' : 'input'); input.name = name;
      if (!options.multiline) input.type = options.type ?? 'text'; input.required = options.required !== false; input.maxLength = options.max ?? 200;
      if (options.value !== undefined) input.value = options.value; if (options.step) { input.step = options.step; input.min = '0'; }
      wrapper.append(input); parent.append(wrapper); return input;
    }
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    field(form, 'Invoice Ninja client ID', 'clientId', { max: 64 });
    form.append(node('p', 'Use the ID at the end of the client’s Invoice Ninja address. The client must belong to the 3dprint4.me group and use USD.'));
    field(form, 'Invoice date', 'date', { type: 'date', value: today }); field(form, 'Due date', 'dueDate', { type: 'date' });
    const address = node('fieldset'); address.append(node('legend', 'Where the customer receives the goods'));
    for (const [name, label] of [['street', 'Street address'], ['city', 'City'], ['region', 'State'], ['postalCode', 'ZIP code']]) field(address, label, name);
    form.append(address);
    const tax = node('fieldset'); tax.append(node('legend', 'Confirmed tax decision'));
    field(tax, 'Tax jurisdiction', 'jurisdiction'); field(tax, 'Tax verified on', 'verifiedOn', { type: 'date', value: today }); field(tax, 'Tax evidence or rate reference', 'evidence', { max: 500 }); form.append(tax);
    const priorLabel = node('label', 'Prior payments or deposits'), prior = node('select'); prior.name = 'priorState'; prior.required = true; prior.setAttribute('aria-label', 'Prior payments or deposits');
    for (const [value, text] of [['', 'Review prior payments'], ['none', 'No prior payment'], ['reconciled', 'Already reconciled in Invoice Ninja'], ['unresolved', 'Prior payment still needs reconciliation']]) { const option = node('option', text); option.value = value; prior.append(option); }
    priorLabel.append(prior); form.append(priorLabel); field(form, 'Prior payment reference (when reconciled)', 'priorReference', { required: false, max: 300 });
    const lines = node('div', '', 'invoice-lines'); form.append(lines);
    function addLine() {
      if (lines.children.length >= 50) return;
      const row = node('fieldset', '', 'invoice-line'); row.append(node('legend', 'Billable line'));
      field(row, 'Item', 'item', { max: 100 }); field(row, 'Description', 'description', { multiline: true, max: 1000, required: false });
      field(row, 'Quantity', 'quantity', { type: 'number', step: '0.001', value: '1' }); field(row, 'Unit price ($)', 'unitPrice', { type: 'number', step: '0.01' });
      field(row, 'Tax rate (%)', 'taxRate', { type: 'number', step: '0.001' }); field(row, 'Tax reason or exemption', 'taxReason', { max: 300 });
      const remove = node('button', 'Remove line'); remove.type = 'button'; remove.onclick = () => { row.remove(); invalidate(); }; row.append(remove); lines.append(row); invalidate();
    }
    const review = node('div', '', 'invoice-review'); review.setAttribute('aria-live', 'polite');
    const invalidate = () => review.replaceChildren();
    addLine(); const add = node('button', 'Add billing line'); add.type = 'button'; add.onclick = addLine;
    const preview = node('button', 'Preview confirmed amounts'); preview.type = 'submit'; form.append(add, preview, review); form.oninput = invalidate;
    form.onsubmit = event => { event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      values.lines = [...lines.children].map(row => Object.fromEntries([...row.querySelectorAll('input,textarea')].map(input => [input.name, input.value])));
      run(async () => {
      const billing = billingFromFields(values); const command = { workId: item.id, revision: item.revision, idempotencyKey: crypto.randomUUID(), billing };
      const result = await api.invoiceAction('preview', { command }); if (!root.isConnected) return;
      review.replaceChildren(node('p', `Subtotal ${money(result.totals.subtotalCents)} · Tax ${money(result.totals.taxCents)} · Total ${money(result.totals.totalCents)}`));
      const confirm = node('button', 'Confirm and create draft'); confirm.type = 'button';
      confirm.onclick = () => run(async () => { const saved = await api.invoiceAction('create', { command: { ...command, billing: result.billing } }); showOperation(saved.operation); });
      review.append(node('p', 'Confirm the client, receipt address, tax and prior payments. This creates a draft; it does not email or charge the customer.'), confirm); notice.textContent = '';
    }); };
  }
  // Deferred until the caller has attached this private panel to the selected job.
  queueMicrotask(async () => {
    try {
      const result = await api.invoiceStatus(item.id); if (!root.isConnected) return;
      if (!result.configured) { notice.textContent = 'Website billing is not configured. You can create drafts directly in Invoice Ninja.'; content.append(link('Open Invoice Ninja', 'https://app.invoicing.co/#/invoices')); return; }
      notice.textContent = ''; result.operation ? showOperation(result.operation) : showForm();
    } catch (error) { report(error); }
  });
  return root;
}
