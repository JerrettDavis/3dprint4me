import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeDatabase, nativePoolOptions } from '../../lib/database.js';
import { HttpError } from '../../lib/http.js';

test('native SQL binds untrusted values separately and normalizes undefined to null', async () => {
  let received;
  const db = createNativeDatabase({ pool: { query: async (text, values) => { received = { text, values }; return { rows: [{ id: 7 }] }; } } });
  assert.deepEqual(await db.query`SELECT * FROM things WHERE name = ${"'; DROP TABLE things; --"} AND optional = ${undefined}`, [{ id: 7 }]);
  assert.deepEqual(received, { text: 'SELECT * FROM things WHERE name = $1 AND optional = $2', values: ["'; DROP TABLE things; --", null] });
  await assert.rejects(db.query('SELECT secret'), /tagged template/);
});

test('native migration transactions commit all statements and always release a client', async () => {
  const calls = [];
  const db = createNativeDatabase({ pool: { connect: async () => ({ query: async (text, values) => { calls.push([text, values]); return { rows: [{ ok: true }] }; }, release: () => calls.push(['release']) }) } });
  assert.deepEqual(await db.transaction([{ text: 'SELECT $1', values: [5] }, { text: 'SELECT 2' }]), [[{ ok: true }], [{ ok: true }]]);
  assert.deepEqual(calls.map(c => c[0]), ['BEGIN', 'SELECT $1', 'SELECT 2', 'COMMIT', 'release']);
});

test('failed native transactions roll back and suppress private database errors', async () => {
  const calls = [];
  const db = createNativeDatabase({ pool: { connect: async () => ({ query: async text => { calls.push(text); if (text === 'broken') throw new Error('postgres://private-password internal query'); return { rows: [] }; }, release: () => calls.push('release') }) } });
  await assert.rejects(db.transaction([{ text: 'broken' }]), error => { assert.equal(error.status, 502); assert.doesNotMatch(error.message, /password|internal|postgres:/); return true; });
  assert.deepEqual(calls, ['BEGIN', 'broken', 'ROLLBACK', 'release']);
});

test('native pool is bounded and keeps dates and timestamptz compatible with repository contracts', () => {
  const options = nativePoolOptions('postgres://example');
  assert.equal(options.max, 8); assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.statement_timeout, 10000); assert.equal(options.query_timeout, 12000);
  assert.equal(options.types.getTypeParser(1082)('2026-10-20'), '2026-10-20');
  assert.equal(options.types.getTypeParser(1184)('2026-10-20 10:00:00+00'), '2026-10-20T10:00:00.000Z');
});

test('native callback transaction locks and updates through one parameterized client',async()=>{
  const calls=[];
  const db=createNativeDatabase({pool:{connect:async()=>({query:async(text,values)=>{
    calls.push([text,values]);return {rows:[{id:7}]};},release:()=>calls.push(['release'])})}});
  const result=await db.withTransaction(async tx=>{
    const [row]=await tx.query`SELECT id FROM inquiries WHERE id=${7} FOR UPDATE`;
    await tx.query`UPDATE inquiries SET linked=${row.id}`;return row.id;
  });
  assert.equal(result,7);
  assert.deepEqual(calls.map(x=>x[0]),['BEGIN','SELECT id FROM inquiries WHERE id=$1 FOR UPDATE','UPDATE inquiries SET linked=$1','COMMIT','release']);
  assert.deepEqual(calls[1][1],[7]);
});

test('callback rollback preserves safe domain conflicts and suppresses raw SQL failures',async()=>{
  for(const error of [new HttpError(409,'The invitation expired.'),new Error('private database password')]) {
    const calls=[];
    const db=createNativeDatabase({pool:{connect:async()=>({query:async text=>{calls.push(text);return {rows:[]};},release:()=>calls.push('release')})}});
    await assert.rejects(db.withTransaction(async()=>{throw error;}),actual=>{
      assert.equal(actual.status,error instanceof HttpError?409:502);assert.doesNotMatch(actual.message,/private|password/);return true;
    });
    assert.deepEqual(calls,['BEGIN','ROLLBACK','release']);
  }
});
