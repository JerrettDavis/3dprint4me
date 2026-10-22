import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalPrintRepository } from '../../lib/print-estimation/adapters/local-print-repository.js';
import { normalizeFilamentInput } from '../../lib/print-estimation/inventory.js';
import { createFilamentMatchingUseCases } from '../../lib/filament-matching/application.js';

const detail = { item: { id: 'work_aaaaaaaa', requestId: '3DP-TEST-12345678' }, request: { service: 'print', specifications: { material: 'pla', color: 'blue', grams: '20' }, contact: { email: 'customer@example.com' } } };
const operator = { id: 'op_a', role: 'operator' };
test('proposal decisions are explicit, revisioned, preserve snapshots and history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-proposal-'));
  try {
    const repository = createLocalPrintRepository({ path: join(dir, 'print.json') });
    const stock = await repository.saveFilament(normalizeFilamentInput({ material: 'pla', colorHex: '#1000ff', spoolNominalGrams: 1000, purchaseCostCents: 2000, onHandGrams: 500 }));
    const app = createFilamentMatchingUseCases({ repository });
    const view = await app.forWork(detail);
    assert.equal(view.available, true); assert.equal(view.requirements[0].recommendedId, stock.id);
    await assert.rejects(app.saveSettings({ revision: 0, settings: {} }, operator), { status: 403 });
    let state = await app.command(detail, { type: 'propose', revision: 0, requirementId: 'color_1', inventoryId: stock.id }, operator);
    const proposalId = state.proposals[0].id;
    assert.equal(state.proposals[0].status, 'pending');
    await assert.rejects(app.command(detail, { type: 'accept-on-behalf', revision: state.revision, proposalId, reason: '' }, operator), { status: 400 });
    await assert.rejects(app.command(detail, { type: 'accept-on-behalf', revision: 0, proposalId, reason: 'Verbal call' }, operator), { status: 409 });
    state = await app.command(detail, { type: 'accept-on-behalf', revision: state.revision, proposalId, reason: 'Verbal call' }, operator);
    assert.equal(state.proposals[0].status, 'accepted'); assert.equal(state.proposals[0].decisionSource, 'operator_on_behalf');
    state = await app.command(detail, { type: 'reopen', revision: state.revision, proposalId, reason: 'Customer changed mind' }, operator);
    state = await app.command(detail, { type: 'record-customer-response', revision: state.revision, proposalId, decision: 'declined', reason: 'Email reply' }, operator);
    assert.equal(state.proposals[0].status, 'declined'); assert.ok(state.history.length >= 4);
    assert.equal(state.proposals[0].offered.colorHex, '#1000ff');
    await assert.rejects(app.command(detail, { type: 'propose', revision: state.revision, requirementId: 'color_1', inventoryId: 'fil_unknown000' }, operator), { status: 400 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('customer mail failure remains pending and copyable; retry is idempotent and never approves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-mail-'));
  try {
    const repository = createLocalPrintRepository({ path: join(dir, 'print.json') });
    const stock = await repository.saveFilament(normalizeFilamentInput({ material: 'pla', colorHex: '#1000ff', spoolNominalGrams: 1000, purchaseCostCents: 2000, onHandGrams: 500 }));
    let sends = 0;
    const app = createFilamentMatchingUseCases({ repository, delivery: async () => { sends++; return { state: 'sent' }; } });
    let state = await app.command(detail, { type: 'propose', revision: 0, requirementId: 'color_1', inventoryId: stock.id }, operator);
    const proposalId = state.proposals[0].id;
    const preview = await app.previewEmail(detail, { proposalId, revision: state.revision });
    assert.equal(preview.recipient, 'customer@example.com'); assert.match(preview.text, /reply/i);
    await app.sendEmail(detail, { proposalId, revision: state.revision, previewToken: preview.previewToken }, operator);
    state = await repository.getWorkMatching(detail.item.id);
    assert.equal(state.proposals[0].status, 'pending'); assert.equal(state.proposals[0].delivery.state, 'sent');
    const again = await app.previewEmail(detail, { proposalId, revision: state.revision });
    await app.sendEmail(detail, { proposalId, revision: state.revision, previewToken: again.previewToken }, operator);
    assert.equal(sends, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stock changes preserve offers and copyable mail, permit declines, and block stale acceptance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-stale-'));
  try {
    const repository = createLocalPrintRepository({ path: join(dir, 'print.json') });
    const stockInput = normalizeFilamentInput({ material: 'pla', colorHex: '#1000ff', spoolNominalGrams: 1000, purchaseCostCents: 2000, onHandGrams: 500 });
    const stock = await repository.saveFilament(stockInput);
    const app = createFilamentMatchingUseCases({ repository, delivery: async () => ({ state: 'unconfigured' }) });
    let state = await app.command(detail, { type: 'propose', revision: 0, requirementId: 'color_1', inventoryId: stock.id }, operator);
    const proposalId = state.proposals[0].id;
    let preview = await app.previewEmail(detail, { proposalId, revision: state.revision });
    await app.sendEmail(detail, { proposalId, revision: state.revision, previewToken: preview.previewToken }, operator);
    state = await repository.getWorkMatching(detail.item.id);
    await repository.saveFilament({ ...stockInput, id: stock.id, revision: 1, onHandGrams: 0 });
    const view = await app.forWork(detail); assert.equal(view.requirements[0].status, 'purchase');
    preview = await app.previewEmail(detail, { proposalId, revision: state.revision });
    assert.match(preview.text, /#1000ff/); assert.equal(preview.canSend, false);
    await assert.rejects(app.command(detail, { type: 'accept-on-behalf', revision: state.revision, proposalId, reason: 'Call' }, operator), { status: 409 });
    state = await app.command(detail, { type: 'record-customer-response', revision: state.revision, proposalId, decision: 'declined', reason: 'Email' }, operator);
    assert.equal(state.proposals[0].status, 'declined');
    assert.equal(state.proposals[0].offered.colorHex, '#1000ff');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('simultaneous sends have one durable claim and expired uncertainty cannot resend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filament-concurrent-'));
  try {
    const repository = createLocalPrintRepository({ path: join(dir, 'print.json') });
    const stock = await repository.saveFilament(normalizeFilamentInput({ material: 'pla', colorHex: '#1000ff', spoolNominalGrams: 1000, purchaseCostCents: 2000, onHandGrams: 500 }));
    let time = new Date('2026-10-21T12:00:00Z'), calls = 0;
    const app = createFilamentMatchingUseCases({ repository, now: () => time, delivery: async () => { calls++; return { state: 'uncertain' }; } });
    let state = await app.command(detail, { type: 'propose', revision: 0, requirementId: 'color_1', inventoryId: stock.id }, operator);
    const proposalId = state.proposals[0].id, preview = await app.previewEmail(detail, { proposalId, revision: state.revision });
    const input = { proposalId, revision: state.revision, previewToken: preview.previewToken };
    const results = await Promise.allSettled([app.sendEmail(detail, input, operator), app.sendEmail(detail, input, operator)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(calls, 1);
    state = await repository.getWorkMatching(detail.item.id);
    time = new Date('2026-10-22T12:00:00Z');
    const retry = await app.previewEmail(detail, { proposalId, revision: state.revision });
    await assert.rejects(app.sendEmail(detail, { proposalId, revision: state.revision, previewToken: retry.previewToken }, operator), { status: 409 });
    assert.equal(calls, 1);
    state = await app.command(detail, { type: 'save-requirements', revision: state.revision, requirements: [{ id: 'new', material: 'pla', color: 'red' }] }, operator);
    assert.equal(state.proposals[0].status, 'superseded');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
