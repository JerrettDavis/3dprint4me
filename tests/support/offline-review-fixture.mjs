// Synthetic offline-only evidence. No real signing key, reviewer or professional approval.
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {encryptReviewArchive,canonical} from '../../operator/assets/review-envelope.js';
import {createReviewDocx} from '../../lib/partner-outreach/docx.js';
const digest=value=>createHash('sha256').update(value).digest('hex'),keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'});
const markdown='# Synthetic review terms\n## [TEST-01] Scope\nDisposable browser and screenshot fixture.\n',sourceHash=digest(markdown),passphrase='Synthetic offline fixture passphrase 2026!';
const files={'synthetic-terms.md':strToU8(markdown),'synthetic-terms.docx':createReviewDocx({markdown,sourceHash}),'review-instructions.txt':strToU8('Synthetic review copy. Return suggestions as DOCX; no actual professional approval.')};
const manifest={schemaVersion:1,packageId:'72000000-1000-4000-8000-100000000001',programId:'72000000-1000-4000-8000-100000000002',private:true,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+2*86400000).toISOString(),publicKeyFingerprint:digest(publicKey),documents:[{versionId:'72000000-1000-4000-8000-100000000003',title:'Synthetic review terms',sourceHash}],reviewers:[{name:'Synthetic professional counsel',role:'attorney',scopes:['agreement_language']}],files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.length,sha256:digest(bytes)}))};
const signature={algorithm:'Ed25519',publicKey,signature:sign(null,Buffer.from(canonical(manifest)),keys.privateKey).toString('base64')};
const archive=zipSync({...files,'manifest.json':strToU8(canonical(manifest)+'\n'),'signature.json':strToU8(canonical(signature)+'\n')});
console.log(JSON.stringify({passphrase,fingerprint:manifest.publicKeyFingerprint,envelope:await encryptReviewArchive(archive,passphrase),markdown}));
