import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..');
export async function buildQaShells({check=false}={}){
 async function output(path,bytes){if(check){const actual=await readFile(path).catch(()=>null);if(!actual?.equals(Buffer.from(bytes)))throw Error('QA shell assets are stale: '+path);}else{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);}}
 for(const kind of ['partner','operator']){
  const base=join(root,kind==='partner'?'partner/public':'operator'),htmlName=kind==='partner'?'index.html':'partners.html';
  let html=await readFile(join(base,htmlName),'utf8');
  html=html.replaceAll('/assets/','/qa-assets/').replace('<title>','<title>QA only · ').replace('name="partner-shell-release" content="partner-shell-v8"','name="partner-qa-shell-release" content="partner-qa-shell-v2"');
  html=html.replace('</header>','</header><aside id="qa-static-notice" class="qa-banner"><strong>QA only — representative stubs</strong><p>Synthetic records only. No legal effect, real work or funds.</p></aside>');
  await output(join(base,kind==='partner'?'qa.html':'partners-qa.html'),html);
  for(const name of await readdir(join(base,'assets'))){
   const source=join(base,'assets',name);let bytes;try{bytes=await readFile(source);}catch(error){if(error.code==='EISDIR')continue;throw error;}
   if(name==='partner.js'||name==='partner-owner.js'){
    const sourceText=bytes.toString();if(!/const qaMode=[^;]+;/.test(sourceText))throw Error('QA mode binding missing.');bytes=Buffer.from(sourceText.replace(/const qaMode=[^;]+;/,'const qaMode=true;'));
   }
   if(kind==='partner'&&name==='drafts.js')bytes=Buffer.from(bytes.toString().replace(/const draftRealm=[^;]+;/,"const draftRealm='qa-';"));
   if(kind==='partner'&&name==='pwa.js')bytes=Buffer.from(bytes.toString().replace(/const qaShell=[^;]+;/,'const qaShell=true;'));
   await output(join(base,'qa-assets',name),bytes);
  }
 }
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)buildQaShells({check:process.argv.includes('--check')}).then(()=>console.log('QA shell graphs verified.')).catch(error=>{console.error(error.message);process.exitCode=1;});
