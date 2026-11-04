import {readFile,readdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export async function validateEvidenceRecords({root,catalog,records,currentFingerprint}){
 const byId=new Map(catalog.scenarios.map(s=>[s.id,s]));if(byId.size!==catalog.scenarios.length)throw Error('Duplicate scenario IDs.');
 for(const m of records){
  const scenario=byId.get(m.scenarioId);if(!scenario)throw Error('Unknown evidence scenario.');
  if(!scenario.steps.some(s=>s.id===m.stepId)&&!scenario.evidenceSteps?.includes(m.stepId)&&!/^final-[1-9][0-9]*$/.test(m.stepId))throw Error('Unknown evidence step.');
  if(m.schemaVersion!==1||!['native','mock','hosted'].includes(m.environment)||m.result!=='observed'||!m.runId||!/^[a-f0-9]{40}$/.test(m.sourceCommit??'')||m.sourceFingerprint!==currentFingerprint)throw Error('Stale or invalid evidence provenance.');
  if(m.environment==='native'){
   if(!/^[A-Za-z0-9_-]{1,160}$/.test(m.runId))throw Error('Unsafe native run ID.');
   const bytes=await readFile(resolve(root,'evidence/runs',m.runId+'.start.json')),start=JSON.parse(bytes);
   if(createHash('sha256').update(bytes).digest('hex')!==m.startSha256||start.runId!==m.runId||start.environment!=='native'||start.sourceFingerprint!==m.sourceFingerprint||start.sourceCommit!==m.sourceCommit||m.testNodeId!==scenario.testNodeId)throw Error('Capture does not match native run provenance.');
  }
  if(![390,1440].includes(m.viewport?.width)||!['light','dark'].includes(m.theme))throw Error('Invalid evidence viewport/theme.');
  if(/authorization\s*:\s*bearer|__Host-[^\s]*=|-----BEGIN .*PRIVATE KEY|(?:csrfToken|recoveryToken|invitationToken)\s*["':=]/i.test(JSON.stringify(m)))throw Error('Secret marker in evidence metadata.');
  if(typeof m.screenshot!=='string'||!/^\.\.\/screenshots\/[A-Za-z0-9_-]+\.png$/.test(m.screenshot))throw Error('Unsafe screenshot path.');
  const file=resolve(root,'evidence',m.screenshot);if(!file.startsWith(resolve(root,'screenshots')+sep))throw Error('Screenshot outside evidence root.');
  const bytes=await readFile(file);if(createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw Error('Screenshot checksum mismatch.');
 }
 return {records:records.length,scenarios:catalog.scenarios.length};
}
export async function validatePartnerQaDocs(repoRoot=resolve(import.meta.dirname,'..')){
 const root=resolve(repoRoot,'docs/partner-qa'),catalog=JSON.parse(await readFile(resolve(root,'scenarios.json'),'utf8'));
 const currentFingerprint=execFileSync('python',['-c','from tests.support.partner_qa_evidence import source_fingerprint; print(source_fingerprint())'],{cwd:repoRoot,encoding:'utf8'}).trim();
 const records=[];for(const file of await readdir(resolve(root,'evidence')).catch(()=>[]))if(file.endsWith('.json')&&file!=='run-summary.json')records.push(JSON.parse(await readFile(resolve(root,'evidence',file),'utf8')));
 const summary=JSON.parse(await readFile(resolve(root,'evidence/run-summary.json'),'utf8').catch(()=>'{"cases":[]}'));
 if(summary.runId){
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(summary.runId))throw Error('Unsafe summary run ID.');
  const startBytes=await readFile(resolve(root,'evidence/runs',summary.runId+'.start.json')),endBytes=await readFile(resolve(root,'evidence/runs',summary.runId+'.end.json'));
  const start=JSON.parse(startBytes),end=JSON.parse(endBytes),hash=b=>createHash('sha256').update(b).digest('hex');
  if(summary.environment!=='native'||summary.startSha256!==hash(startBytes)||summary.endSha256!==hash(endBytes)||end.startSha256!==summary.startSha256||end.junitSha256!==summary.junitSha256||start.sourceFingerprint!==currentFingerprint||end.sourceFingerprintAfter!==currentFingerprint||summary.sourceFingerprint!==currentFingerprint||summary.sourceCommit!==start.sourceCommit||end.sourceCommit!==start.sourceCommit||JSON.stringify([...end.cases].sort((a,b)=>a.testNodeId.localeCompare(b.testNodeId)))!==JSON.stringify([...summary.cases].sort((a,b)=>a.testNodeId.localeCompare(b.testNodeId))))throw Error('Invalid native run summary provenance.');
 }
 for(const scenario of catalog.scenarios){
  const [source,name]=scenario.testNodeId.split('::'),baseName=name.split('[')[0];
  const code=await readFile(resolve(repoRoot,source),'utf8');if(!code.includes('def '+baseName+'('))throw Error('Missing native test mapping: '+scenario.id);
  const feature=await readFile(resolve(root,scenario.feature),'utf8');if(!feature.replaceAll('\r\n','\n').includes('@'+scenario.id+'\n'))throw Error('Missing Gherkin scenario: '+scenario.id);
  const markdown=await readFile(resolve(root,'flows',scenario.id+'.md'),'utf8');
  for(const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g))await readFile(resolve(root,'flows',match[1]));
  if(scenario.status==='passed'){
   const result=summary.cases.find(c=>c.testNodeId===scenario.testNodeId);if(result?.status!=='passed'||summary.sourceFingerprint!==currentFingerprint)throw Error('Unsubstantiated scenario pass: '+scenario.id);
   if(scenario.evidenceRequirement==='browser-final'&&![390,1440].every(width=>records.some(r=>r.scenarioId===scenario.id&&r.viewport.width===width&&r.runId===summary.runId&&r.environment==='native')))throw Error('Passing browser scenario lacks required captures: '+scenario.id);
  }
 }
 // Collection is authoritative for parameterized cases, not a guessed function count.
 const files=[...new Set(catalog.scenarios.map(s=>s.testNodeId.split('::')[0]))];
 const collected=execFileSync('python',['-m','pytest',...files,'--collect-only','-q'],{cwd:repoRoot,encoding:'utf8'}).split(/\r?\n/).filter(line=>line.startsWith('tests/')&&line.includes('::test_')).map(line=>line.trim().replaceAll('\\','/'));
 const mapped=catalog.scenarios.map(s=>s.testNodeId);if(new Set(mapped).size!==mapped.length||collected.some(node=>!mapped.includes(node))||mapped.some(node=>!collected.includes(node)))throw Error('Incomplete or duplicate native case mapping.');
 return validateEvidenceRecords({root,catalog,records,currentFingerprint});
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href)validatePartnerQaDocs().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
