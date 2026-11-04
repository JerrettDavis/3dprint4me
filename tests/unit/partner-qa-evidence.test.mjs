import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateEvidenceRecords} from '../../scripts/validate-partner-qa-evidence.mjs';
test('QA evidence rejects absent/changed images, stale sources, unknown steps and secret-bearing metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'partner-qa-evidence-'));
 try{
 await mkdir(join(root,'screenshots'));await mkdir(join(root,'evidence'));
 const bytes=Buffer.from('synthetic-image-bytes'),sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(join(root,'screenshots','sample.png'),bytes);
 const catalog={scenarios:[{id:'QA-001',steps:[{id:'done'}],status:'not-run'}]},valid={schemaVersion:1,scenarioId:'QA-001',stepId:'done',runId:'native-001',environment:'native',result:'observed',sourceCommit:'a'.repeat(40),sourceFingerprint:'b'.repeat(64),viewport:{width:390,height:844},theme:'dark',screenshot:'../screenshots/sample.png',sha256,description:'Observed synthetic UI.'};
 await validateEvidenceRecords({root,catalog,records:[valid],currentFingerprint:'b'.repeat(64)});
 for(const patch of [{screenshot:'../screenshots/missing.png'},{sha256:'0'.repeat(64)},{sourceFingerprint:'0'.repeat(64)},{stepId:'invented'},{description:'Authorization: Bearer secret-value'},{screenshot:'../../outside.png'},{result:'passed'}])await assert.rejects(validateEvidenceRecords({root,catalog,records:[{...valid,...patch}],currentFingerprint:'b'.repeat(64)}));
 }finally{await rm(root,{recursive:true,force:true});}
});
