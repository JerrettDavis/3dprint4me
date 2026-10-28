import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
test('seven anonymized sources seed as private unapproved drafts and never overwrite owner revisions',async()=>{
 const f=await partnerFixture({reviewed:false});
 try{
  const app=createPartnerApplication({database:f.database,env:ACTIVE_ENV,allowSyntheticOwner:true,now:()=>new Date(TEST_NOW)});
  const run=(actor,action,input)=>app.execute({actor,action,input,key:randomUUID()});
  await assert.rejects(run(f.actor,'legal.seed_templates',{programId:f.programId}),{status:403});
  assert.equal((await run(f.owner,'legal.seed_templates',{programId:f.programId})).created,7);
  const rows=await f.database.query`SELECT v.*,d.template_key,d.status FROM partner_legal_versions v JOIN partner_legal_documents d ON d.id=v.document_id`;
  assert.equal(rows.length,7);for(const row of rows){assert.equal(row.issuable,false);assert.equal(row.status,'draft');assert.match(row.markdown,/DRAFT|NONBINDING/);}
  assert.ok(rows.find(r=>r.template_key==='cpa-cover-letter').required_scopes.includes('accounting'));
  const covers=rows.filter(r=>r.template_key.endsWith('cover-letter')).map(r=>r.markdown).join(' ');
  for(const phrase of ['owner has periodically assisted','partner sought','distributing profits rather','LLC checking'])assert.ok(!covers.toLowerCase().includes(phrase.toLowerCase()),phrase);
  const master=rows.find(r=>r.template_key==='independent-marketing-services');assert.equal(master.variables_schema.weekly_authorization_default_usd.default,20000);
  assert.equal(master.variables_schema.partner_full_name.default,undefined);
  const modified=await run(f.owner,'legal.save',{programId:f.programId,templateKey:'independent-marketing-services',title:'Owner revision',markdown:'# DRAFT\nOwner changed this privately.',variablesSchema:{},issuable:false,expectedRevision:1,changeReason:'Owner revision'});
  assert.equal((await run(f.owner,'legal.seed_templates',{programId:f.programId})).created,0);
  assert.equal((await app.read(f.owner,'legal-version',{id:modified.versionId})).version.title,'Owner revision');
 }finally{await f.close();}
});
