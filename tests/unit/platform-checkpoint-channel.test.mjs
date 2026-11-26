import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createCheckpointChannel} from '../../lib/platform/checkpoint-channel.js';
test('checkpoint cannot authorize a side effect until the host acknowledges durable storage',async()=>{
 const input=new PassThrough(),output=new PassThrough();const channel=createCheckpointChannel({input,output,ackTimeoutMs:1000});
 try{
  input.write('{"state":null}\n');assert.deepEqual(await channel.readInitial(),{state:null});
  let sent=false;const pending=(async()=>{await channel.checkpoint({mail:{status:'pending'}});sent=true;})();
  await new Promise(r=>setImmediate(r));assert.equal(sent,false);
  assert.equal(JSON.parse(output.read().toString()).mail.status,'pending');
  input.write('checkpoint-ok\n');await pending;assert.equal(sent,true);
 }finally{channel.close();}
});
test('missing or invalid acknowledgment fails closed before the next operation',async()=>{
 for(const ack of [null,'not-durable']) {
  const input=new PassThrough(),output=new PassThrough();const channel=createCheckpointChannel({input,output,ackTimeoutMs:15});
  try{
   input.write('{}\n');await channel.readInitial();let sideEffects=0;
   const pending=(async()=>{await channel.checkpoint({stage:'upload'});sideEffects++;})();
   if(ack)input.write(ack+'\n');
   await assert.rejects(pending);assert.equal(sideEffects,0);
  }finally{channel.close();}
 }
});
