import test from 'node:test';
import assert from 'node:assert/strict';
import {nextStatementWeek,statementWeek,statementCsv,generateWeeklyStatements} from '../../lib/partner-outreach/statements.js';

test('weekly schedules begin next Central Monday across UTC and DST boundaries',()=>{
 assert.equal(nextStatementWeek('2026-10-26T04:59:59Z'),'2026-10-26');
 assert.equal(nextStatementWeek('2026-10-26T05:00:00Z'),'2026-11-02');
 assert.equal(nextStatementWeek('2026-11-02T05:59:59Z'),'2026-11-02');
 assert.equal(nextStatementWeek('2026-11-02T06:00:00Z'),'2026-11-09');
 assert.equal(nextStatementWeek('2026-03-09T04:59:59Z'),'2026-03-09');
 assert.equal(nextStatementWeek('2026-03-09T05:00:00Z'),'2026-03-16');
});
test('a delayed scheduler emits only the current eligible week, never invented prior balances',()=>{
 const schedule={enabled:true,firstDueWeek:'2026-10-26'};
 assert.equal(statementWeek(schedule,'2026-10-25T18:00Z'),null);
 assert.equal(statementWeek(schedule,'2026-11-11T18:00Z'),'2026-11-09');
 assert.equal(statementWeek({...schedule,enabled:false},'2026-11-11T18:00Z'),null);
 assert.equal(statementWeek(undefined,'2026-11-11T18:00Z'),null);
 assert.throws(()=>statementWeek({...schedule,firstDueWeek:'2026-10-27'},'2026-11-11T18:00Z'));
});
test('statement bytes contain only obligation balances, not incidental secrets or gifts',()=>{
 const csv=statementCsv([{id:'record',gigId:'gig',amountDueCents:5000,paidCents:2000,outstandingCents:3000,status:'part_paid',payment_reference:'PRIVATE',contact:'PRIVATE',giftCents:999}]);
 assert.equal(csv,'"record_id","work_order_id","amount_due_cents","paid_cents","outstanding_cents","currency","status"\r\n"record","gig",5000,2000,3000,"USD","part_paid"\r\n');
 assert.ok(!csv.includes('PRIVATE'));assert.ok(!csv.includes('999'));
});

test('before the additive migration the job checks schema only and performs no transaction',async()=>{
 let queries=0;const database={query:async(strings)=>{queries++;assert.match(strings.join(''),/to_regclass/);return [{ready:false}];},withTransaction:()=>{throw Error('Must not write');}};
 assert.deepEqual(await generateWeeklyStatements({database,now:()=>new Date('2026-10-26T12:00Z')}),{claimed:0,generated:0,skipped:0});assert.equal(queries,1);
});
