import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements } from '../../scripts/migrate-neon.mjs';
import { createPartnerAuth, hashPassword, verifyPassword, partnerCookie } from '../../lib/partner-outreach/auth.js';

function adapter(db) {
 const query=target=>async(strings,...values)=>(await target.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
 return {query:query(db),withTransaction:fn=>db.transaction(tx=>fn({query:query(tx)}))};
}
test('password hashing uses salted scrypt and bounded passphrases',async()=>{
 const hash=await hashPassword('A long independent passphrase');
 assert.match(hash,/^scrypt\$131072\$8\$1\$/);
 assert.equal(await verifyPassword('A long independent passphrase',hash),true);
 assert.equal(await verifyPassword('Incorrect independent passphrase',hash),false);
 await assert.rejects(hashPassword('short'),{status:400});
 await assert.rejects(hashPassword('x'.repeat(129)),{status:400});
 assert.equal(await verifyPassword('Password', 'corrupt'),false);
 const cookie=partnerCookie('a'.repeat(43));
 for(const part of ['__Host-3dp-partner=','Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(cookie.includes(part));
 assert.ok(!cookie.includes('Domain='));
});

test('one-use enrollment, independent login, CSRF, recovery, revocation and disabled gates',async()=>{
 const db=new PGlite();
 try{
  for(const s of splitStatements(await readFile(new URL('../../neon/migrations/012_partner_outreach.sql',import.meta.url),'utf8')))await db.query(s);
  const database=adapter(db),programId=randomUUID(),partnerId=randomUUID(),owner={role:'OWNER',id:'verified-owner'};
  await database.query`INSERT INTO partner_programs(id,label,starts_on) VALUES(${programId},'Synthetic','2026-10-01')`;
  await database.query`INSERT INTO partner_accounts(id,program_id,display_name) VALUES(${partnerId},${programId},'Synthetic')`;
  let enabled=false,time=Date.parse('2026-10-23T12:00:00Z');
  const auth=createPartnerAuth({database,now:()=>new Date(time),canEnroll:async()=>enabled});
  await assert.rejects(auth.issueInvite({actor:owner,partnerId}),{status:409});
  enabled=true;
  const expired=await auth.issueInvite({actor:owner,partnerId});
  time+=31*60000;
  await assert.rejects(auth.redeem({token:expired.token,password:'A long independent passphrase',clientKey:'loopback'}),{status:401});
  const invite=await auth.issueInvite({actor:owner,partnerId});
  assert.equal((await database.query`SELECT token_hash FROM partner_invites`)[0].token_hash.includes(invite.token),false);
  const enrollment=await auth.redeem({token:invite.token,password:'A long independent passphrase',clientKey:'loopback'});
  assert.equal(enrollment.partner.id,partnerId);assert.ok(enrollment.token);assert.ok(enrollment.csrfToken);
  await assert.rejects(auth.redeem({token:invite.token,password:'Another independent passphrase',clientKey:'loopback'}),{status:401});
  let session=await auth.session(enrollment.token);
  assert.equal(session.partner.id,partnerId);
  auth.requireCsrf(session,enrollment.csrfToken);
  assert.throws(()=>auth.requireCsrf(session,'invalid'),{status:403});
  const login=await auth.login({accountId:partnerId,password:'A long independent passphrase',clientKey:'loopback'});
  assert.equal((await auth.session(login.token)).partner.id,partnerId);
  enabled=false;
  const recovery=await auth.issueInvite({actor:owner,partnerId,purpose:'recover'});
  const recovered=await auth.redeem({token:recovery.token,password:'A new independent passphrase',clientKey:'loopback'});
  await assert.rejects(auth.session(login.token),{status:401});
  await assert.rejects(auth.session(enrollment.token),{status:401});
  await assert.rejects(auth.login({accountId:partnerId,password:'A long independent passphrase',clientKey:'loopback'}),{status:401});
  assert.equal((await auth.session(recovered.token)).partner.id,partnerId);
  time+=8*86400000;
  await assert.rejects(auth.session(recovered.token),{status:401});
  const renewed=await auth.login({accountId:partnerId,password:'A new independent passphrase',clientKey:'loopback'});
  assert.equal((await auth.session(renewed.token)).partner.id,partnerId);
  await auth.revoke({actor:owner,partnerId,status:'revoked'});
  await assert.rejects(auth.session(recovered.token),{status:401});
  await assert.rejects(auth.session(renewed.token),{status:401});
  assert.equal((await database.query`SELECT status FROM partner_accounts WHERE id=${partnerId}`)[0].status,'revoked');
  const logs=JSON.stringify((await database.query`SELECT minimal_diff FROM partner_audit_events`));
  assert.ok(!logs.includes(invite.token));assert.ok(!logs.includes('passphrase'));
  time+=3600000;
 }finally{await db.close();}
});
