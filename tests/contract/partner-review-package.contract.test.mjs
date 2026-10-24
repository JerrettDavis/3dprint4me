import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,generateKeyPairSync,verify } from 'node:crypto';
import { unzipSync,strFromU8 } from 'fflate';
import { createPartnerApplication } from '../../lib/partner-outreach/application.js';
import { canonicalJson,digest } from '../../lib/partner-outreach/postgres-repository.js';
import { partnerFixture,ACTIVE_ENV,TEST_NOW } from '../support/partner-fixture.mjs';
test('review packages freeze signed sources, bounded reviewer grants and audited owner-only expiring downloads',async()=>{
 const f=await partnerFixture({reviewed:false});
 try{
  const keys=generateKeyPairSync('ed25519'),env={...ACTIVE_ENV,PARTNER_REVIEW_SIGNING_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'})};
  let instant=new Date(TEST_NOW);
  const app=createPartnerApplication({database:f.database,env,allowSyntheticOwner:true,now:()=>instant});
  const run=(action,input)=>app.execute({actor:f.owner,action,input,key:randomUUID()});
  await run('legal.seed_templates',{programId:f.programId});
  const versions=await f.database.query`SELECT id,content_sha256 FROM partner_legal_versions ORDER BY id`;
  const input={programId:f.programId,versionIds:versions.map(v=>v.id),reviewers:[{name:'Synthetic Counsel',role:'attorney',scopes:['classification','agreement_language','solicitation_policy']},{name:'Synthetic Accountant',role:'cpa',scopes:['accounting']}],expiresAt:'2026-10-30T12:00:00.000Z',redactionConfirmed:true,factualBrief:'Synthetic facts only.'};
  await assert.rejects(run('legal.export_package',{...input,redactionConfirmed:false}),{status:400});
  await assert.rejects(run('legal.export_package',{...input,expiresAt:'2027-01-01T00:00:00Z'}),{status:400});
  await assert.rejects(run('legal.export_package',{...input,reviewers:[{name:'Synthetic incompatible',role:'cpa',scopes:['classification']}]}),{status:400});
  const unavailable=createPartnerApplication({database:f.database,env:{...env,PARTNER_REVIEW_SIGNING_PRIVATE_KEY:'invalid'},allowSyntheticOwner:true,now:()=>instant});
  await assert.rejects(unavailable.execute({actor:f.owner,action:'legal.export_package',input,key:randomUUID()}),{status:503});
  const result=await run('legal.export_package',input);
  assert.equal(result.data,undefined);assert.equal(result.manifest,undefined);
  await assert.rejects(app.read(f.actor,'review-package',{id:result.id}),{status:404});
  const download=await app.read(f.owner,'review-package',{id:result.id});
  const bytes=Buffer.from(download.data,'base64');assert.equal(digest(bytes),result.sha256);
  const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['manifest.json'])),signature=JSON.parse(strFromU8(files['signature.json']));
  assert.equal(manifest.documents.length,7);assert.equal(manifest.private,true);assert.equal(manifest.programId,f.programId);
  assert.ok(verify(null,Buffer.from(canonicalJson(manifest)),keys.publicKey,Buffer.from(signature.signature,'base64')));
  for(const file of manifest.files)assert.equal(digest(files[file.name]),file.sha256);
  for(const version of versions){assert.ok(manifest.documents.some(d=>d.versionId===version.id&&d.sourceHash===version.content_sha256));}
  const cpa=manifest.documents.find(d=>d.templateKey==='cpa-cover-letter');
  assert.ok(strFromU8(files['review-checklist.csv']).split('\r\n').some(line=>line.includes(cpa.versionId)&&line.includes('accounting')));
  assert.equal(Object.keys(files).filter(n=>n.endsWith('.docx')).length,7);
  const [receipt]=await f.database.query`SELECT response_json FROM partner_command_keys WHERE operation='legal.export_package' AND completed_at IS NOT NULL`;
  assert.ok(!JSON.stringify(receipt).includes('Synthetic Counsel'));assert.ok(!JSON.stringify(receipt).includes('Synthetic facts'));
  assert.ok((await f.database.query`SELECT id FROM partner_audit_events WHERE action='legal.package_downloaded'`).length);
  await assert.rejects(f.database.query`UPDATE partner_review_artifacts SET filename='changed.zip' WHERE package_id=${result.id}`);
  // Simulate storage corruption with the fixture's DBA authority. Runtime
  // roles cannot disable evidence triggers or update these records.
  await f.database.query`ALTER TABLE partner_review_artifacts DISABLE TRIGGER partner_immutable`;
  await f.database.query`UPDATE partner_review_artifacts SET bytes=${Buffer.from('corrupt')} WHERE package_id=${result.id}`;
  await assert.rejects(app.read(f.owner,'review-package',{id:result.id}),{status:503});
  await f.database.query`UPDATE partner_review_artifacts SET bytes=${bytes},manifest_signature=${'A'.repeat(88)} WHERE package_id=${result.id}`;
  await assert.rejects(app.read(f.owner,'review-package',{id:result.id}),{status:503});
  await f.database.query`UPDATE partner_review_artifacts SET manifest_signature=${signature.signature} WHERE package_id=${result.id}`;
  await f.database.query`ALTER TABLE partner_review_packages DISABLE TRIGGER partner_immutable`;
  await f.database.query`UPDATE partner_review_packages SET manifest=jsonb_set(manifest,'{createdBy}','"tampered"'::jsonb) WHERE id=${result.id}`;
  await assert.rejects(app.read(f.owner,'review-package',{id:result.id}),{status:503});
  instant=new Date('2026-10-31T12:00:00Z');await assert.rejects(app.read(f.owner,'review-package',{id:result.id}),{status:410});
 }finally{await f.close();}
});
