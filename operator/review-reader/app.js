import {decryptReviewArchive,encryptReviewArchive,REVIEW_ENVELOPE_MAX} from '../assets/review-envelope.js';
import {verifyReviewArchive} from './verify.js';
const form=document.querySelector('#unlock'),status=document.querySelector('#status'),result=document.querySelector('#result'),returnForm=document.querySelector('#return-feedback'),returnStatus=document.querySelector('#return-status'),returnLink=document.querySelector('#return-download');
let epoch=0,urls=[],expiryTimer=null,manifest=null,busy=false,returnUrl=null,returnEpoch=0;
const text=(tag,value,parent)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
function clearReturn(){++returnEpoch;if(returnUrl)URL.revokeObjectURL(returnUrl);returnUrl=null;returnLink.hidden=true;returnLink.removeAttribute('href');returnStatus.textContent='';}
function lock(message='Private view cleared. Select the encrypted file and unlock again.'){
 ++epoch;clearReturn();for(const url of urls)URL.revokeObjectURL(url);urls=[];manifest=null;clearInterval(expiryTimer);expiryTimer=null;result.replaceChildren();result.hidden=true;returnForm.hidden=true;returnForm.reset();form.reset();status.textContent=message;
}
document.querySelector('#lock').onclick=()=>lock();document.addEventListener('visibilitychange',()=>{if(document.hidden)lock();});addEventListener('pagehide',()=>lock());
document.querySelector('#theme').onchange=event=>document.documentElement.dataset.theme=event.target.value;
function download(bytes,name,label,parent){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));urls.push(url);link.href=url;link.download=name;link.textContent=label;parent.append(link);}
// Read selected File values before clearing form fields. No form sends a request.
form.onsubmit=async event=>{
 event.preventDefault();if(busy||document.hidden)return;const file=form.elements.file.files[0],fingerprint=form.elements.fingerprint.value.trim().toLowerCase();let pass=form.elements.passphrase.value;lock('Unlocking and verifying locally…');const token=epoch;busy=true;const button=form.querySelector('button');button.disabled=true;let bytes;
 try{if(!file||!file.size||file.size>REVIEW_ENVELOPE_MAX)throw Error('Choose an encrypted review file up to 11 MiB.');let envelope;try{envelope=JSON.parse(await file.text());}catch{throw Error('Invalid encrypted review file.');}if(token!==epoch)return;bytes=await decryptReviewArchive(envelope,pass);pass='';if(token!==epoch||document.hidden)return;const verified=await verifyReviewArchive(bytes,fingerprint);if(token!==epoch||document.hidden)return;manifest=verified.manifest;
  text('h2','Verified professional review package',result);text('p','Package '+manifest.packageId+'; grant expires '+manifest.expiresAt+'. Device-clock expiry does not recall offline copies. The owner must verify returned identity and decisions separately.',result);
  text('h3','Named reviewer grants',result);for(const r of manifest.reviewers)text('p',r.name+' ('+r.role+'): '+r.scopes.join(', '),result);
  text('h3','Exact source versions',result);for(const d of manifest.documents)text('p',d.title+' — '+d.versionId+'; SHA-256 '+d.sourceHash,result);
  text('h3','Verified editable files and review aids',result);const list=document.createElement('ul');result.append(list);for(const file of verified.files){const li=document.createElement('li');list.append(li);download(file.bytes,file.name,file.name,li);}
  text('p','Download the Markdown/DOCX files you need. Return tracked changes or comments as a DOCX. Record your exact source hash, scope, decision, conditions and review date through the agreed private channel. This reader cannot approve or change the owner records. Downloaded files remain on this device after locking.',result);result.hidden=false;returnForm.hidden=false;status.textContent='Signature, trusted fingerprint and every listed file hash verified locally.';
  expiryTimer=setInterval(()=>{if(manifest&&new Date(manifest.expiresAt)<=new Date())lock('This review grant expired. Ask the owner for a fresh package.');},30000);
 }catch(error){if(token===epoch)status.textContent=error.message;}finally{pass='';bytes?.fill(0);busy=false;button.disabled=false;}
};
returnForm.addEventListener('input',clearReturn);
returnForm.onsubmit=async event=>{
 event.preventDefault();if(busy||!manifest||document.hidden)return;if(new Date(manifest.expiresAt)<=new Date()){lock('This review grant expired. Ask the owner for a fresh package.');return;}clearReturn();const token=epoch,returnToken=returnEpoch,file=returnForm.elements.attachment.files[0],packageId=manifest.packageId;let pass=returnForm.elements.passphrase.value;const confirmation=returnForm.elements.confirmation.value;returnForm.elements.passphrase.value=returnForm.elements.confirmation.value='';busy=true;const button=returnForm.querySelector('button');button.disabled=true;let bytes;
 try{if(!file||!file.size||file.size>524288||!file.name.toLowerCase().endsWith('.docx'))throw Error('Choose a returned DOCX up to 512 KiB.');if(pass!==confirmation)throw Error('The return passphrases did not match. Enter them again.');bytes=new Uint8Array(await file.arrayBuffer());if(token!==epoch||returnToken!==returnEpoch)return;const encrypted=await encryptReviewArchive(bytes,pass,'returned-docx');if(token!==epoch||returnToken!==returnEpoch||document.hidden)return;returnUrl=URL.createObjectURL(new Blob([JSON.stringify(encrypted)+'\n'],{type:'application/json'}));returnLink.href=returnUrl;returnLink.download=`returned-review-${packageId}.3dpreview`;returnLink.hidden=false;returnStatus.textContent='Returned DOCX encrypted locally. Share this file and convey the return passphrase separately. No decision or attachment was submitted by this reader.';
 }catch(error){if(token===epoch&&returnToken===returnEpoch)returnStatus.textContent=error.message;}finally{pass='';bytes?.fill(0);busy=false;button.disabled=false;}
};
