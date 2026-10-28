// Offline synthetic artifacts for the document render/inspection gate.
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { resolve,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReviewDocx } from '../lib/partner-outreach/docx.js';
import { prepareLegalVersion } from '../lib/partner-outreach/legal-content.js';
import { minimumScopes } from '../lib/partner-outreach/legal.js';
const output=resolve(process.argv[2]??'');
const repo=fileURLToPath(new URL('../',import.meta.url));
const location=relative(repo,output);
if(!process.argv[2]||!(isAbsolute(location)||location==='..'||location.startsWith('..'+sep)))throw new Error('Choose a private QA output directory outside the repository.');
await mkdir(output,{recursive:true});
const root=new URL('../contracts/partner/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
for(const entry of manifest.templates){
 const markdown=await readFile(new URL(entry.file,root),'utf8');
 const version=prepareLegalVersion({title:markdown.match(/^# (.+)$/m)[1],markdown,variablesSchema:manifest.variables,issuable:false,requiredScopes:minimumScopes(entry.key)});
 await writeFile(resolve(output,entry.key+'.docx'),createReviewDocx({markdown:version.markdown,sourceHash:version.hash}));
}
console.log('Wrote seven anonymized draft DOCX samples for private rendering.');
