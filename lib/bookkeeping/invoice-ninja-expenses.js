// Separate expense adapter: the invoice adapter stays draft-only. Create + find-by-number only.
const HOST = 'https://invoicing.co/api/v1/';
const ID = /^[A-Za-z0-9]{4,64}$/;
export class ExpenseProviderError extends Error {
  constructor() { super('Invoice Ninja expense operation failed.'); this.name = 'ExpenseProviderError'; }
}

export function createInvoiceNinjaExpenses({ token = process.env.INVOICE_NINJA_TOKEN, categoryId = process.env.INVOICE_NINJA_SUPPLIES_CATEGORY_ID, fetchImpl = fetch, today = () => new Date().toISOString().slice(0, 10), timeoutMs = 10000 } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    if (!token?.trim()) throw new ExpenseProviderError();
    try {
      const res = await fetchImpl(`${HOST}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'X-API-TOKEN': token, 'X-Requested-With': 'XMLHttpRequest', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!res.ok) throw new ExpenseProviderError();
      return await res.json();
    } catch { throw new ExpenseProviderError(); }
  }
  return {
    async findByNumber(number) {
      const { data } = await request(`expenses?${new URLSearchParams({ number, per_page: '20', status: 'active,archived,deleted' })}`);
      const hit = Array.isArray(data) ? data.find(e => e.number === number) : null;
      return hit && ID.test(hit.id) ? { id: hit.id } : null;
    },
    async createExpense(plan) {
      const { data } = await request('expenses', {
        method: 'POST',
        body: { number: plan.number, amount: plan.amountCents / 100, date: today(), public_notes: '', private_notes: plan.note, transaction_reference: plan.key, ...(ID.test(categoryId ?? '') ? { category_id: categoryId } : {}) }
      });
      if (!data || !ID.test(data.id) || data.number !== plan.number) throw new ExpenseProviderError();
      return { id: data.id };
    }
  };
}
