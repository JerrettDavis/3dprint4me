import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { prepareLegalVersion } from './legal-content.js';
import { minimumScopes } from './legal.js';
import { uuid } from './validation.js';

// Fixed server-side assets only. The browser cannot choose a filesystem path.
const root=new URL('../../contracts/partner/',import.meta.url);
export function templateSeedCommands({repo,now}){
 return {'legal.seed_templates':{role:'OWNER',fields:['programId'],run:async(tx,input,actor)=>{
  const program=await repo.lockProgram(tx,uuid(input.programId));
  const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  let created=0;
  for(const entry of manifest.templates){
   if(!/^[a-z0-9-]+\.md$/.test(entry.file))throw new Error('Invalid bundled template filename.');
   const markdown=await readFile(new URL(entry.file,root),'utf8');
   const content=prepareLegalVersion({title:markdown.match(/^# (.+)$/m)?.[1]??entry.key,markdown,variablesSchema:manifest.variables,issuable:false,requiredScopes:minimumScopes(entry.key)});
   const [document]=await tx.query`INSERT INTO partner_legal_documents(id,template_key,title) VALUES(${randomUUID()},${entry.key},${content.title}) ON CONFLICT DO NOTHING RETURNING id`;
   if(!document)continue;
   const id=randomUUID();
   await tx.query`INSERT INTO partner_legal_versions(id,document_id,version_no,title,markdown,variables_schema,content_sha256,issuable,required_scopes,authored_by,change_reason,created_at) VALUES(${id},${document.id},1,${content.title},${content.markdown},${JSON.stringify(content.variablesSchema)}::jsonb,${content.hash},false,${JSON.stringify(content.requiredScopes)}::jsonb,${actor.id},'Bundled anonymized discussion draft; professional review required.',${now().toISOString()})`;
   await repo.audit(tx,{programId:program.id,actor,action:'legal.template_seeded',entityKind:'legal_document',entityId:document.id,changes:{versionId:id,hash:content.hash,issuable:false}});
   created++;
  }
  return {created};
 }}};
}
