import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionGig, freezeOffer } from '../../lib/partner-outreach/domain.js';
const gig = status => ({ id: 'gig', partnerId: 'partner-a', status, revision: 2, feeCents: 5000, authorizationWeek: '2026-10-19' });
const command = (action, extra = {}) => ({ action, expectedRevision: 2, ...extra });

test('partner voluntarily declines without a reservation or penalty', () => {
  const original = gig('offered');
  const result = transitionGig(original, command('decline'), { role: 'PARTNER', id: 'partner-a' });
  assert.equal(result.status, 'declined');
  assert.equal(result.revision, 3);
  assert.equal(result.feeCents, 5000);
  assert.equal(original.status, 'offered');
});

test('scope and revision are checked before every state transition', () => {
  assert.throws(() => transitionGig(gig('offered'), command('decline'), { role: 'PARTNER', id: 'partner-b' }), e => e.status === 404);
  assert.throws(() => transitionGig(gig('offered'), command('decline', { expectedRevision: 1 }), { role: 'PARTNER', id: 'partner-a' }), e => e.status === 409);
  assert.throws(() => transitionGig(gig('submitted'), command('approve'), { role: 'PARTNER', id: 'partner-a' }));
  assert.throws(() => transitionGig(gig('offered'), command('accept'), { role: 'OWNER', id: 'owner' }));
});

test('submission and review cannot pretend to settle a bank payment', () => {
  const partner = { role: 'PARTNER', id: 'partner-a' }, owner = { role: 'OWNER', id: 'owner' };
  assert.equal(transitionGig(gig('accepted'), command('submit'), partner).status, 'submitted');
  assert.equal(transitionGig(gig('submitted'), command('approve'), owner).status, 'approved');
  assert.throws(() => transitionGig(gig('payable'), command('mark_paid'), owner));
  assert.throws(() => transitionGig(gig('approved'), command('withdraw'), owner));
  assert.throws(() => transitionGig(gig('payable'), command('decline'), partner));
});

test('unsafe termination and disputes retain original accepted fee and authorization week', () => {
  const partner = { role: 'PARTNER', id: 'partner-a' };
  assert.throws(() => transitionGig(gig('accepted'), command('report_unsafe'), partner));
  const result = transitionGig(gig('accepted'), command('report_unsafe', { reason: 'Unsafe access' }), partner);
  assert.equal(result.status, 'cancellation_requested');
  assert.equal(result.feeCents, 5000);
  assert.equal(result.authorizationWeek, '2026-10-19');
  const dispute = transitionGig(gig('payable'), command('dispute', { reason: 'Payment missing' }), partner);
  assert.equal(dispute.status, 'disputed');
  assert.equal(dispute.feeCents, 5000);
});

test('offer snapshots reject unknown values and cannot be changed through source references', () => {
  const input = { title: 'Introductions', feeCents: 5000, maximumBonusCents: 1000, bonusRules:[{id:'qualified-lead',trigger:'qualified_lead',amountCents:1000,maximumAwards:1,criteria:'Unique consented qualified project introduction.',qualifiesBy:'2026-12-31'}], tasks: ['Ten permitted business visits'], materials: ['Samples'], area: 'Tulsa', deadline: '2026-12-01' };
  const offer = freezeOffer(input);
  input.tasks[0] = 'Changed';
  assert.equal(offer.tasks[0], 'Ten permitted business visits');
  assert.throws(() => { offer.tasks.push('Hidden condition'); });
  assert.throws(() => freezeOffer({ ...input, personalGiftCents: 20000 }));
  assert.throws(() => freezeOffer({ ...input, feeCents: '5000' }));
  assert.throws(() => freezeOffer({ ...input, tasks: [] }));
});
test('promised bonuses require explicit bounded frozen rules matching the complete reserved maximum',()=>{
 const base={title:'Visits',feeCents:5000,maximumBonusCents:1000,tasks:['Permitted introductions'],materials:[],area:'Tulsa',deadline:'2026-12-01'};
 assert.throws(()=>freezeOffer(base));
 const rule={id:'qualified-introduction',trigger:'qualified_lead',amountCents:500,maximumAwards:2,criteria:'Consented unique project inquiry, independently reviewed; no sale required.',qualifiesBy:'2026-12-31'};
 const offer=freezeOffer({...base,bonusRules:[rule]});rule.amountCents=1;
 assert.equal(offer.bonusRules[0].amountCents,500);assert.ok(Object.isFrozen(offer.bonusRules[0]));
 assert.throws(()=>freezeOffer({...base,bonusRules:[{...rule,amountCents:500,maximumAwards:3}]}));
 assert.throws(()=>freezeOffer({...base,bonusRules:[{...rule,amountCents:500,trigger:'quote_requested'}]}));
 assert.throws(()=>freezeOffer({...base,bonusRules:[{...rule,amountCents:500,trigger:'verified_sale'}]}));
});
