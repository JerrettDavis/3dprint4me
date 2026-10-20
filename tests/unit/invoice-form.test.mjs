import test from 'node:test';
import assert from 'node:assert/strict';
import { billingFromFields } from '../../operator/assets/invoice-detail.js';
function fields() { return { clientId: 'client123', date: '2026-10-20', dueDate: '2026-11-19', street: '123 Example St', city: 'Tulsa', region: 'OK', postalCode: '74110', jurisdiction: 'Tulsa', verifiedOn: '2026-10-20', evidence: 'City schedule', priorState: 'none', priorReference: '', lines: [{ item: 'Sign', description: 'With base', quantity: '1.25', unitPrice: '80.00', taxRate: '8.517', taxReason: 'Physical goods' }] }; }
test('operator form preserves exact currency, quantity and tax decimals', () => {
  const b = billingFromFields(fields());
  assert.deepEqual([b.lines[0].quantityMilli, b.lines[0].unitCents, b.lines[0].taxRateMilli], [1250, 8000, 8517]);
  assert.equal(b.receiptAddress.country, 'US'); assert.equal(b.taxEvidence.reference, 'City schedule');
  assert.equal('send' in b, false);
});
test('malformed, exponential, negative or excessive precision decimals are rejected', () => {
  for (const [field, value] of [['quantity', '1e3'], ['quantity', '1.0001'], ['unitPrice', '80.001'], ['unitPrice', '-1'], ['taxRate', '8.5170'], ['taxRate', '8.5junk']]) {
    const f = fields(); f.lines[0][field] = value; assert.throws(() => billingFromFields(f));
  }
});
