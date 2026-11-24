import { createHash } from 'node:crypto';
import { HttpError } from '../http.js';
import { generateTaxPeriods, taxReminderEvents } from './tax-periods.js';

const invalid = () => { throw new TypeError('Invalid invoice tracking operation.'); };
function time(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  return new Date(value).toISOString();
}
function lease(input) {
  if (!input || typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.token) ||
      !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1000 || input.leaseMs > 300000) invalid();
  const now = time(input.now);
  return { now, until: new Date(Date.parse(now) + input.leaseMs).toISOString() };
}
const iso = value => value == null ? null : new Date(value).toISOString();
const present = row => ({ revision: row.revision, settings: row.settings, snapshot: row.snapshot,
  lastSuccessfulAt: iso(row.last_successful_at), lastAttemptAt: iso(row.last_attempt_at), errorCategory: row.error_category });

export function createInvoiceTrackingRepository({ database }) {
  if (typeof database?.withTransaction !== 'function') throw new TypeError('Invoice tracking requires native PostgreSQL transactions.');
  const state = async tx => (await tx.query`SELECT * FROM invoice_tracking_state WHERE singleton FOR UPDATE`)[0];
  return {
    async advanceTax({ now: inputTime }) {
      const now = time(inputTime);
      return database.withTransaction(async tx => {
        const row = await state(tx);
        const settings = structuredClone(row.settings);
        if (!settings.taxSchedule) return { configured: false, added: 0 };
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: settings.taxSchedule.timeZone,
          year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
        const part = type => parts.find(p => p.type === type).value;
        const through = `${part('year')}-${part('month')}-${part('day')}`;
        const periods = new Map(settings.taxPeriods.map(period => [period.id, period]));
        let added = 0;
        for (const period of generateTaxPeriods(settings.taxSchedule, { through })) {
          if (periods.has(period.id)) continue;
          if ([...periods.values()].some(old => old.startsOn <= period.endsOn && old.endsOn >= period.startsOn)) invalid();
          periods.set(period.id, period); added++;
        }
        if (periods.size > 120) invalid();
        settings.taxPeriods = [...periods.values()].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
        if (added) await tx.query`UPDATE invoice_tracking_state SET settings=${JSON.stringify(settings)}::jsonb,revision=revision+1 WHERE singleton`;
        for (const event of taxReminderEvents(settings.taxPeriods, { now: new Date(now), timeZone: settings.taxSchedule.timeZone })) {
          const key = createHash('sha256').update(`oktap:${event.id}`).digest('hex');
          await tx.query`INSERT INTO invoice_tracking_events(id,payload,delivery_state,available_at,created_at)
            VALUES(${key},${JSON.stringify(event)}::jsonb,${settings.notificationsEnabled ? 'pending' : 'suppressed'},${now}::timestamptz,${now}::timestamptz)
            ON CONFLICT(id) DO NOTHING`;
        }
        return { configured: true, added };
      });
    },
    async readTracking() { return present((await database.query`SELECT * FROM invoice_tracking_state WHERE singleton`)[0]); },
    async linkedWorks() {
      const rows = await database.query`SELECT work_item_id,provider->>'id' AS invoice_id FROM invoice_operations WHERE provider->>'id' IS NOT NULL`;
      return rows.map(row => ({ workId: row.work_item_id, invoiceId: row.invoice_id }));
    },
    async command({ id, actorId, fingerprint, revision, mutate, work, audit = {} }) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(id) || typeof actorId !== 'string' ||
          actorId.length < 1 || actorId.length > 200 || !/^[a-f0-9]{64}$/.test(fingerprint) ||
          !Number.isSafeInteger(revision) || revision < 1 || typeof mutate !== 'function') invalid();
      return database.withTransaction(async tx => {
        const row = await state(tx);
        const receipt = (await tx.query`SELECT * FROM invoice_tracking_commands WHERE id=${id}`)[0];
        if (receipt) {
          if (receipt.actor_id !== actorId || receipt.fingerprint !== fingerprint) throw new HttpError(409, 'This billing command already has a different confirmation.');
          return receipt.result;
        }
        if (row.revision !== revision) throw new HttpError(409, 'Billing settings changed. Reload and review.');
        if (work) {
          if (typeof work.id !== 'string' || !/^work_[A-Za-z0-9_-]{8,123}$/.test(work.id) || !Number.isSafeInteger(work.revision) || work.revision < 1) invalid();
          const projects = await tx.query`SELECT revision FROM work_items WHERE id=${work.id} AND revision=${work.revision} FOR SHARE`;
          if (!projects.length) throw new HttpError(409, 'The project changed. Reload and review billing.');
        }
        const settings = mutate(structuredClone(row.settings));
        if (!settings || typeof settings !== 'object' || Array.isArray(settings) || typeof settings.then === 'function') invalid();
        const result = { revision: revision + 1, settings };
        await tx.query`UPDATE invoice_tracking_state SET settings=${JSON.stringify(settings)}::jsonb,revision=${result.revision} WHERE singleton`;
        await tx.query`INSERT INTO invoice_tracking_commands(id,actor_id,fingerprint,command,result)
          VALUES(${id},${actorId},${fingerprint},${JSON.stringify(audit)}::jsonb,${JSON.stringify(result)}::jsonb)`;
        return result;
      });
    },
    async claimSync(input) {
      const { now, until } = lease(input);
      const rows = await database.query`UPDATE invoice_tracking_state SET sync_token=${input.token}, sync_lease_until=${until}::timestamptz,
        last_attempt_at=${now}::timestamptz WHERE singleton AND (sync_lease_until IS NULL OR sync_lease_until<=${now}::timestamptz) RETURNING *`;
      return rows.length ? { ...present(rows[0]), token: input.token } : null;
    },
    async commitSnapshot({ token, now: inputTime, snapshot, events }) {
      const now = time(inputTime);
      if (!snapshot?.source || !Array.isArray(snapshot.invoices) || !Array.isArray(snapshot.allocations) || !Array.isArray(events) || events.length > 10000) invalid();
      return database.withTransaction(async tx => {
        const row = await state(tx);
        if (row.sync_token !== token || Date.parse(row.sync_lease_until) <= Date.parse(now)) return false;
        if (row.snapshot && (row.snapshot.source.companyId !== snapshot.source.companyId || row.snapshot.source.groupId !== snapshot.source.groupId)) invalid();
        for (const event of events) {
          const key = createHash('sha256').update(`${snapshot.source.companyId}:${snapshot.source.groupId}:${event.id}`).digest('hex');
          await tx.query`INSERT INTO invoice_tracking_events(id,payload,delivery_state,available_at,created_at)
            VALUES(${key},${JSON.stringify(event)}::jsonb,${row.settings.notificationsEnabled ? 'pending' : 'suppressed'},${now}::timestamptz,${now}::timestamptz)
            ON CONFLICT(id) DO NOTHING`;
        }
        await tx.query`UPDATE invoice_tracking_state SET snapshot=${JSON.stringify(snapshot)}::jsonb,last_successful_at=${now}::timestamptz,
          error_category=NULL,sync_token=NULL,sync_lease_until=NULL WHERE singleton`;
        return true;
      });
    },
    async recordSyncFailure({ token, now: inputTime, category = 'provider_unavailable' }) {
      const now = time(inputTime);
      if (!['provider_unavailable', 'source_changed'].includes(category)) invalid();
      const rows = await database.query`UPDATE invoice_tracking_state SET error_category=${category},sync_token=NULL,sync_lease_until=NULL
        WHERE singleton AND sync_token=${token} AND sync_lease_until>${now}::timestamptz RETURNING singleton`;
      return rows.length === 1;
    },
    async listEvents() {
      const rows = await database.query`SELECT id,payload,delivery_state,attempts FROM invoice_tracking_events ORDER BY created_at,id LIMIT 1000`;
      return rows.map(row => ({ id: row.id, payload: row.payload, deliveryState: row.delivery_state, attempts: row.attempts }));
    },
    async claimEvents(input) {
      const { now, until } = lease(input);
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) invalid();
      const rows = await database.query`UPDATE invoice_tracking_events SET delivery_state='leased',lease_token=${input.token},
        lease_until=${until}::timestamptz,attempts=attempts+1 WHERE id IN (
          SELECT id FROM invoice_tracking_events WHERE (delivery_state='pending' AND available_at<=${now}::timestamptz)
            OR (delivery_state='leased' AND lease_until<=${now}::timestamptz)
          ORDER BY available_at,id LIMIT ${input.limit} FOR UPDATE SKIP LOCKED)
        RETURNING id,payload,attempts`;
      return rows.map(row => ({ id: row.id, payload: row.payload, attempts: row.attempts }));
    },
    async finishEvent({ id, token, now: inputTime, delivered, retryAt = null }) {
      const now = time(inputTime);
      if (typeof delivered !== 'boolean' || !/^[a-f0-9]{64}$/.test(id)) invalid();
      const next = retryAt === null ? null : time(retryAt);
      const rows = await database.query`UPDATE invoice_tracking_events SET delivery_state=${delivered ? 'delivered' : next ? 'pending' : 'failed'},
        available_at=COALESCE(${next}::timestamptz,available_at),lease_token=NULL,lease_until=NULL,
        delivered_at=${delivered ? now : null}::timestamptz
        WHERE id=${id} AND delivery_state='leased' AND lease_token=${token} AND lease_until>${now}::timestamptz RETURNING id`;
      return rows.length === 1;
    }
  };
}
