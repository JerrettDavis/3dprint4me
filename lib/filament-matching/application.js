import { importedEligibility } from '../spoolman/domain.js';
import { createHash, randomUUID } from 'node:crypto';
import { HttpError, isValidEmail } from '../http.js';
import { exactFields, normalizeMatchingSettings, matchWorkRequirements } from './domain.js';
import { normalizeRequirements, requirementsForWork } from './requirements.js';
import { conflict } from './adapters/postgres-matching.js';
import { createSubstitutionEmailDelivery, substitutionMessage } from './adapters/substitution-email.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revisionNumber = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, 'A valid matching revision is required.');
  return value;
};
const authorize = operator => { if (!operator?.id || !['owner', 'operator'].includes(operator.role)) throw new HttpError(403, 'An approved operator is required.'); };
const sourceText = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new HttpError(400, 'Record the approval or response source (up to 1000 characters).');
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
};
const latestProposal = (state, id) => [...state.proposals].reverse().find(p => p.requirementId === id && p.status !== 'superseded');
const pendingProposal = (state, id) => {
  const p = state.proposals.find(p => p.id === id);
  if (!p || p.status === 'superseded') throw new HttpError(404, 'That substitution proposal is not current.');
  return p;
};

export function createFilamentMatchingUseCases({ repository, now = () => new Date(), delivery = createSubstitutionEmailDelivery() }) {
  async function settings() {
    const saved = await repository.getMatchingSettings();
    return { revision: saved.revision, settings: normalizeMatchingSettings(saved.settings) };
  }
  async function read(detail, overrideSettings) {
    const [inventory, policy, state] = await Promise.all([repository.listFilament(), settings(), repository.getWorkMatching(detail.item.id)]);
    const selectedSettings = overrideSettings ? normalizeMatchingSettings(overrideSettings) : policy.settings;
    const extracted = requirementsForWork(detail, { override: state.requirementsOverride, estimate: detail.printEstimation?.latestEstimate });
    const selections = Object.fromEntries(extracted.requirements.map(requirement => { const p = latestProposal(state, requirement.id); return [requirement.id, p && ['pending', 'accepted'].includes(p.status) ? p.inventoryId : null]; }).filter(([, id]) => id));
    const result = matchWorkRequirements(extracted.requirements, inventory, selectedSettings, selections, { now: now() });
    for (const row of result.requirements) {
      const proposal = latestProposal(state, row.requirement.id);
      row.proposal = proposal ?? null;
      if (proposal) {
        if (digest(row.requirement) !== proposal.requirementHash) { row.status = 'review'; row.warnings.push('Requirements changed since this offer. Create a new proposal.'); }
        const stock = inventory.find(s => s.id === proposal.inventoryId);
        row.proposalStock = stock ? { active: stock.active, onHandGrams: stock.onHandGrams, colorHex: stock.colorHex, material: stock.material } : null;
        if (!stock?.active || row.requirement.grams != null && (row.selectedOnHandGrams ?? 0) < row.requirement.grams + selectedSettings.stockBufferGrams) {
          row.status = 'purchase'; row.warnings.push('Selected proposal has insufficient current stock.');
        }
        if (stock && (stock.material !== proposal.offered.material || (stock.brandLine ?? null) !== proposal.offered.brandLine || (stock.colorHex || stock.color) !== (proposal.offered.colorHex || proposal.offered.color))) {
          if (row.status !== 'purchase') row.status = 'review'; row.warnings.push('Inventory appearance changed since this offer. Review before production.');
        }
        if (proposal.status === 'declined') row.warnings.push('Customer declined this option; choose another or purchase the requested filament.');
        if (proposal.status === 'accepted' && row.status === 'substitution') row.status = 'ready';
        if (stock && !importedEligibility(stock, { now: now() }).eligible) { row.status = 'review'; row.warnings.push(...importedEligibility(stock, { now: now() }).reasons); }
      }
    }
    return { available: true, applicable: extracted.applicable, settings: policy.settings, settingsRevision: policy.revision, previewSettings: selectedSettings, revision: state.revision, requirementsOverride: state.requirementsOverride, requirements: result.requirements, alerts: [...new Set(result.requirements.filter(row => row.status !== 'ready').map(row => row.status))], totalGrams: extracted.totalGrams, warnings: extracted.warnings, history: state.history, inventory, state };
  }
  const save = (detail, state) => repository.saveWorkMatching({ workId: detail.item.id, revision: state.revision, document: state });
  async function checkedState(detail, revision) {
    revisionNumber(revision);
    const state = await repository.getWorkMatching(detail.item.id);
    if (state.revision !== revision) throw conflict();
    return state;
  }
  const history = (state, operator, type, data = {}) => {
    if (state.history.length >= 2000 || state.proposals.length >= 200) throw new HttpError(409, 'This work has reached its filament history limit. Contact the owner.');
    state.history.push({ type, operatorId: operator.id, occurredAt: now().toISOString(), ...data });
  };
  function guardSending(state) {
    if (state.proposals.some(p => p.delivery?.state === 'sending' && now().getTime() - Date.parse(p.delivery.lastAttemptAt) < 30000)) throw new HttpError(409, 'An approval message is sending. Wait and refresh before changing this work.');
  }
  function verifyOffer(view, proposal) {
    const row = view.requirements.find(row => row.requirement.id === proposal.requirementId);
    if (!row || digest(row.requirement) !== proposal.requirementHash) throw conflict();
    const candidate = [...row.candidates, ...row.furtherCandidates].find(c => c.id === proposal.inventoryId);
    if (!candidate || candidate.material !== proposal.offered.material || candidate.brandLine !== proposal.offered.brandLine || candidate.colorHex !== proposal.offered.colorHex) throw new HttpError(409, 'This offer no longer matches current requirements or inventory. Create a new proposal.');
  }
  async function previewEmail(detail, input) {
    exactFields(input, ['proposalId', 'revision']);
    const state = await checkedState(detail, input.revision), proposal = pendingProposal(state, input.proposalId);
    if (proposal.status !== 'pending') throw new HttpError(409, 'Only pending proposals can request approval.');
    let canSend = true, warning = null;
    try { verifyOffer(await read(detail), proposal); }
    catch (error) { if (error.status !== 409) throw error; canSend = false; warning = error.message; }
    const recipient = detail.request?.contact?.email;
    if (!isValidEmail(recipient)) throw new HttpError(400, 'This request needs a valid customer email before sending.');
    const message = proposal.delivery?.message ?? substitutionMessage({ requestId: detail.item.requestId, recipient, proposal });
    if (message.recipient !== recipient) throw new HttpError(409, 'Customer contact changed. Create a new proposal before sending.');
    return { ...message, canSend, warning, proposalId: proposal.id, revision: state.revision, previewToken: digest([message, state.revision, proposal.id]) };
  }
  return {
    settings,
    async forWork(detail) { const { inventory, state, ...view } = await read(detail); return view; },
    async preview(detail, input) { const { inventory, state, ...view } = await read(detail, input); return view; },
    async saveSettings(input, operator) {
      authorize(operator);
      if (operator.role !== 'owner') throw new HttpError(403, 'Only the owner can change matching settings.');
      exactFields(input, ['revision', 'settings']); revisionNumber(input.revision);
      return repository.saveMatchingSettings({ revision: input.revision, settings: normalizeMatchingSettings(input.settings), operatorId: operator.id });
    },
    async command(detail, input, operator) {
      authorize(operator);
      const fields = {
        'save-requirements': ['requirements'], propose: ['requirementId', 'inventoryId'],
        'accept-on-behalf': ['proposalId', 'reason'], 'record-customer-response': ['proposalId', 'decision', 'reason'], reopen: ['proposalId', 'reason']
      };
      if (!fields[input?.type]) throw new HttpError(400, 'Choose a supported filament command.');
      exactFields(input, ['type', 'revision', ...fields[input.type]]);
      const state = await checkedState(detail, input.revision);
      guardSending(state);
      if (input.type === 'save-requirements') {
        const requirements = input.requirements === null ? null : normalizeRequirements(input.requirements);
        state.requirementsOverride = requirements;
        // Requirement corrections supersede every old selection, preserving its full audit history.
        state.proposals.forEach(p => { if (p.status !== 'superseded') p.status = 'superseded'; });
        history(state, operator, input.type);
      } else if (input.type === 'propose') {
        const view = await read(detail), row = view.requirements.find(row => row.requirement.id === input.requirementId);
        const candidate = row && [...row.candidates, ...row.furtherCandidates].find(c => c.id === input.inventoryId);
        if (!candidate) throw new HttpError(400, 'Choose an available candidate inside the matching limits.');
        state.proposals.filter(p => p.requirementId === input.requirementId && p.status !== 'superseded').forEach(p => { p.status = 'superseded'; });
        const proposal = { id: `sub_${randomUUID().replaceAll('-', '')}`, requirementId: input.requirementId, requirementHash: digest(row.requirement), requested: row.requirement, offered: candidate, inventoryId: candidate.id, inventoryRevision: candidate.inventoryRevision, settings: view.previewSettings, differences: candidate.differences, status: 'pending', createdBy: operator.id, createdAt: now().toISOString(), delivery: { state: 'not_sent' } };
        state.proposals.push(proposal); history(state, operator, 'proposed', { proposalId: proposal.id });
      } else {
        const proposal = pendingProposal(state, input.proposalId), reason = sourceText(input.reason);
        if (input.type === 'reopen') {
          if (!['accepted', 'declined'].includes(proposal.status)) throw new HttpError(409, 'Only decided substitutions can be reopened.');
          proposal.status = 'pending'; delete proposal.decisionSource;
        } else {
          if (proposal.status !== 'pending') throw new HttpError(409, 'This substitution already has a decision. Reopen it first.');
          if (input.type === 'record-customer-response' && !['accepted', 'declined'].includes(input.decision)) throw new HttpError(400, 'Record accepted or declined.');
          if (input.type === 'accept-on-behalf' || input.decision === 'accepted') verifyOffer(await read(detail), proposal);
          proposal.status = input.type === 'accept-on-behalf' ? 'accepted' : input.decision;
          proposal.decisionSource = input.type === 'accept-on-behalf' ? 'operator_on_behalf' : 'customer_response_recorded';
        }
        proposal.decidedAt = now().toISOString();
        history(state, operator, input.type, { proposalId: proposal.id, decision: proposal.status, reason });
      }
      return save(detail, state);
    },
    previewEmail,
    async sendEmail(detail, input, operator) {
      authorize(operator); exactFields(input, ['proposalId', 'revision', 'previewToken']);
      const preview = await previewEmail(detail, { proposalId: input.proposalId, revision: input.revision });
      if (!preview.canSend) throw new HttpError(409, preview.warning);
      if (preview.previewToken !== input.previewToken) throw new HttpError(409, 'Preview the current message before sending.');
      const state = await checkedState(detail, input.revision), proposal = pendingProposal(state, input.proposalId);
      if (proposal.delivery.state === 'sent') return { delivery: proposal.delivery, revision: state.revision };
      guardSending(state);
      if (proposal.delivery.firstAttemptAt && now().getTime() - Date.parse(proposal.delivery.firstAttemptAt) >= 23 * 3600000) throw new HttpError(409, 'The safe retry window has ended. Verify delivery manually; create a new proposal only if another message is needed.');
      const { previewToken, proposalId, revision, canSend, warning, ...message } = preview;
      proposal.delivery = { ...proposal.delivery, state: 'sending', message, firstAttemptAt: proposal.delivery.firstAttemptAt ?? now().toISOString(), lastAttemptAt: now().toISOString() };
      history(state, operator, 'approval-email-started', { proposalId: proposal.id });
      await save(detail, state); // durable claim before any provider side effect
      let outcome;
      try { outcome = await delivery(message, `substitution/${proposal.id}`); } catch { outcome = { state: 'uncertain' }; }
      if (!['sent', 'failed', 'unconfigured', 'uncertain'].includes(outcome?.state)) outcome = { state: 'uncertain' };
      // Merge delivery outcome into the latest document without undoing unrelated edits.
      for (let attempt = 0; attempt < 5; attempt++) {
        const fresh = await repository.getWorkMatching(detail.item.id), target = fresh.proposals.find(p => p.id === proposal.id);
        if (!target) throw conflict();
        target.delivery = { ...target.delivery, state: outcome.state, completedAt: now().toISOString() };
        if (outcome.state === 'unconfigured') delete target.delivery.firstAttemptAt;
        history(fresh, operator, `approval-email-${outcome.state}`, { proposalId: target.id });
        try { const saved = await save(detail, fresh); return { delivery: target.delivery, revision: saved.revision }; }
        catch (error) { if (error.status !== 409 || attempt === 4) throw error; }
      }
    }
  };
}
