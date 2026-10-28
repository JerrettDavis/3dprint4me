import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptReviewArchive,decryptReviewArchive,REVIEW_ARCHIVE_MAX,REVIEW_ENVELOPE_MAX} from '../../operator/assets/review-envelope.js';
const pass='Synthetic locally held passphrase 2026!';
test('review envelope authenticates bounded archive with randomized salt/IV and no private plaintext metadata',async()=>{
 const bytes=new TextEncoder().encode('PRIVATE synthetic review source');
 const a=await encryptReviewArchive(bytes,pass),b=await encryptReviewArchive(bytes,pass);
 assert.notDeepEqual(a,b);assert.equal(a.kdf.iterations,600000);
 assert.deepEqual(await decryptReviewArchive(a,pass),bytes);
 assert.ok(!JSON.stringify(a).includes('PRIVATE'));assert.ok(!JSON.stringify(a).includes(pass));
 await assert.rejects(decryptReviewArchive(a,pass+'wrong'),/Unable to unlock/);
 const tampered=structuredClone(a);tampered.ciphertext=(a.ciphertext[0]==='A'?'B':'A')+a.ciphertext.slice(1);
 await assert.rejects(decryptReviewArchive(tampered,pass),/Unable to unlock/);
 const header=structuredClone(a);header.cipher.iv='AAAAAAAAAAAAAAAA';await assert.rejects(decryptReviewArchive(header,pass),/Unable to unlock/);
});
test('review envelope refuses unknown or expensive parameters and noncanonical base64 before deriving',async()=>{
 const envelope=await encryptReviewArchive(new Uint8Array([1,2,3]),pass);
 for(const bad of [{...envelope,extra:true},{...envelope,kdf:{...envelope.kdf,iterations:600001}},{...envelope,kdf:{...envelope.kdf,salt:'invalid'}},{...envelope,cipher:{...envelope.cipher,name:'AES-CBC'}},{...envelope,ciphertext:'AB=='},{...envelope,ciphertext:'A'.repeat(Math.ceil(REVIEW_ENVELOPE_MAX/3)*4+4)}])await assert.rejects(decryptReviewArchive(bad,pass),/Invalid encrypted review/);
 await assert.rejects(encryptReviewArchive(new Uint8Array(REVIEW_ARCHIVE_MAX+1),pass),/up to 8 MiB/);
 await assert.rejects(encryptReviewArchive(new Uint8Array([1]),'short'),/20 to 1024/);
});

test('return encryption authenticates purpose and limits returned attachments separately',async()=>{
 const bytes=new Uint8Array([1,2,3]),envelope=await encryptReviewArchive(bytes,pass,'returned-docx');
 assert.deepEqual(await decryptReviewArchive(envelope,pass,'returned-docx'),bytes);
 await assert.rejects(decryptReviewArchive(envelope,pass),/Invalid encrypted review/);
 await assert.rejects(encryptReviewArchive(new Uint8Array(524289),pass,'returned-docx'));
});

test('the declared eight MiB archive boundary round trips without regex stack overflow',async()=>{
 const bytes=new Uint8Array(REVIEW_ARCHIVE_MAX);bytes[0]=12;bytes[bytes.length-1]=34;
 const result=await decryptReviewArchive(await encryptReviewArchive(bytes,pass),pass);
 assert.equal(result.length,bytes.length);assert.equal(result[0],12);assert.equal(result.at(-1),34);
});
