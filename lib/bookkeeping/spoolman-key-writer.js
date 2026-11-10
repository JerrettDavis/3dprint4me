// The only Spoolman write the integration performs: store the Invoice Ninja expense ID in one
// spool extra field. Spoolman encodes extra values as JSON strings. Best-effort; never deletes or
// changes weights, prices or archive state.
export const EXPENSE_FIELD_KEY = 'invoice_ninja_expense';
const fail = () => Object.assign(new Error('Spoolman key write failed.'), { code: 'spoolman_write_failed' });

export function createSpoolmanKeyWriter({ baseUrl, hostHeader, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!baseUrl) return { configured: false, async ensureField() {}, async setExpenseId() {} };
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/') throw new Error('Invalid Spoolman server configuration.');
  async function call(path, method, body) {
    const res = await fetchImpl(new URL(path, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(hostHeader ? { Host: hostHeader } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!res.ok) { await res.body?.cancel?.(); throw fail(); }
    return res.json();
  }
  let ensured = false;
  return {
    configured: true,
    async ensureField() {
      if (ensured) return;
      const fields = await call('/api/v1/field/spool', 'GET');
      if (!Array.isArray(fields)) throw fail();
      if (!fields.some(f => f.key === EXPENSE_FIELD_KEY)) await call(`/api/v1/field/spool/${EXPENSE_FIELD_KEY}`, 'POST', { name: 'Invoice Ninja expense', field_type: 'text' });
      ensured = true;
    },
    async setExpenseId(spoolId, expenseId) {
      if (!Number.isSafeInteger(spoolId) || spoolId < 1 || !/^[A-Za-z0-9]{4,64}$/.test(expenseId)) throw fail();
      await this.ensureField();
      await call(`/api/v1/spool/${spoolId}`, 'PATCH', { extra: { [EXPENSE_FIELD_KEY]: JSON.stringify(expenseId) } });
    }
  };
}
