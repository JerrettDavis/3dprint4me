import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {zipSync,strToU8} from 'fflate';
import {canonical} from '../../operator/assets/review-envelope.js';
import {verifyReviewArchive} from '../../operator/review-reader/verify.js';
const digest=b=>createHash('sha256').update(b).digest('hex');
function fixture({extra=false,changed=false,metadataAltered=false,expires='2026-11-01T12:00:00Z'}={}){
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}),name='terms-v1-70000000-1000-4000-8000-100000000002.md';
 const bytes=strToU8('Synthetic private canonical text.');
 const manifest={schemaVersion:1,packageId:'70000000-1000-4000-8000-100000000001',private:true,expiresAt:expires,publicKeyFingerprint:digest(publicKey),documents:[{versionId:'70000000-1000-4000-8000-100000000002',title:'Synthetic terms',sourceHash:'a'.repeat(64)}],reviewers:[{name:'Synthetic counsel',role:'attorney',scopes:['agreement_language']}],files:[{name,bytes:bytes.length,sha256:digest(bytes)}]};
 const signature={algorithm:'Ed25519',publicKey,signature:sign(null,Buffer.from(canonical(manifest)),keys.privateKey).toString('base64')};
 if(metadataAltered)manifest.documents[0].title='Tampered after signature';
 return {fingerprint:manifest.publicKeyFingerprint,bytes:zipSync({[name]:changed?strToU8('ATTACK altered source'):bytes,'manifest.json':strToU8(canonical(manifest)+'\n'),'signature.json':strToU8(canonical(signature)+'\n'),...(extra?{'unexpected.html':strToU8('<script>unsafe</script>')}:{})})};
}
const options={now:new Date('2026-10-24T12:00Z'),inflateRaw:(bytes,max)=>inflateRawSync(bytes,{maxOutputLength:Math.max(1,max)})};
test('offline verification requires independently trusted key, signed manifest and every file hash',async()=>{
 const f=fixture(),result=await verifyReviewArchive(f.bytes,f.fingerprint,options);assert.equal(result.files.length,1);assert.equal(result.manifest.reviewers[0].name,'Synthetic counsel');
 await assert.rejects(verifyReviewArchive(f.bytes,'b'.repeat(64),options),/trusted signing fingerprint/);
 for(const settings of [{changed:true},{extra:true},{metadataAltered:true},{expires:'2026-10-01T12:00:00Z'}]){const bad=fixture(settings);await assert.rejects(verifyReviewArchive(bad.bytes,bad.fingerprint,options));}
});
