// Financial data is private, ephemeral DOM state. Provider fields are text only.
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
function button(text, action) { const b = el('button', text); b.type = 'button'; b.onclick = action; return b; }
function field(form, text, type = 'text', value = '') {
  const label = el('label', null, 'catalogue-owner-field'), input = el('input'); input.type = type; input.value = value;
  input.setAttribute('aria-label', text); label.append(el('span', text), input); form.append(label); return input;
}
const money = (cents, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
export function renderWorkBillingDisposition({ item, api, onAuthError = () => {} }) {
  const section = el('section', null, 'billing-disposition'), status = el('p', 'Loading billing disposition…'); status.setAttribute('role', 'status');
  section.append(el('h3', 'Billing disposition'), status);
  queueMicrotask(async () => {
    try {
      let data = await api.billingTracking(); if (!section.isConnected) return;
      const form = el('form'), label = el('label', 'Billing decision'), select = el('select'), invoice = el('select');
      select.setAttribute('aria-label', 'Billing decision'); invoice.setAttribute('aria-label', 'Existing fabrication invoice');
      for (const [value, text] of [['needs_invoice', 'Needs invoicing'], ['no_charge', 'No charge'], ['linked', 'Link existing invoice']]) { const option = el('option', text); option.value = value; select.append(option); }
      const existing = data.settings.workBilling.find(row => row.workId === item.id); select.value = existing?.state || 'needs_invoice';
      for (const row of data.items) { const option = el('option', row.number); option.value = row.id; invoice.append(option); }
      if (existing?.invoiceId) invoice.value = existing.invoiceId;
      const update = () => { invoice.hidden = select.value !== 'linked'; }; select.onchange = update; update();
      label.append(select); const save = el('button', 'Confirm billing decision'); save.type = 'submit';
      form.append(label, invoice, save); section.append(form); status.textContent = existing ? `Confirmed: ${existing.state.replaceAll('_', ' ')}` : 'No billing decision confirmed. Saving requires the current project revision.';
      let pending = null;
      form.onsubmit = async event => {
        event.preventDefault(); save.disabled = true;
        const input = { action: 'work-disposition', revision: data.revision, workId: item.id, workRevision: item.revision, state: select.value,
          ...(select.value === 'linked' ? { invoiceId: invoice.value } : {}) };
        const identity = JSON.stringify(input);
        if (pending?.identity !== identity) pending = { identity, input: { ...input, commandId: crypto.randomUUID() } };
        try { await api.billingCommand(pending.input); pending = null; data = await api.billingTracking(); status.textContent = 'Billing decision saved.'; }
        catch (error) { if (['signed-out', 'forbidden'].includes(error.kind)) { section.replaceChildren(); onAuthError(); } else status.textContent = error.message; }
        finally { save.disabled = false; }
      };
    } catch (error) { if (!section.isConnected) return; if (['signed-out', 'forbidden'].includes(error.kind)) { section.replaceChildren(); onAuthError(); } else status.textContent = error.message || 'Billing disposition is temporarily unavailable.'; }
  });
  return section;
}
export async function openBillingDialog({ api, onAuthError = () => {} }) {
  document.querySelector('#billing-dialog')?.remove();
  const opener = document.activeElement, dialog = el('dialog', null, 'catalogue-owner billing-owner'); dialog.id = 'billing-dialog';
  const title = el('h2', 'Billing'); title.id = 'billing-title'; dialog.setAttribute('aria-labelledby', title.id);
  const content = el('div'), status = el('p', 'Loading private billing…'); status.setAttribute('role', 'status');
  const close = () => { dialog.close(); dialog.remove(); opener?.focus(); };
  dialog.append(button('Close billing', close), title, content, status);
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); }); document.body.append(dialog); dialog.showModal();
  let data, busy = false, filter = 'all', pending = null;
  const fail = error => {
    if (!dialog.isConnected) return;
    if (['signed-out', 'forbidden'].includes(error.kind)) { close(); onAuthError(); return; }
    status.textContent = error.message || 'Billing is temporarily unavailable. Reload to try again.';
  };
  async function run(action) {
    if (busy) return;
    busy = true; dialog.setAttribute('aria-busy', 'true');
    const controls = [...dialog.querySelectorAll('button,input,select,textarea')]; controls.forEach(n => { n.disabled = true; });
    try { await action(); } catch (error) { fail(error); }
    finally { busy = false; dialog.removeAttribute('aria-busy'); controls.forEach(n => { n.disabled = false; }); }
  }
  async function load() { data = await api.billingTracking(); if (dialog.isConnected) draw(); }
  async function command(input) {
    const identity = JSON.stringify({ ...input, revision: data.revision });
    if (pending?.identity !== identity) pending = { identity, command: { ...input, commandId: crypto.randomUUID(), revision: data.revision } };
    await api.billingCommand(pending.command); pending = null;
    await load(); status.textContent = 'Billing update saved.';
  }
  function draw() {
    content.replaceChildren(); status.textContent = '';
    const health = el('section', null, 'billing-health');
    const labels = { current: 'Current', stale: 'Stale', unavailable: 'Provider unavailable', never_synced: 'Not yet synchronized' };
    health.append(el('strong', labels[data.sync.status] || 'Unknown sync state'), el('p', data.sync.lastSuccessfulAt ? `Last successful sync: ${new Date(data.sync.lastSuccessfulAt).toLocaleString()}` : 'No provider snapshot yet.'),
      button('Reload billing', () => run(load)));
    health.append(button('Reconcile with Invoice Ninja', () => run(async () => { await api.billingCommand({ action: 'reconcile' }); await load(); })));
    if (data.sync.status !== 'current') health.append(el('p', 'Amounts show the last complete snapshot. Check Invoice Ninja before acting.'));
    content.append(health);
    const counts = el('dl', null, 'billing-counts');
    for (const [key, label] of [['needsInvoicing', 'Needs invoicing'], ['draft', 'Draft'], ['viewed', 'Viewed'], ['paid', 'Paid'], ['overdue', 'Overdue'], ['reviewRequired', 'Review required']]) {
      const group = el('div'); group.append(el('dt', label), el('dd', String(data.counts[key] ?? 0))); counts.append(group);
    }
    content.append(counts);
    for (const total of Object.values(data.totals ?? {})) {
      if (total.currency && Number.isSafeInteger(total.outstandingCents)) content.append(el('p', `${total.currency} outstanding: ${money(total.outstandingCents, total.currency)}`));
    }
    const label = el('label', 'Invoice filter'), select = el('select'); select.setAttribute('aria-label', 'Invoice filter');
    for (const [value, text] of [['all', 'All invoices'], ['needs_invoice', 'Needs invoicing'], ['outstanding', 'Outstanding'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['paid', 'Paid'], ['viewed', 'Viewed'], ['review', 'Review required']]) {
      const option = el('option', text); option.value = value; select.append(option);
    }
    select.value = filter; select.onchange = () => { filter = select.value; draw(); content.querySelector('select').focus(); }; label.append(select); content.append(label);
    const list = el('div', null, 'billing-list');
    const rows = data.items.filter(row => filter === 'all' || filter === 'review' && row.reviewRequired || filter === 'overdue' && row.overdue || filter === 'viewed' && row.viewed || filter === 'outstanding' && ['sent', 'partially_paid'].includes(row.status) || row.status === filter);
    for (const row of rows) {
      const article = el('article', null, 'billing-row');
      article.append(el('h3', row.number), el('strong', row.status.replaceAll('_', ' ')), el('p', `Total ${money(row.totalCents, row.currency)} · Balance ${money(row.balanceCents, row.currency)}`));
      if (row.reviewRequired) article.append(el('strong', 'Review required: payment total differs from transaction evidence. Reconcile in Invoice Ninja.'));
      if (row.dueDate) article.append(el('p', `Due ${row.dueDate}${row.overdue ? ' · Overdue' : ''}`));
      article.append(el('p', `${row.opened ? 'Email opened' : 'No recorded email open'} · ${row.viewed ? 'Invoice viewed' : 'No recorded invoice view'}`));
      const link = el('a', 'Review in Invoice Ninja');
      // Fixed provider destination; never render a caller-supplied portal URL.
      if (/^[A-Za-z0-9]{4,64}$/.test(row.id)) { link.href = `https://app.invoicing.co/#/invoices/${row.id}/edit`; link.target = '_blank'; link.rel = 'noopener noreferrer'; article.append(link); }
      list.append(article);
    }
    if (filter === 'all' || filter === 'needs_invoice') for (const row of data.needsInvoicing) {
      const article = el('article', null, 'billing-row'), link = el('a', row.workId);
      link.href = `/work/${encodeURIComponent(row.workId)}`; article.append(el('h3', 'Needs invoicing'), link); list.append(article);
    }
    if (!list.childElementCount) list.append(el('p', 'No invoices in this view.')); content.append(list);
    const tax = el('section'); tax.append(el('h3', 'Monthly OKTAP reporting'), el('p', 'Filing and payment are acknowledged separately. Customer invoice payments do not prove tax payment.'));
    if (!data.tax.configured) tax.append(el('p', 'Confirm the first reporting period and filing rules in Billing settings to enable reminders.'));
    for (const period of data.tax.periods) {
      const article = el('article', null, 'billing-row'); article.append(el('h4', `${period.startsOn} – ${period.endsOn}`), el('p', `Due ${period.dueDate}`));
      for (const [kind, text] of [['submitted', 'Filing'], ['paid', 'Payment']]) {
        if (period[kind]) {
          article.append(el('p', `${text} acknowledged`));
          const details = el('details'), form = el('form'); details.append(el('summary', `Correct ${text.toLowerCase()} acknowledgement`));
          const reason = field(form, `${text} correction reason`); reason.required = true; reason.minLength = 5; reason.maxLength = 500;
          form.append(el('p', 'This clears the acknowledgement and resumes reminders. The correction is recorded in the audit trail.'));
          const submit = el('button', `Clear ${text.toLowerCase()} acknowledgement`); submit.type = 'submit'; form.append(submit);
          form.onsubmit = event => { event.preventDefault(); run(() => command({ action: 'tax-correct', periodId: period.id, kind, reference: reason.value })); };
          details.append(form); article.append(details);
        }
        else {
          const details = el('details'), form = el('form'); details.append(el('summary', `Acknowledge ${text.toLowerCase()}`));
          const date = field(form, `${text} date`, 'date'), reference = field(form, `${text} confirmation reference`); date.required = reference.required = true; reference.minLength = 5; reference.maxLength = 500;
          const submit = el('button', `Confirm ${text.toLowerCase()}`); submit.type = 'submit'; form.append(submit);
          form.onsubmit = event => { event.preventDefault(); run(() => command({ action: 'tax-acknowledge', periodId: period.id, kind, date: date.value, reference: reference.value })); };
          details.append(form); article.append(details);
        }
      }
      tax.append(article);
    }
    content.append(tax);
    const delivery = el('section'); delivery.append(el('h3', 'Alert delivery'));
    for (const event of data.delivery ?? []) {
      const row = el('p', `${event.kind.replaceAll('_', ' ')} · ${event.state} · ${event.attempts} attempts`);
      if (event.state === 'failed') row.append(button('Retry failed alert', () => run(() => command({ action: 'retry-notification', eventId: event.id }))));
      delivery.append(row);
    }
    if (!data.delivery?.length) delivery.append(el('p', 'No alerts awaiting delivery.')); content.append(delivery); settings();
  }
  function settings() {
    const details = el('details'), form = el('form'); details.append(el('summary', 'Billing settings'));
    const schedule = data.settings.taxSchedule;
    const zone = field(form, 'Business timezone', 'text', data.settings.timeZone); zone.required = true;
    const notifications = field(form, 'Enable billing notifications', 'checkbox'); notifications.checked = data.settings.notificationsEnabled;
    form.append(el('p', 'Monthly filing confirmed. Oklahoma guidance: 20th of the following month, adjusted for weekends and observed state holidays.'));
    const enabled = field(form, 'Enable monthly tax reminders', 'checkbox'); enabled.checked = Boolean(schedule);
    const first = field(form, 'First reporting period', 'month', schedule?.effectiveFrom?.slice(0, 7) || '');
    const holidays = field(form, 'Observed state holidays (YYYY-MM-DD, comma separated)', 'text', schedule?.holidayDates?.join(', ') || '');
    const reference = field(form, 'Filing rule confirmation reference', 'text', schedule?.reference || ''); reference.maxLength = 500;
    const confirmed = field(form, 'I verified the reporting period and observed state holidays', 'checkbox');
    const save = el('button', 'Save billing settings'); save.type = 'submit'; form.append(save);
    form.onsubmit = event => {
      event.preventDefault();
      if (enabled.checked && (!first.value || !confirmed.checked || reference.value.trim().length < 5)) { status.textContent = 'Confirm the first period, holiday calendar and rule reference before enabling tax reminders.'; return; }
      run(() => command({ action: 'settings', settings: { timeZone: zone.value, notificationsEnabled: notifications.checked,
        taxSchedule: enabled.checked ? { confirmed: true, frequency: 'monthly', effectiveFrom: `${first.value}-01`, dueDay: 20, nextBusinessDay: true,
          holidayDates: holidays.value.split(',').map(v => v.trim()).filter(Boolean), timeZone: zone.value, reference: reference.value } : null } }));
    };
    details.append(form); content.append(details);
  }
  await run(load);
}
