/** Browser validation. The inquiry API independently validates every field. */
export const INQUIRY_LIMITS = Object.freeze({ files: 6, fileBytes: 10 * 1024 * 1024, totalBytes: 25 * 1024 * 1024, message: 4000, name: 100, url: 2000, records: 30 });
export const INQUIRY_INTENTS = Object.freeze(['unknown', 'replace', 'custom', 'print', 'repair', 'business']);
export const FILE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'stl', '3mf', 'step', 'stp', 'obj', 'txt']);
export function normalizeInquiry(raw = {}) {
  const clean = (key) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  return { intent: INQUIRY_INTENTS.includes(raw.intent) ? raw.intent : 'unknown', message: clean('message'), replyEmail: clean('replyEmail'), name: clean('name'), referenceUrl: clean('referenceUrl') };
}
export function validateAttachment(file) {
  if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size < 0) return 'This file could not be read. Please choose it again.';
  const extension = file.name.toLowerCase().split('.').pop();
  if (['heic', 'heif'].includes(extension)) return `${file.name}: please export an iPhone photo as JPG or PNG.`;
  if (!FILE_EXTENSIONS.includes(extension)) return `${file.name}: use JPG, PNG, WebP, PDF, STL, 3MF, STEP, OBJ, or TXT.`;
  if (!file.size) return `${file.name}: this file is empty.`;
  if (file.size > INQUIRY_LIMITS.fileBytes) return `${file.name}: each file must be 10 MB or smaller.`;
  return null;
}
export function validateInquiry(raw, files = []) {
  const value = normalizeInquiry(raw);
  const errors = {};
  if (!value.message && !value.referenceUrl && !files.length) errors.message = 'Add a short description, a link, or a file so there is something to work from.';
  if (value.message.length > INQUIRY_LIMITS.message) errors.message = 'Keep your description to 4,000 characters or fewer.';
  if (!value.replyEmail || value.replyEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.replyEmail)) errors.replyEmail = 'Enter an email address, such as you@example.com.';
  if (value.name.length > INQUIRY_LIMITS.name) errors.name = 'Keep your name to 100 characters or fewer.';
  if (value.referenceUrl) {
    try {
      const url = new URL(value.referenceUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.referenceUrl.length > INQUIRY_LIMITS.url) throw new Error('invalid');
    } catch { errors.referenceUrl = 'Use a complete http:// or https:// link without a username or password.'; }
  }
  if (files.length > INQUIRY_LIMITS.files) errors.files = 'Choose up to six files.';
  else if (files.reduce((sum, file) => sum + (Number(file.size) || 0), 0) > INQUIRY_LIMITS.totalBytes) errors.files = 'Keep the combined file size to 25 MB or less.';
  else { const problem = files.map(validateAttachment).find(Boolean); if (problem) errors.files = problem; }
  return { valid: Object.keys(errors).length === 0, value, errors };
}
/** Only a public catalog slug is allowed in a shared URL, never inquiry context or PII. */
export function projectShareUrl(base, slug) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) throw new TypeError('Invalid public project slug.');
  const url = new URL(base); url.search = ''; url.hash = ''; url.searchParams.set('project', slug); return url.href;
}
