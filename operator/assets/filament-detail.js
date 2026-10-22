import { el, field, button, message, perform, swatch } from './filament-ui.js';
const LABELS = { ready: 'Stock available', substitution: 'Substitution available', purchase: 'Purchase needed', review: 'Needs review' };
export function renderFilamentMatching(data, { onCommand, onPreviewEmail, onSendEmail, onInventory }) {
  if (!data) return null;
  const section = el('section', 'filament-sheet'); section.append(el('h3', '', 'Filament readiness'));
  if (!data.available) { section.append(el('p', '', 'Filament matching is unavailable. Request details remain usable.')); return section; }
  if (!data.applicable) return null;
  section.append(el('p', 'print-meta', 'Colors are approximate. Stock is unreserved; selections do not reserve or consume filament.'));
  if (data.totalGrams != null) section.append(el('p', '', `Total planned demand: ${data.totalGrams}g`));
  for (const warning of data.warnings) section.append(el('p', 'filament-warning', warning));
  button(section, 'Inventory and matching limits', onInventory);
  for (const row of data.requirements) {
    const article = el('article', 'filament-requirement'); article.dataset.requirementId = row.requirement.id;
    article.append(el('h4', '', row.requirement.label), el('strong', `filament-status status-${row.status}`, LABELS[row.status]), swatch(row.requirement.colorHex, `Requested: ${row.requirement.material || 'Material unknown'} · ${row.requirement.color || row.requirement.colorHex || 'Color unknown'}`));
    if (row.requirement.grams != null) article.append(el('p', '', `${row.requirement.grams}g required, plus ${data.settings.stockBufferGrams}g buffer`));
    for (const warning of row.warnings) article.append(el('p', 'filament-warning', warning));
    const output = message(article), options = [...row.candidates, ...row.furtherCandidates];
    let selectedId = row.selectedId || row.recommendedId;
    const candidates = el('fieldset', 'filament-options'); candidates.append(el('legend', '', row.band == null ? 'Available options' : `Closest options · ${row.band}% search band`));
    const appendCandidate = (parent, candidate) => {
      const label = el('label', 'filament-candidate'), radio = el('input'); radio.type = 'radio'; radio.name = `candidate-${row.requirement.id}`; radio.value = candidate.id; radio.checked = selectedId === candidate.id;
      radio.onchange = () => { selectedId = candidate.id; };
      const text = el('span'); text.append(swatch(candidate.colorHex, `${candidate.color || candidate.colorHex} · ${candidate.material.toUpperCase()}`), el('span', 'print-meta', `${candidate.brandLine || 'No brand'} · ${candidate.onHandGrams}g · color distance ${candidate.differences.distance.toFixed(1)}${candidate.id === row.recommendedId ? ' · Recommended' : ''}`));
      label.append(radio, text); parent.append(label);
    };
    row.candidates.forEach(candidate => appendCandidate(candidates, candidate));
    if (row.furtherCandidates.length) { const more = el('details'), summary = el('summary', '', `${row.furtherCandidates.length} further matches inside limits`); more.append(summary); row.furtherCandidates.forEach(candidate => appendCandidate(more, candidate)); candidates.append(more); }
    if (options.length) {
      article.append(candidates);
      button(article, 'Create substitution proposal', () => perform(output, () => onCommand({ type: 'propose', revision: data.revision, requirementId: row.requirement.id, inventoryId: selectedId })));
    } else article.append(el('p', '', 'Enter requirements, adjust matching limits, or purchase the requested filament.'));
    const proposal = row.proposal;
    if (proposal) {
      const box = el('section', 'filament-proposal');
      const status = proposal.status === 'accepted' ? `Accepted · ${proposal.decisionSource === 'operator_on_behalf' ? 'operator on behalf' : 'customer response recorded'}` : proposal.status === 'declined' ? 'Declined · customer response recorded' : 'Pending approval';
      box.append(el('h5', '', status), swatch(proposal.offered.colorHex, `Offered: ${proposal.offered.material} · ${proposal.offered.color || proposal.offered.colorHex}`), el('p', '', `Delivery: ${proposal.delivery.state}`));
      if (['failed', 'uncertain', 'unconfigured', 'sending'].includes(proposal.delivery.state)) box.append(el('p', 'filament-warning', 'Approval is still pending. Preview the message to copy it, or verify delivery before retrying.'));
      const reason = field(box, 'Decision reason or response source', '', { type: 'textarea' }); reason.maxLength = 1000;
      const command = (type, extra = {}) => perform(output, () => onCommand({ type, revision: data.revision, proposalId: proposal.id, reason: reason.value, ...extra }));
      if (proposal.status === 'pending') {
        button(box, "Accept on customer's behalf", () => command('accept-on-behalf'));
        button(box, 'Record customer acceptance', () => command('record-customer-response', { decision: 'accepted' }));
        button(box, 'Record customer decline', () => command('record-customer-response', { decision: 'declined' }));
        const emailBox = el('div', 'filament-email');
        button(box, 'Preview customer approval email', async () => {
          await perform(output, async () => {
            const preview = await onPreviewEmail({ proposalId: proposal.id, revision: data.revision });
            emailBox.replaceChildren(el('p', '', `To: ${preview.recipient}`), el('p', '', `Subject: ${preview.subject}`));
            const text = field(emailBox, 'Customer approval message', preview.text, { type: 'textarea' }); text.readOnly = true; text.rows = 10;
            button(emailBox, 'Select message to copy', () => { text.focus(); text.select(); });
            const send = button(emailBox, 'Send approval request', async () => { const result = await perform(output, () => onSendEmail({ proposalId: proposal.id, revision: data.revision, previewToken: preview.previewToken })); if (result) send.disabled = true; }, 'primary');
            send.disabled = !preview.canSend;
            if (preview.warning) emailBox.append(el('p', 'filament-warning', preview.warning));
          });
        });
        box.append(emailBox);
      } else button(box, 'Reopen decision', () => command('reopen'));
      article.append(box);
    }
    section.append(article);
  }
  const editor = el('details', 'filament-requirements-editor'); editor.append(el('summary', '', 'Review or correct filament requirements'));
  const form = el('form'), rows = el('div'); form.append(rows);
  const entries = [];
  const add = requirement => {
    const set = el('fieldset', 'filament-grid'); set.append(el('legend', '', requirement.label || 'Filament requirement'));
    const controls = { label: field(set, 'Requirement label', requirement.label), material: field(set, 'Requested material', requirement.material), color: field(set, 'Requested color name or hex', requirement.colorHex || requirement.color), brandLine: field(set, 'Requested brand / line', requirement.brandLine), grams: field(set, 'Required grams (blank if unknown)', requirement.grams, { type: 'number', min: 0, max: 10000000, step: 'any' }) };
    const entry = { id: requirement.id, controls, removed: false }; entries.push(entry);
    button(set, 'Remove requirement', () => { entry.removed = true; set.remove(); }); rows.append(set);
  };
  data.requirements.forEach(row => add(row.requirement));
  button(form, 'Add color requirement', () => add({ id: `manual_${crypto.randomUUID().replaceAll('-', '')}`, label: 'Additional color' }));
  const output = message(form), save = el('button', 'primary', 'Save requirements'); save.type = 'submit'; form.append(save);
  form.onsubmit = async event => { event.preventDefault(); save.disabled = true; await perform(output, async () => {
    const requirements = entries.filter(e => !e.removed).map(({ id, controls }) => ({ id, ...Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, key === 'grams' ? input.value === '' ? null : Number(input.value) : input.value || null])) }));
    if (!requirements.length) throw Error('Keep at least one requirement so missing colors remain visible.');
    return onCommand({ type: 'save-requirements', revision: data.revision, requirements });
  }); save.disabled = false; };
  button(form, 'Reset to submitted requirements', () => perform(output, () => onCommand({ type: 'save-requirements', revision: data.revision, requirements: null })));
  editor.append(el('p', 'print-meta', 'Corrections keep the original request and supersede previous proposals.'), form); section.append(editor);
  if (data.history.length) { const history = el('details'); history.append(el('summary', '', 'Substitution history')); for (const event of data.history) history.append(el('p', '', `${event.type} · ${new Date(event.occurredAt).toLocaleString()} · ${event.operatorId}${event.reason ? ` · ${event.reason}` : ''}`)); section.append(history); }
  return section;
}
