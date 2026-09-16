import '../js/site.js?v=72c3aa9ae76ea28e';
import { INQUIRY_LIMITS, validateAttachment, validateInquiry, normalizeInquiry, projectShareUrl } from './inquiry-core.js?v=72c3aa9ae76ea28e';
import { PROJECTS, INTENT_LABELS } from './projects.js?v=72c3aa9ae76ea28e';
import { submitInquiry } from './inquiry-client.js?v=72c3aa9ae76ea28e';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const ico = (id) => `<svg class="icon" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const STORAGE = { draft: '3dp-inquiry-draft-v1', theme: '3dp-theme', recovery: '3dp-inquiry-recovery-v1' };
const readStorage = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const removeStorage = (key) => { try { localStorage.removeItem(key); return true; } catch { return false; } };
const form = $('#inquiry-form');
const state = { files: [], context: { entryPoint: 'unknown', exampleSlug: null }, id: null, record: null, saving: false, toastTimer: null, media: new Map(), imageStarted: new Set(), theme: 'system' };
const byteSize = (size) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
const makeId = () => [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.hidden = false;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { node.hidden = true; }, 4800);
}
function updateModalState() { document.body.classList.toggle('modal-open', Boolean($('dialog[open]'))); }
function showDialog(dialog, focus = null) {
  $$('dialog[open]').forEach(open => { if (open !== dialog) open.close(); });
  if (!dialog.open) dialog.showModal();
  updateModalState();
  if (focus) requestAnimationFrame(() => focus.focus({ preventScroll: true }));
}
$$('dialog').forEach(dialog => {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const available = $$('button, [href], input, select, textarea, iframe, [tabindex]', dialog)
      .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    const first = available[0], last = available[available.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement.tabIndex < 0)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener('close', () => {
    updateModalState();
    if (dialog.id === 'project-dialog') {
      try { const url = new URL(location.href); url.searchParams.delete('project'); history.replaceState(null, '', url); } catch { /* file preview may disallow history changes */ }
    }
  });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
});
function renderGallery() {
  $('#project-grid').innerHTML = PROJECTS.map(project => `<a class="work-card" href="?project=${project.slug}" data-project="${project.slug}" data-category="${project.category}"><div class="work-card-image"><img class="project-image" data-project-image="${project.slug}" src="${project.image}" alt="${esc(project.alt)}" width="900" height="620" loading="lazy"><span class="work-card-label">${esc(project.label)}</span><span class="media-note" data-media-label="${project.slug}">${esc(project.media)}</span></div><div class="work-card-body"><h3>${esc(project.title)}</h3><p>${esc(project.summary)}</p><span class="work-card-footer">See the idea behind it ${ico('diagonal')}</span></div></a>`).join('');
}
renderGallery();
$$('[data-filter]').forEach(button => button.addEventListener('click', () => {
  $$('[data-filter]').forEach(other => { const selected = other === button; other.classList.toggle('active', selected); other.setAttribute('aria-pressed', String(selected)); });
  const filter = button.dataset.filter;
  $$('.work-card').forEach(card => { card.hidden = filter !== 'all' && card.dataset.category !== filter; });
  const count = $$('.work-card:not([hidden])').length;
  $('#filter-status').textContent = `Showing ${count} ${count === 1 ? 'project' : 'projects'}${filter === 'all' ? ' in all work' : ` in ${button.textContent.trim()}`}.`;
}));

function openProject(slug, updateUrl = true) {
  const project = PROJECTS.find(item => item.slug === slug); if (!project) return;
  $('#project-detail').innerHTML = `<div class="project-detail-layout"><div class="project-detail-media"><p class="eyebrow">FROM THE PUBLISHED DESIGN CATALOG</p><div class="project-detail-photo"><img class="project-image" data-project-image="${project.slug}" src="${project.image}" alt="${esc(project.alt)}"><span class="media-note" data-media-label="${project.slug}">${esc(project.media)}</span></div><p>${esc(project.name)}. A published design example, not a customer testimonial. Materials, price, and fit for a new project require review.</p></div><div class="project-detail-copy"><p class="eyebrow">${esc(project.label)}</p><h2 id="project-detail-title" tabindex="-1">${esc(project.title)}</h2><h3>The starting point</h3><p>${esc(project.problem)}</p><h3>The idea behind it</h3><p>${esc(project.solution)}</p><h3>Something like this, for you?</h3><p>${esc(project.takeaway)}</p><div class="project-detail-tags">${project.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div><button class="button button-accent" type="button" data-ask="${project.intent}" data-example="${project.slug}" data-entry="project-detail">Make something like this ${ico('diagonal')}</button><div class="project-detail-actions"><a class="text-link" href="${esc(project.source)}" target="_blank" rel="noopener noreferrer">${esc(project.sourceLabel)} ↗</a><button class="text-link" type="button" id="share-project">Share this idea ${ico('link')}</button></div><div class="share-panel" id="share-panel" hidden><label for="share-url">Link to this project</label><input id="share-url" readonly><p>Share this published project. No inquiry details are included.</p></div></div></div>`;
  showDialog($('#project-dialog'), $('#project-detail-title'));
  if (updateUrl) { try { history.replaceState(null, '', projectShareUrl(location.href, project.slug)); } catch { /* local-file navigation is browser-dependent */ } }
  $('#share-project').addEventListener('click', async () => {
    const url = projectShareUrl(location.href, project.slug);
    $('#share-panel').hidden = false; $('#share-url').value = url;
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(url); $('#share-project').textContent = 'Project link copied'; }
    catch { $('#share-url').focus(); $('#share-url').select(); $('#share-project').textContent = 'Select and copy the project link'; }
  });
}

function showContext() {
  const project = PROJECTS.find(item => item.slug === state.context.exampleSlug);
  $('#inquiry-context').hidden = !project;
  if (project) $('#inquiry-context span').textContent = `Inspired by: ${project.name}`;
}
function clearErrors() {
  $$('[aria-invalid]', form).forEach(node => node.removeAttribute('aria-invalid'));
  $$('.field-error', $('#ask-dialog')).forEach(node => { node.hidden = true; node.textContent = ''; });
}
function rawInquiry() { return Object.fromEntries(new FormData(form).entries()); }
function inquiryFiles() { return state.files.map(item => item.file); }
function renderFileList() {
  $('#attachment-list').replaceChildren(...state.files.map((item, index) => {
    const row = document.createElement('div'); row.className = 'attachment';
    if (item.preview) { const preview = document.createElement('img'); preview.src = item.preview; preview.alt = ''; row.append(preview); }
    else { const wrapper = document.createElement('span'); wrapper.style.flex = '0 0 22px'; wrapper.innerHTML = ico('file'); row.append(wrapper); }
    const name = document.createElement('span'); name.textContent = item.file.name; name.title = item.file.name;
    const size = document.createElement('small'); size.textContent = byteSize(item.file.size);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${item.file.name}`);
    remove.addEventListener('click', () => { if (item.preview) URL.revokeObjectURL(item.preview); state.files.splice(index, 1); state.submission = null; renderFileList(); $('#error-files').hidden = true; });
    row.append(name, size, remove); return row;
  }));
}
function releaseFiles() { state.files.forEach(item => { if (item.preview) URL.revokeObjectURL(item.preview); }); state.files = []; renderFileList(); }
function resetInquiry() {
  form.reset(); releaseFiles(); clearErrors(); state.id = null; state.record = null; state.submission = null; state.context = { entryPoint: 'unknown', exampleSlug: null }; state.saving = false;
  $('#save-inquiry').disabled = false; $('#save-inquiry').innerHTML = `Send inquiry ${ico('arrow')}`;
  $('#reference-field').hidden = true; $('#toggle-reference').setAttribute('aria-expanded', 'false');
  $('#download-unsaved').hidden = true; $('#success-pane').hidden = true; $('#inquiry-editor').hidden = false;
  $('#ask-dialog').setAttribute('aria-labelledby', 'ask-title'); showContext();
}
function openInquiry(intent = 'unknown', entryPoint = 'unknown', exampleSlug = null) {
  if (!$('#success-pane').hidden) resetInquiry();
  $('#ask-intent').value = Object.hasOwn(INTENT_LABELS, intent) ? intent : 'unknown';
  state.context = { entryPoint, exampleSlug: PROJECTS.some(project => project.slug === exampleSlug) ? exampleSlug : null }; showContext();
  $('#draft-banner').hidden = !readStorage(STORAGE.draft);
  if ($('#menu-toggle')?.getAttribute('aria-expanded') === 'true') $('#menu-toggle').click();
  showDialog($('#ask-dialog'), $('#ask-title'));
}
$('#remove-context').addEventListener('click', () => { state.context.exampleSlug = null; showContext(); });
function addFiles(collection) {
  if (state.saving) return;
  const errors = [];
  for (const file of [...collection]) {
    const error = validateAttachment(file);
    if (error) { errors.push(error); continue; }
    if (state.files.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
    if (state.files.length >= INQUIRY_LIMITS.files) { errors.push('Only six files can be attached. Remove one before adding another.'); continue; }
    const total = state.files.reduce((sum, item) => sum + item.file.size, 0) + file.size;
    if (total > INQUIRY_LIMITS.totalBytes) { errors.push(`${file.name}: combined size would exceed 25 MB.`); continue; }
    const preview = /^image\/(jpeg|png|webp)$/.test(file.type) ? URL.createObjectURL(file) : null;
    state.files.push({ file, preview }); state.submission = null;
  }
  renderFileList(); $('#error-files').textContent = errors.join(' '); $('#error-files').hidden = !errors.length;
}
$('#choose-files').addEventListener('click', () => $('#ask-files').click());
$('#ask-files').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
['dragenter', 'dragover'].forEach(type => $('#upload-zone').addEventListener(type, event => { event.preventDefault(); $('#upload-zone').classList.add('drag-over'); }));
['dragleave', 'drop'].forEach(type => $('#upload-zone').addEventListener(type, event => { event.preventDefault(); $('#upload-zone').classList.remove('drag-over'); }));
$('#upload-zone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
// Dropping a file outside the upload target must not navigate away and discard the draft.
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { if (event.dataTransfer?.files.length) event.preventDefault(); });
$('#toggle-reference').addEventListener('click', () => { const show = $('#reference-field').hidden; $('#reference-field').hidden = !show; $('#toggle-reference').setAttribute('aria-expanded', String(show)); if (show) $('#ask-reference').focus(); });
function validateForm() {
  clearErrors();
  const result = validateInquiry(rawInquiry(), inquiryFiles());
  const fieldMap = { message: 'ask-message', replyEmail: 'ask-email', referenceUrl: 'ask-reference', name: 'ask-name', files: 'ask-files' };
  Object.entries(result.errors).forEach(([key, message]) => {
    const error = $(`#error-${key}`); if (error) { error.textContent = message; error.hidden = false; }
    const input = $(`#${fieldMap[key]}`); if (input) input.setAttribute('aria-invalid', 'true');
    if (key === 'referenceUrl') { $('#reference-field').hidden = false; $('#toggle-reference').setAttribute('aria-expanded', 'true'); }
  });
  if (!result.valid) $(`#${fieldMap[Object.keys(result.errors)[0]]}`)?.focus();
  return result;
}
// Resolve an already-displayed field error as the visitor corrects that field.
form.addEventListener('input', event => {
  const input = event.target;
  if (input.getAttribute('aria-invalid') !== 'true') return;
  const error = $(`#error-${input.name}`);
  if (!error) return;
  const message = validateInquiry(rawInquiry(), inquiryFiles()).errors[input.name];
  if (message) { error.textContent = message; }
  else { input.removeAttribute('aria-invalid'); error.textContent = ''; error.hidden = true; }
});
function downloadJSON(object, filename) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function recoveryRecord(value, files) {
  return { ...value, context: state.context, attachments: files.map(file => ({ name: file.name, size: file.size, type: file.type })), status: 'not-received', note: 'Attachment contents are not included in this copy.' };
}
function showReceipt(record, live) {
  state.record = record;
  $('#inquiry-editor').hidden = true; $('#success-pane').hidden = false;
  $('#ask-dialog').setAttribute('aria-labelledby', 'success-title');
  $('#success-title').textContent = live ? 'Inquiry received' : 'Your inquiry is ready to send';
  $('#success-note').textContent = live
    ? 'Your inquiry is saved with the shop. I’ll review it before we agree on any work or payment. This confirms receipt, not email delivery.'
    : 'The shop has not received your inquiry. Email it using the button below, or download a copy. Attach your files separately; they were not delivered with this copy.';
  $('#success-receipt').replaceChildren();
  for (const text of [record.id || 'Local copy', record.message || record.referenceUrl || 'Context supplied by attachment.', `Reply email: ${record.replyEmail}`, live ? `${record.attachments.length} private attachment(s) received.` : 'Attachment names only; no file contents in the download.']) {
    const line = document.createElement('p'); line.textContent = text; $('#success-receipt').append(line);
  }
  const body = [record.id || 'Quick inquiry', record.message, record.referenceUrl, `Reply to: ${record.replyEmail}`, `Intent: ${record.intent}`, record.context.exampleSlug ? `Inspired by: ${record.context.exampleSlug}` : '', 'Files: ' + record.attachments.map(file => file.name).join(', '), 'Please attach file contents separately.'].filter(Boolean).join('\n\n');
  $('#email-inquiry').href = `mailto:hello@3dprint4.me?subject=${encodeURIComponent('Project inquiry')}&body=${encodeURIComponent(body)}`;
  $('#email-inquiry').textContent = live ? 'Email about this inquiry' : 'Email the inquiry';
  try { localStorage.setItem(STORAGE.recovery, JSON.stringify(record)); } catch { /* Immediate email and download remain available. */ }
  $('#ask-dialog').scrollTop = 0; $('#success-title').focus({ preventScroll: true });
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (state.saving || !$('#success-pane').hidden) return;
  const result = validateForm(); if (!result.valid) return;
  const files = inquiryFiles();
  const record = recoveryRecord(result.value, files);
  const fingerprint = JSON.stringify(record);
  if (state.submission?.fingerprint !== fingerprint) state.submission = { fingerprint, key: makeId() };
  state.saving = true; form.inert = true; form.setAttribute('aria-busy', 'true'); $('#save-inquiry').disabled = true; $('#save-inquiry').textContent = 'Sending…';
  try {
    const delivery = await submitInquiry({ inquiry: { ...result.value, context: state.context }, files, submissionKey: state.submission.key, receiptUncertain: state.submission.receiptUncertain, website: form.elements.website.value });
    record.id = delivery.id; record.status = delivery.live ? 'received' : 'not-received';
    if (delivery.live) removeStorage(STORAGE.draft);
    showReceipt(record, delivery.live);
  } catch (error) {
    state.submission.receiptUncertain ||= error.receiptUncertain;
    if (state.submission.receiptUncertain) { record.status = 'receipt-unconfirmed'; record.note += ' The shop may have received this inquiry. Retry unchanged details in the original tab to confirm.'; }
    if (error.recoverable) showReceipt(record, false);
    else { state.record = record; $('#save-error').textContent = error.message; $('#save-error').hidden = false; $('#download-unsaved').hidden = false; }
  } finally { state.saving = false; form.inert = false; form.removeAttribute('aria-busy'); $('#save-inquiry').disabled = false; $('#save-inquiry').innerHTML = `Send inquiry ${ico('arrow')}`; }
});
$('#download-inquiry').addEventListener('click', () => { if (state.record) downloadJSON(state.record, 'project-inquiry.json'); });
$('#download-unsaved').addEventListener('click', () => { if (validateForm().valid) { const record = recoveryRecord(normalizeInquiry(rawInquiry()), inquiryFiles()); if (state.submission?.receiptUncertain) { record.status = 'receipt-unconfirmed'; record.note += ' The shop may have received the previous submission. Retry unchanged details in the original tab to confirm.'; } downloadJSON(record, 'project-inquiry.json'); } });
$('#another-inquiry').addEventListener('click', () => { resetInquiry(); openInquiry('unknown', 'another-idea'); });
$('#save-draft').addEventListener('click', () => {
  const draft = { value: normalizeInquiry(rawInquiry()), context: state.context, savedAt: new Date().toISOString(), hadFiles: state.files.length > 0 };
  try { localStorage.setItem(STORAGE.draft, JSON.stringify(draft)); toast('Draft saved on this device. Reattach files after reloading.'); }
  catch { $('#save-error').textContent = 'This browser could not save a draft. Keep this tab open or download the completed inquiry.'; $('#save-error').hidden = false; }
});
$('#restore-draft').addEventListener('click', () => {
  try {
    const saved = JSON.parse(readStorage(STORAGE.draft));
    if (!saved || typeof saved.value !== 'object' || !saved.value) throw new Error('Invalid draft');
    const clean = normalizeInquiry(saved.value);
    Object.entries(clean).forEach(([key, value]) => { const control = form.elements.namedItem(key); if (control) control.value = value; });
    state.context = { entryPoint: 'restored-draft', exampleSlug: PROJECTS.some(project => project.slug === saved.context?.exampleSlug) ? saved.context.exampleSlug : null };
    showContext(); if (clean.referenceUrl) { $('#reference-field').hidden = false; $('#toggle-reference').setAttribute('aria-expanded', 'true'); }
    $('#draft-banner').hidden = true; toast(saved.hadFiles ? 'Draft restored. Please reattach the files; their contents were not stored.' : 'Draft restored. Nothing has been sent.');
  } catch { toast('This draft could not be restored. Your current text was not changed.'); }
});
$('#discard-draft').addEventListener('click', () => { if (removeStorage(STORAGE.draft)) { $('#draft-banner').hidden = true; toast('Saved draft removed.'); } else toast('The browser did not allow the draft to be removed.'); });

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]'); if (close) { close.closest('dialog')?.close(); return; }
  const ask = event.target.closest('[data-ask]'); if (ask) { event.preventDefault(); openInquiry(ask.dataset.ask, ask.dataset.entry || 'unknown', ask.dataset.example || null); return; }
  const project = event.target.closest('[data-project]'); if (project) { event.preventDefault(); openProject(project.dataset.project); return; }
});
if ('IntersectionObserver' in window) new IntersectionObserver(entries => { $('#mobile-ask').classList.toggle('is-away', entries.some(entry => entry.isIntersecting)); }, { threshold: .25 }).observe($('#final-cta'));
const initialSearch = new URLSearchParams(window.__THREEDP_TEST_SEARCH || location.search);
const initialProject = initialSearch.get('project');
if (initialProject && PROJECTS.some(project => project.slug === initialProject)) openProject(initialProject, false);

document.querySelector('#year').textContent = new Date().getFullYear();

if (initialSearch.get('ask') === 'unknown') openInquiry('unknown', 'navigation');
