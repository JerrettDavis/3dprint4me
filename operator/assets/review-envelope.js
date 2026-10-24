export const REVIEW_ARCHIVE_MAX=8*1024*1024;
export const REVIEW_ENVELOPE_MAX=Math.ceil((REVIEW_ARCHIVE_MAX+16)/3)*4+1024;
const encoder=new TextEncoder();
export const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
export function base64(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export function unbase64(value,max){if(typeof value!=='string'||!value.length||value.length>Math.ceil(max/3)*4||value.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('Invalid encrypted review file.');let raw;try{raw=atob(value);}catch{throw Error('Invalid encrypted review file.');}if(raw.length>max||btoa(raw)!==value)throw Error('Invalid encrypted review file.');return Uint8Array.from(raw,c=>c.charCodeAt(0));}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function passwordBytes(passphrase){if(typeof passphrase!=='string')throw Error('Use a passphrase of 20 to 1024 UTF-8 bytes.');const bytes=encoder.encode(passphrase);if(bytes.length<20||bytes.length>1024)throw Error('Use a passphrase of 20 to 1024 UTF-8 bytes.');return bytes;}
async function key(passphrase,salt){const bytes=passwordBytes(passphrase);try{const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}finally{bytes.fill(0);}}
export async function encryptReviewArchive(bytes,passphrase,purpose='review-archive'){
 if(!['review-archive','returned-docx'].includes(purpose))throw Error('Invalid encrypted review file.');
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>(purpose==='returned-docx'?524288:REVIEW_ARCHIVE_MAX))throw Error('Choose a review archive up to 8 MiB.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const header={format:'3dprint4me-review-v1',purpose,kdf:{name:'PBKDF2-SHA256',iterations:600000,salt:base64(salt)},cipher:{name:'AES-256-GCM',iv:base64(iv)}};
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(canonical(header)),tagLength:128},await key(passphrase,salt),bytes);
 return {...header,ciphertext:base64(new Uint8Array(ciphertext))};
}
export async function decryptReviewArchive(envelope,passphrase,purpose='review-archive'){
 if(!exact(envelope,['format','purpose','kdf','cipher','ciphertext'])||envelope.format!=='3dprint4me-review-v1'||!['review-archive','returned-docx'].includes(purpose)||envelope.purpose!==purpose||!exact(envelope.kdf,['name','iterations','salt'])||envelope.kdf.name!=='PBKDF2-SHA256'||envelope.kdf.iterations!==600000||!exact(envelope.cipher,['name','iv'])||envelope.cipher.name!=='AES-256-GCM')throw Error('Invalid encrypted review file.');
 const salt=unbase64(envelope.kdf.salt,16),iv=unbase64(envelope.cipher.iv,12),ciphertext=unbase64(envelope.ciphertext,(purpose==='returned-docx'?524288:REVIEW_ARCHIVE_MAX)+16);
 if(salt.length!==16||iv.length!==12||ciphertext.length<=16)throw Error('Invalid encrypted review file.');
 const header={format:envelope.format,purpose:envelope.purpose,kdf:envelope.kdf,cipher:envelope.cipher};
 try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(canonical(header)),tagLength:128},await key(passphrase,salt),ciphertext));}
 catch{throw Error('Unable to unlock. Check the passphrase and obtain a fresh copy if the file changed.');}
}
