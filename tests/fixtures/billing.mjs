export function billingFixture() {
  return { clientId: 'client123', date: '2026-10-20', dueDate: '2026-11-19',
    receiptAddress: { street: '123 Example St', city: 'Tulsa', region: 'OK', postalCode: '74110', country: 'US' },
    taxEvidence: { jurisdiction: 'Tulsa', verifiedOn: '2026-10-20', reference: 'City schedule' },
    priorPayment: { state: 'none', reference: '' },
    lines: [{ item: 'Sign', description: 'With base', quantityMilli: 1000, unitCents: 14000, taxRateMilli: 8517, taxReason: 'Taxable goods' }] };
}
export const ownerFixture = { id: 'operator123', role: 'owner', enabled: true };
export const workFixture = { item: { id: 'work_example123', revision: 1 } };
export const invoiceFixture = { id: 'invoice123', clientId: 'client123', number: '3DP-2026-operation123', status: 'draft', totalCents: 15192, taxCents: 1192, balanceCents: 15192, paidCents: 0, editorUrl: 'https://app.invoicing.co/#/invoices/invoice123/edit' };
