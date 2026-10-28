import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../../lib/partner-outreach/accounting.js';
import { payableView } from '../../lib/partner-outreach/ledger.js';
test('CSV quotes fields, preserves typed signed cents and protects formula prefixes including Unicode compatibility forms',()=>{
 assert.equal(csvCell(-5000),'-5000');assert.equal(csvCell('a,"b"'),'"a,""b"""');
 for(const value of ['=SUM(1,2)','+cmd','-cmd','@SUM(A1)','  =cmd','\t=cmd','＝SUM(1,2)'])assert.ok(csvCell(value).startsWith('"\''),value);
 assert.throws(()=>csvCell(Infinity));
});
test('ledger rejects unsafe or contradictory persisted balances rather than guessing an amount',()=>{
 const row={id:'p',partner_id:'a',amount_cents:5000,adjustment_cents:'-1000',paid_cents:'2000'};
 assert.equal(payableView(row).outstandingCents,2000);
 assert.throws(()=>payableView({...row,adjustment_cents:'-6000'}));
 assert.throws(()=>payableView({...row,paid_cents:'9007199254740993'}));
});
