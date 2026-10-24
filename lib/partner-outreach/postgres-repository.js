import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '../http.js';
import { authorizationWeek, reserveAuthorization } from './policy.js';
import { freezeOffer } from './domain.js';

export const isUuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new HttpError(400, 'Invalid command data.');
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new HttpError(400, 'Invalid command data.');
}
export const digest = value => createHash('sha256').update(value).digest('hex');

export function createPostgresPartnerRepository({ database }) {
  if (!database?.withTransaction) throw new Error('Partner persistence requires native transactions.');
  const query = (...args) => database.query(...args);
  async function withCommand({ actor, operation, key, payload }, execute) {
    if (!actor || !['OWNER', 'PARTNER', 'SYSTEM'].includes(actor.role) || typeof actor.id !== 'string' || !actor.id || actor.id.length>200) throw new HttpError(403, 'Access denied.');
    if (!isUuid(key) || !/^[a-z][a-z0-9_.-]{0,79}$/.test(operation)) throw new HttpError(400, 'A valid command key and operation are required.');
    const actorKey = `${actor.role}:${actor.id}`, hash = digest(canonicalJson(payload));
    return database.withTransaction(async tx => {
      // A concurrent INSERT with this unique key waits for the first transaction.
      // A failed transaction leaves no receipt, aggregate, reservation or event.
      await tx.query`INSERT INTO partner_command_keys(actor_id,operation,idempotency_key,body_sha256) VALUES(${actorKey},${operation},${key},${hash}) ON CONFLICT DO NOTHING`;
      const [receipt] = await tx.query`SELECT body_sha256,response_json,completed_at FROM partner_command_keys WHERE actor_id=${actorKey} AND operation=${operation} AND idempotency_key=${key} FOR UPDATE`;
      if (receipt.body_sha256 !== hash) throw new HttpError(409, 'This command key was already used for different data.');
      if (receipt.completed_at !== null) return receipt.response_json;
      const result = await execute(tx);
      const serialized = canonicalJson(result);
      await tx.query`UPDATE partner_command_keys SET response_json=${serialized}::jsonb,completed_at=now() WHERE actor_id=${actorKey} AND operation=${operation} AND idempotency_key=${key}`;
      return JSON.parse(serialized);
    });
  }
  async function audit(tx, { programId, actor, action, entityKind, entityId, changes = {} }) {
    const id = randomUUID();
    await tx.query`INSERT INTO partner_audit_events(id,program_id,actor_kind,actor_id,action,entity_kind,entity_id,minimal_diff) VALUES(${id},${programId},${actor.role},${actor.id},${action},${entityKind},${entityId},${JSON.stringify(changes)}::jsonb)`;
    // Outbox carries identifiers only. Optional delivery is after the transaction.
    await tx.query`INSERT INTO partner_outbox(id,event_id,event_type,payload) VALUES(${randomUUID()},${id},${action},${JSON.stringify({ programId, entityKind, entityId })}::jsonb)`;
  }
  async function lockProgram(tx, programId) {
    const [program] = await tx.query`SELECT * FROM partner_programs WHERE id=${programId} FOR UPDATE`;
    if (!program) throw new HttpError(404, 'Program not found.');
    return program;
  }
  async function getGig(tx, { actor, gigId, lock = false }) {
    if (!isUuid(gigId)) throw new HttpError(404, 'Gig not found.');
    let rows;
    if (actor?.role === 'PARTNER') rows = lock ? await tx.query`SELECT * FROM partner_gigs WHERE id=${gigId} AND partner_id=${actor.id} FOR UPDATE` : await tx.query`SELECT * FROM partner_gigs WHERE id=${gigId} AND partner_id=${actor.id}`;
    else if (actor?.role === 'OWNER') rows = lock ? await tx.query`SELECT * FROM partner_gigs WHERE id=${gigId} FOR UPDATE` : await tx.query`SELECT * FROM partner_gigs WHERE id=${gigId}`;
    else throw new HttpError(403, 'Access denied.');
    if (!rows[0]) throw new HttpError(404, 'Gig not found.');
    return rows[0];
  }
  // Internal primitive: authorizationApproved is produced by the trusted review
  // service, never a value accepted from a browser command. It is checked again
  // alongside the persisted program flag and civil-date eligibility under lock.
  async function reserveGig(tx, { actor, gigId, expectedRevision, instant, authorizationApproved = false }) {
    if (actor?.role !== 'PARTNER' || !isUuid(actor.id)) throw new HttpError(403, 'Access denied.');
    // Consistent ordering: account -> program -> gig -> week. Revocation locks the
    // same account; program changes cannot interleave with acceptance.
    const [account] = await tx.query`SELECT program_id,status FROM partner_accounts WHERE id=${actor.id} FOR UPDATE`;
    if (!account || account.status !== 'active') throw new HttpError(403, 'Access denied.');
    const program = await lockProgram(tx, account.program_id);
    const gig = await getGig(tx, { actor, gigId, lock: true });
    if (gig.revision !== expectedRevision || gig.status !== 'offered') throw new HttpError(409, 'This offer has changed. Refresh and review it again.');
    const dateParts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
    const civil = Object.fromEntries(dateParts.map(x=>[x.type,x.value]));
    const date = `${civil.year}-${civil.month}-${civil.day}`;
    const civilDate = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
    const starts = civilDate(program.starts_on), ends = civilDate(program.ends_on);
    if (!authorizationApproved || !program.enabled || date < starts || date > ends || date > '2026-12-31') throw new HttpError(409, 'New work authorizations are unavailable. Existing obligations remain recorded.');
    const terms = freezeOffer(gig.terms_snapshot);
    if (date > terms.deadline) throw new HttpError(409, 'This offer has expired.');
    const week = authorizationWeek(instant);
    await tx.query`INSERT INTO partner_program_weeks(id,program_id,week_start_local,cap_cents) VALUES(${randomUUID()},${program.id},${week},${program.default_weekly_cap_cents}) ON CONFLICT(program_id,week_start_local) DO NOTHING`;
    const [budget] = await tx.query`SELECT * FROM partner_program_weeks WHERE program_id=${program.id} AND week_start_local=${week} FOR UPDATE`;
    const next = reserveAuthorization({capCents:budget.cap_cents,committedCents:budget.committed_cents},terms.feeCents,terms.maximumBonusCents);
    await tx.query`UPDATE partner_program_weeks SET committed_cents=${next.committedCents},revision=revision+1 WHERE id=${budget.id}`;
    await tx.query`UPDATE partner_gigs SET status='accepted',revision=revision+1,program_week_id=${budget.id},accepted_fee_cents=${terms.feeCents},maximum_bonus_cents=${terms.maximumBonusCents},accepted_at=${instant} WHERE id=${gig.id} AND partner_id=${actor.id}`;
    await tx.query`INSERT INTO partner_budget_reservations(id,program_week_id,gig_id,amount_cents) VALUES(${randomUUID()},${budget.id},${gig.id},${terms.feeCents+terms.maximumBonusCents})`;
    await audit(tx,{programId:program.id,actor,action:'gig.accepted',entityKind:'gig',entityId:gig.id,changes:{feeCents:terms.feeCents,maximumBonusCents:terms.maximumBonusCents,authorizationWeek:week}});
    return {id:gig.id,status:'accepted',revision:gig.revision+1,feeCents:terms.feeCents,maximumBonusCents:terms.maximumBonusCents,authorizationWeek:week};
  }
  return {query,withCommand,audit,lockProgram,getGig,reserveGig};
}
