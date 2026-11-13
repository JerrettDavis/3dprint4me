import test from 'node:test';
import assert from 'node:assert/strict';
import { previewFeedback, createPreviewFeedback } from '../../customizer/framework/preview-feedback.js';

test('initial generation and later edits explain what is happening without inventing progress', () => {
  const initial = previewFeedback({ status: 'building', hasPreview: false });
  assert.equal(initial.busy, true);
  assert.match(initial.title, /Building/);
  assert.match(initial.detail, /browser/);
  const update = previewFeedback({ status: 'building', hasPreview: true });
  assert.match(update.title, /Updating/);
  assert.match(update.detail, /previous preview/);
  assert.doesNotMatch(JSON.stringify(update), /\d+%/);
});

test('print readiness does not imply a realistic preview has finished', () => {
  const preview = previewFeedback({ status: 'ready', phase: 'loading', realistic: true, hasPreview: true });
  assert.equal(preview.busy, true);
  assert.match(preview.title, /realistic preview/);
  assert.match(preview.detail, /print file is ready/i);
  assert.equal(previewFeedback({ status: 'ready', phase: 'ready' }).busy, false);
});

test('slow work is explained, and errors never retain a busy indicator', () => {
  assert.match(previewFeedback({ status: 'building', slow: true }).detail, /taking longer/);
  const failed = previewFeedback({ status: 'error', phase: 'loading' });
  assert.equal(failed.busy, false);
  assert.match(failed.title, /needs attention/);
  const unavailable = previewFeedback({ status: 'ready', phase: 'error', realistic: true });
  assert.equal(unavailable.busy, false);
  assert.match(unavailable.detail, /Retry preview/);
});

test('continuous edits do not reset the long-wait timer, and readiness/errors clear it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const title = { textContent: '' };
  const detail = { textContent: '' };
  const panel = { dataset: {}, setAttribute() {}, querySelector: key => key === 'strong' ? title : detail };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => panel };
  t.after(() => { globalThis.document = previousDocument; });
  const stage = { dataset: {}, setAttribute(key, value) { this[key] = value; }, after() {} };
  const feedback = createPreviewFeedback(stage);
  feedback.update({ status: 'building', hasPreview: true });
  assert.equal(stage['aria-busy'], 'true');
  t.mock.timers.tick(7999);
  assert.doesNotMatch(detail.textContent, /taking longer/);
  feedback.update({ status: 'building', hasPreview: true });
  t.mock.timers.tick(1);
  assert.match(detail.textContent, /taking longer/);
  feedback.update({ status: 'ready', phase: 'ready' });
  assert.equal(stage['aria-busy'], 'false');
  assert.equal(panel.hidden, true);
  t.mock.timers.tick(10000);
  assert.equal(panel.hidden, true);
  feedback.update({ status: 'building', hasPreview: true });
  assert.doesNotMatch(detail.textContent, /taking longer/);
  feedback.update({ status: 'error' });
  t.mock.timers.tick(10000);
  assert.equal(panel.dataset.busy, 'false');
  assert.doesNotMatch(detail.textContent, /taking longer/);
});
