import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOwnerAuthorizer} from '../../lib/partner-outreach/http.js';
import {digest} from '../../lib/partner-outreach/postgres-repository.js';
import {qaPostgresFixture} from '../support/partner-qa-postgres.mjs';
import {createPartnerQaRuntime,assertQaIsolation} from '../../lib/partner-outreach/qa-runtime.js';
const env={OPERATOR_OWNER_SUBJECT:'2610199'};
test('native QA auth role cannot mutate live data; locks serialize revocation and release after rollback',{timeout:120000},async()=>{
 const f=await qaPostgresFixture();
 f.auth.pool.on('connect',client=>client.on('error',()=>{}));
 try{
 const actor={role:'OWNER',id:'qa-real-owner',ownerSessionHash:digest('Q'.repeat(43))};
 await f.live.admin.query("INSERT INTO operators(id,auth_user_id,display_name,role) VALUES($1,'github:2610199','QA owner','owner')",[actor.id]);
 await f.live.admin.query("INSERT INTO operator_identity_bindings(issuer,subject,operator_id) VALUES('https://github.com/','2610199',$1)",[actor.id]);
 await f.live.admin.query("INSERT INTO operator_sessions(token_hash,operator_id,issuer,subject,expires_at) VALUES($1,$2,'https://github.com/','2610199',now()+interval '1 day')",[actor.ownerSessionHash,actor.id]);
 const verified=await createOwnerAuthorizer({query:f.auth.database.query,env})({headers:{cookie:'__Host-3dp-session='+ 'Q'.repeat(43)}});assert.equal(verified.actor.id,actor.id);
 await assertQaIsolation({qaDatabase:f.business.database,ownerAuthDatabase:f.auth.database,env});
 for(const sql of ["UPDATE operators SET enabled=false","DELETE FROM operator_sessions","SELECT * FROM partner_programs","SELECT * FROM service_requests","CREATE TABLE bad(id int)"])await assert.rejects(f.auth.pool.query(sql),/permission denied/);
 let dropRelease,dropEntered;const dropInside=new Promise(r=>dropEntered=r),dropHold=new Promise(r=>dropRelease=r);
 let release,entered;const inside=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const rt=createPartnerQaRuntime({qaDatabase:f.business.database,ownerAuthDatabase:f.auth.database,env,additionalCommands:{'qa.connection_loss_test':{role:'OWNER',fields:[],run:async tx=>{dropEntered();await dropHold;await tx.query`INSERT INTO partner_programs(id,label,starts_on) VALUES(${randomUUID()},'unauthorized late insert','2026-11-03')`;return {ok:true};}},'qa.lock_test':{role:'OWNER',fields:[],run:async()=>{entered();await hold;return {ok:true};}},'qa.rollback_test':{role:'OWNER',fields:[],run:async(tx)=>{await tx.query`INSERT INTO partner_programs(id,label,starts_on) VALUES(${randomUUID()},'must rollback','2026-11-03')`;throw Error('expected rollback');}}}});
 const mutation=rt.app.execute({actor,action:'qa.lock_test',input:{},key:randomUUID()});await inside;
 let revoked=false;const revocation=f.live.admin.query('DELETE FROM operator_sessions WHERE token_hash=$1',[actor.ownerSessionHash]).then(()=>{revoked=true;});
 await new Promise(r=>setTimeout(r,80));assert.equal(revoked,false);release();assert.deepEqual(await mutation,{ok:true});await revocation;
 await assert.rejects(rt.app.read(actor,'programs'),{status:403});
 await f.live.admin.query("INSERT INTO operator_sessions(token_hash,operator_id,issuer,subject,expires_at) VALUES($1,$2,'https://github.com/','2610199',now()+interval '1 day')",[actor.ownerSessionHash,actor.id]);
 await assert.rejects(rt.app.execute({actor,action:'qa.rollback_test',input:{},key:randomUUID()}));
 assert.equal((await f.qa.admin.query('SELECT count(*)::int n FROM partner_programs')).rows[0].n,0);
 await f.live.admin.query('UPDATE operators SET enabled=false WHERE id=$1',[actor.id]);await assert.rejects(rt.app.read(actor,'programs'),{status:403});
 await f.live.admin.query('UPDATE operators SET enabled=true WHERE id=$1',[actor.id]);
 const dropped=rt.app.execute({actor,action:'qa.connection_loss_test',input:{},key:randomUUID()});const rejected=assert.rejects(dropped);await dropInside;
 await f.live.admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='partner_qa_auth' AND state='idle in transaction'");
 await f.live.admin.query('DELETE FROM operator_sessions WHERE token_hash=$1',[actor.ownerSessionHash]);dropRelease();await rejected;
 assert.equal((await f.qa.admin.query('SELECT count(*)::int n FROM partner_programs')).rows[0].n,0,'auth loss before write must roll back the pending QA business transaction');
 assert.equal((await f.live.admin.query('SELECT count(*)::int n FROM partner_programs')).rows[0].n,0);
 }finally{await f.close();}
});
