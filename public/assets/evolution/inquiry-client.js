/** Transport only: a persisted draft or a successful upload is not a submitted inquiry. */
export async function submitInquiry(input, fetcher = globalThis.fetch.bind(globalThis)) {
  let receiptUncertain = Boolean(input.receiptUncertain);
  const failure = (message, recoverable = false) => Object.assign(new Error(message), { recoverable: recoverable && !receiptUncertain, receiptUncertain });
  const api = async (method, body, initial = false) => {
    let response;
    try {
      response = await fetcher('/api/inquiry', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw failure(initial && !receiptUncertain ? 'Online delivery is unavailable.' : 'We could not confirm receipt. Keep this tab open and retry unchanged details; your inquiry will not be duplicated.', initial);
    }
    if (!response.ok) {
      if (initial && !receiptUncertain && (response.status >= 500 || response.status === 404)) throw failure('Online delivery is unavailable.', true);
      throw failure(response.status === 429 ? 'Please wait a few minutes before trying again. You can download your inquiry now.' : 'We could not accept or confirm the inquiry. Check the details and retry, or download your copy.');
    }
    try { return await response.json(); }
    catch { throw failure('We could not confirm receipt. Please retry with this tab open.'); }
  };
  const created = await api('POST', { ...input, files: input.files.map(file => ({ name: file.name, size: file.size, type: file.type })) }, true);
  if (receiptUncertain && created.live !== true && created.mode !== 'neon') throw failure('We could not confirm receipt. Keep this tab open and retry unchanged details.');
  if (created.live === true || created.mode === 'local' || created.mode === 'ignored') return created;
  if (!created.id || created.mode !== 'neon' || !Array.isArray(created.uploads)) throw failure('We could not prepare the inquiry. Please retry.');
  for (const upload of created.uploads) {
    const file = input.files[upload.index];
    let url;
    try { url = new URL(upload.uploadUrl); } catch { throw failure('We could not prepare a private upload. Please retry.'); }
    if (!file || url.protocol !== 'https:' || url.hostname !== 'vercel.com' || url.pathname !== '/api/blob/' || url.username || url.password || upload.method !== 'PUT') throw failure('We could not prepare a private upload. Please retry.');
    try {
      const response = await fetcher(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': upload.contentType }, body: file, signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error('Upload rejected');
    } catch { throw failure(`The upload of ${file.name} could not be confirmed. Your text is still here. Retry to finish, or download your inquiry.`); }
  }
  receiptUncertain = true;
  const completed = await api('PATCH', { id: created.id, submissionKey: input.submissionKey });
  if (completed.live !== true) throw failure('We could not confirm receipt. Please retry with this tab open.');
  return completed;
}
