import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformJobs } from '../../lib/platform/jobs.js';

test('local jobs are disabled until the explicit writer handover and never overlap',async()=>{
  let calls=0;const disabled=createPlatformJobs({env:{},drain:async()=>calls++,cleanup:async()=>calls++,expire:async()=>calls++});
  await disabled.tick();assert.equal(calls,0);
  let release;const waiting=new Promise(r=>{release=r;});
  const active=createPlatformJobs({env:{PLATFORM_JOBS_ENABLED:'1'},drain:async()=>{calls++;await waiting;},cleanup:async()=>calls++,expire:async()=>calls++});
  const first=active.tick();await active.tick();release();await first;assert.equal(calls,3);
});
test('push, auth expiry and model retention use independent bounded schedules',async()=>{
  let time=0;const calls=[];
  const jobs=createPlatformJobs({env:{PLATFORM_JOBS_ENABLED:'1'},now:()=>time,drain:async()=>calls.push('push'),expire:async()=>calls.push('expiry'),cleanup:async()=>calls.push('cleanup')});
  await jobs.tick();assert.deepEqual(calls,['push','expiry','cleanup']);calls.length=0;
  time=15000;await jobs.tick();assert.deepEqual(calls,['push']);calls.length=0;
  time=60000;await jobs.tick();assert.deepEqual(calls,['push','expiry']);calls.length=0;
  time=6*3600000;await jobs.tick();assert.deepEqual(calls,['push','expiry','cleanup']);
});

test('a stalled push provider cannot delay auth and replay expiry',async()=>{
  let time=0,expiries=0,release;
  const blocked=new Promise(r=>{release=r;});
  const jobs=createPlatformJobs({env:{PLATFORM_JOBS_ENABLED:'1'},now:()=>time,drain:()=>blocked,expire:async()=>{expiries++;},cleanup:async()=>{}});
  const first=jobs.tick();await Promise.resolve();time=60000;
  await jobs.tick();assert.equal(expiries,2);release();await first;
});

test('Spoolman polling is independent and does not overlap',async()=>{
  let time=0,calls=0,release;const blocked=new Promise(r=>release=r);
  const jobs=createPlatformJobs({env:{PLATFORM_JOBS_ENABLED:'1'},now:()=>time,drain:async()=>{},expire:async()=>{},cleanup:async()=>{},spoolman:async()=>{calls++;await blocked;}});
  const first=jobs.tick();await Promise.resolve();time=5000;await jobs.tick();assert.equal(calls,1);release();await first;
  time=10000;await jobs.tick();assert.equal(calls,2);
});

test('weekly statement batches poll independently each minute, never overlap and retry after failure',async()=>{
 let time=0,expiry=0,calls=0,release;const errors=[];
 const blocked=new Promise(r=>release=r);
 const jobs=createPlatformJobs({env:{PLATFORM_JOBS_ENABLED:'1'},now:()=>time,drain:async()=>{},cleanup:async()=>{},expire:async()=>expiry++,statements:async()=>{calls++;if(calls===1)await blocked;if(calls===2)throw Error('PRIVATE');},onError:name=>errors.push(name)});
 const first=jobs.tick();await Promise.resolve();assert.equal(calls,1);
 time=60000;await jobs.tick();assert.equal(calls,1);assert.equal(expiry,2);release();await first;
 time=120000;await jobs.tick();assert.equal(calls,2);assert.deepEqual(errors,['statements']);
 time=180000;await jobs.tick();assert.equal(calls,3);
});
