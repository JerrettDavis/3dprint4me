import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBilling, calculateBilling } from '../../lib/invoicing/domain.js';

function fixture() {
  return {
    clientId: 'client123', date: '2026-10-20', dueDate: '2026-11-19',
    receiptAddress: { street: '123 Example St', city: 'Tulsa', region: 'OK', postalCode: '74110', country: 'US' },
    taxEvidence: { jurisdiction: 'Tulsa, Tulsa County, Oklahoma', verifiedOn: '2026-10-20', reference: 'City tax schedule' },
    priorPayment: { state: 'none', reference: '' },
    lines: [
      { item: 'Two signs and bases', description: 'Complete bundle', quantityMilli: 1000, unitCents: 8000, taxRateMilli: 8517, taxReason: 'Taxable tangible goods' },
      { item: 'One sign and base', description: 'Complete bundle', quantityMilli: 1000, unitCents: 6000, taxRateMilli: 8517, taxReason: 'Taxable tangible goods' }
    ]
  };
}

test('confirmed goods preserve three-decimal tax precision and integer totals', () => {
  const billing = normalizeBilling(fixture());
  assert.deepEqual(calculateBilling(billing), { subtotalCents: 14000, taxCents: 1192, totalCents: 15192 });
  assert.equal(billing.lines[0].taxRateMilli, 8517);
  assert.ok(Object.isFrozen(billing) && Object.isFrozen(billing.lines[0]));
});

test('fractional quantities round net cents before tax; different tax rates remain separate', () => {
  const input = fixture();
  input.lines[0] = { ...input.lines[0], quantityMilli: 1250, unitCents: 1999 };
  input.lines[1] = { ...input.lines[1], unitCents: 1000, taxRateMilli: 0, taxReason: 'Separately stated delivery' };
  assert.deepEqual(calculateBilling(normalizeBilling(input)), { subtotalCents: 3499, taxCents: 213, totalCents: 3712 });
});

test('reject unknown fields instead of forwarding sensitive intake or send instructions', () => {
  for (const key of ['password', 'customization', 'send', 'send_email', 'status_id']) {
    assert.throws(() => normalizeBilling({ ...fixture(), [key]: 'secret' }), /Unexpected billing field/);
  }
  const input = fixture(); input.lines[0].privateNotes = 'secret';
  assert.throws(() => normalizeBilling(input), /Unexpected line field/);
});

test('real dates, bounded integers, receipt location, evidence and prior-payment review are required', () => {
  const invalid = [
    b => { b.date = '2026-02-30'; }, b => { b.dueDate = '2026-01-01'; },
    b => { b.taxEvidence.verifiedOn = '2026-11-01'; },
    b => { b.receiptAddress.street = ''; }, b => { b.receiptAddress.country = 'CA'; },
    b => { b.taxEvidence.reference = ''; }, b => { b.priorPayment.state = 'unresolved'; },
    b => { b.priorPayment = { state: 'reconciled', reference: '' }; },
    b => { b.lines = []; }, b => { b.lines[0].taxRateMilli = 8.517; },
    b => { b.lines[0].quantityMilli = 0; }, b => { b.lines[0].unitCents = -1; },
    b => { b.lines[0].unitCents = Number.MAX_SAFE_INTEGER; },
    b => { b.lines[0].taxReason = ''; }, b => { b.lines[0].item = '<script>bad</script>'; }
  ];
  for (const mutate of invalid) { const b = fixture(); mutate(b); assert.throws(() => normalizeBilling(b)); }
});

test('a previously reconciled payment requires its accounting reference', () => {
  const input = fixture(); input.priorPayment = { state: 'reconciled', reference: 'Invoice Ninja payment 0031, already applied' };
  assert.equal(normalizeBilling(input).priorPayment.state, 'reconciled');
});
