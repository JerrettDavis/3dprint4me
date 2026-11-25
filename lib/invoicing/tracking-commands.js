import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { presentInvoiceTracking } from './tracking-domain.js';
import { normalizeTaxSchedule, generateTaxPeriods, acknowledgeTaxPeriod } from './tax-periods.js';

const bad = message => { throw new HttpError(400, message ?? 'A valid billing command is required.'); };
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) bad();
}
function owner(actor) {
  if (!actor?.id || actor.role !== 'owner' || actor.enabled === false) throw new HttpError(403, 'Only an enabled owner can manage billing.');
}
function localDay(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function mergePeriods(existing, generated) {
  const periods = new Map(existing.map(period => [period.id, period]));
  for (const period of generated) {
    if (periods.has(period.id)) continue;
    if ([...periods.values()].some(old => old.startsOn <= period.endsOn && old.endsOn >= period.startsOn)) {
      bad('The new filing schedule overlaps an existing reporting period. Review its effective date.');
    }
    periods.set(period.id, period);
  }
  if (periods.size > 120) bad('Review older filing periods before extending this schedule.');
  return [...periods.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

export function presentBillingTracking(raw, { now = new Date(), machine = false, linkedWorks = [] } = {}) {
  const model = presentInvoiceTracking(raw.snapshot?.invoices ?? [], { now, timeZone: raw.settings.timeZone });
  const linked = new Set(linkedWorks.map(row => row.workId));
  const review = new Set((raw.snapshot?.warnings ?? []).map(row => row.invoiceId));
  const needsInvoicing = raw.settings.workBilling.filter(row => row.state === 'needs_invoice' && !linked.has(row.workId))
    .map(row => ({ workId: row.workId, url: `https://work.3dprint4.me/work/${row.workId}` }));
  const last = raw.lastSuccessfulAt;
  const sync = { status: raw.errorCategory ? 'unavailable' : !last ? 'never_synced' : now.getTime() - Date.parse(last) > 300000 ? 'stale' : 'current',
    lastSuccessfulAt: last, errorCategory: raw.errorCategory };
  const items = model.rows.filter(row => !row.deleted && !row.archived).map(row => ({ id: row.id, number: row.number,
    status: row.status, currency: row.currency, totalCents: row.totalCents, balanceCents: row.balanceCents,
    paidCents: row.paidCents, dueDate: row.partialDueDate && row.status === 'partially_paid' ? row.partialDueDate : row.dueDate,
    overdue: row.overdue, viewed: row.viewed, opened: row.opened, reviewRequired: review.has(row.id), editorUrl: row.editorUrl }));
  const taxPeriods = raw.settings.taxPeriods.map(period => ({ id: period.id, startsOn: period.startsOn,
    endsOn: period.endsOn, dueDate: period.dueDate, submitted: Boolean(period.submitted), paid: Boolean(period.paid) }));
  return { version: 1, generatedAt: now.toISOString(), sync, counts: { ...model.counts, needsInvoicing: needsInvoicing.length, reviewRequired: review.size },
    totals: model.totals, items, needsInvoicing, tax: { configured: Boolean(raw.settings.taxSchedule), periods: taxPeriods },
    ...(machine ? {} : { revision: raw.revision, settings: raw.settings }) };
}

export function createInvoiceTrackingCommands({ repository, workRepository, now = () => new Date() }) {
  return {
    async execute(input, actor) {
      owner(actor);
      if (!input || !['settings', 'work-disposition', 'tax-acknowledge', 'tax-correct', 'retry-notification'].includes(input.action) ||
          typeof input.commandId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.commandId) ||
          !Number.isSafeInteger(input.revision) || input.revision < 1) bad();
      let normalized, mutate, work, retryEventId;
      const at = now();
      if (input.action === 'retry-notification') {
        exact(input, ['action', 'commandId', 'revision', 'eventId']);
        if (typeof input.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(input.eventId)) bad();
        retryEventId = input.eventId; normalized = { eventId: retryEventId }; mutate = settings => settings;
      } else if (input.action === 'settings') {
        exact(input, ['action', 'commandId', 'revision', 'settings']);
        exact(input.settings, ['timeZone', 'notificationsEnabled', 'taxSchedule']);
        const { timeZone, notificationsEnabled } = input.settings;
        if (typeof timeZone !== 'string' || timeZone.length > 100 || typeof notificationsEnabled !== 'boolean' || input.settings.taxSchedule === undefined) bad();
        try { localDay(at, timeZone); } catch { bad('Choose a supported billing timezone.'); }
        let taxSchedule;
        try { taxSchedule = input.settings.taxSchedule === null ? null : normalizeTaxSchedule(input.settings.taxSchedule, { actorId: actor.id, now: at }); }
        catch { bad('Review and confirm the actual filing frequency, due-day rule and holiday calendar.'); }
        if (taxSchedule && (taxSchedule.frequency !== 'monthly' || taxSchedule.dueDay !== 20 || !taxSchedule.nextBusinessDay)) {
          bad('OKTAP reminders require the confirmed monthly twentieth-day rule with business-day adjustment.');
        }
        if (taxSchedule && taxSchedule.timeZone !== timeZone) bad('The filing schedule must use the confirmed billing timezone.');
        normalized = { timeZone, notificationsEnabled, taxSchedule };
        mutate = settings => ({ ...settings, ...normalized, taxPeriods: taxSchedule ?
          mergePeriods(settings.taxPeriods, generateTaxPeriods(taxSchedule, { through: localDay(at, timeZone) })) : settings.taxPeriods });
      } else if (input.action === 'work-disposition') {
        exact(input, ['action', 'commandId', 'revision', 'workId', 'workRevision', 'state', 'invoiceId']);
        if (typeof input.workId !== 'string' || !/^work_[A-Za-z0-9_-]{8,123}$/.test(input.workId) ||
            !Number.isSafeInteger(input.workRevision) || input.workRevision < 1 || !['needs_invoice', 'no_charge', 'linked'].includes(input.state)) bad();
        if (!workRepository) throw new HttpError(503, 'Work billing is temporarily unavailable.');
        const detail = await workRepository.getWork(input.workId, actor);
        if (detail.item.kind === 'inquiry' || detail.item.projectDraft || detail.item.revision !== input.workRevision) {
          throw new HttpError(409, 'Reload the confirmed project before changing billing.');
        }
        if (input.state === 'linked') {
          const tracking = await repository.readTracking();
          if (typeof input.invoiceId !== 'string' || !tracking.snapshot?.invoices.some(row => row.id === input.invoiceId)) bad('Choose an invoice in the fabrication billing scope.');
        } else if (input.invoiceId !== undefined) bad();
        if (input.state === 'needs_invoice' && (await repository.linkedWorks()).some(row => row.workId === input.workId)) {
          throw new HttpError(409, 'This project already has an invoice. Review its billing record.');
        }
        work = { id: input.workId, revision: input.workRevision };
        normalized = { workId: input.workId, state: input.state, ...(input.state === 'linked' ? { invoiceId: input.invoiceId } : {}) };
        mutate = settings => {
          const rows = settings.workBilling.filter(row => row.workId !== input.workId);
          if (rows.length >= 1000) bad('Review older work billing records before adding more.');
          return { ...settings, workBilling: [...rows, { ...normalized, confirmedBy: actor.id, confirmedAt: at.toISOString() }] };
        };
      } else {
        exact(input, ['action', 'commandId', 'revision', 'periodId', 'kind', 'date', 'reference']);
        if (typeof input.periodId !== 'string' || !/^ok-sales-\d{4}-(?:\d{2}|Q[1-4])$/.test(input.periodId) ||
            !['submitted', 'paid'].includes(input.kind) || typeof input.reference !== 'string' ||
            input.reference.trim().length < 5 || input.reference.length > 500 || /[\x00-\x1f<>]/.test(input.reference)) bad();
        if (input.action === 'tax-correct' && input.date !== undefined) bad();
        normalized = { periodId: input.periodId, kind: input.kind, ...(input.date === undefined ? {} : { date: input.date }), reference: input.reference.trim() };
        mutate = settings => {
          const period = settings.taxPeriods.find(row => row.id === input.periodId);
          if (!period) bad('Choose an existing reporting period.');
          let changed;
          if (input.action === 'tax-acknowledge') {
            if (period[input.kind]) throw new HttpError(409, 'That filing action is already acknowledged. Use an explicit correction first.');
            try { changed = acknowledgeTaxPeriod(period, { kind: normalized.kind, date: normalized.date, reference: normalized.reference },
              { actorId: actor.id, now: at, timeZone: settings.timeZone }); }
            catch { bad('Review the actual filing or payment date and confirmation reference.'); }
          } else {
          const current = period.reminderRevisions?.[input.kind] ?? 0;
          if (!Number.isSafeInteger(current) || current < 0 || current >= 10000) bad('Review the reporting period reminder history.');
          changed = { ...period, [input.kind]: null, reminderRevisions: { ...period.reminderRevisions, [input.kind]: current + 1 } };
          }
          return { ...settings, taxPeriods: settings.taxPeriods.map(row => row.id === input.periodId ? changed : row) };
        };
      }
      // Exclude clock-generated confirmation timestamps from command identity so a
      // retried browser request retains the same fingerprint after a timeout.
      const identity = { ...normalized };
      if (identity.taxSchedule) { identity.taxSchedule = { ...identity.taxSchedule }; delete identity.taxSchedule.confirmedAt; }
      const fingerprint = createHash('sha256').update(JSON.stringify({ action: input.action, revision: input.revision, normalized: identity, work })).digest('hex');
      return repository.command({ id: input.commandId, actorId: actor.id, revision: input.revision, fingerprint, mutate, work, retryEventId,
        audit: { action: input.action, details: normalized } });
    }
  };
}
