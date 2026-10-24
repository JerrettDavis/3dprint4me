import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLegalVersion,renderLegalVersion,compareLegalVersions } from '../../lib/partner-outreach/legal-content.js';
test('legal content hashes normalized source, typed schema and issue metadata; draft cannot silently become issuable',()=>{
 const input={title:'Services discussion',markdown:'# DRAFT\r\n## [IMS-04] Fee\r\n${{fee_usd}}\r\n',variablesSchema:{fee_usd:{type:'money',required:true,default:5000}},issuable:false,requiredScopes:['agreement_language']};
 const a=prepareLegalVersion(input),b=prepareLegalVersion({...input,markdown:input.markdown.replaceAll('\r\n','\n')});
 assert.equal(a.hash,b.hash);assert.notEqual(a.hash,prepareLegalVersion({...input,title:'Changed title'}).hash);
 assert.throws(()=>prepareLegalVersion({...input,issuable:true}),{status:400});
 assert.throws(()=>prepareLegalVersion({...input,markdown:'{{unregistered}}'}),{status:400});
 assert.throws(()=>prepareLegalVersion({...input,markdown:'<script>alert(1)</script>'}),{status:400});
 assert.throws(()=>prepareLegalVersion({...input,markdown:'![image](https://remote.test/image.png)'}),{status:400});
 const rendered=renderLegalVersion(a,{fee_usd:5500});assert.match(rendered.markdown,/55.00/);assert.notEqual(rendered.hash,renderLegalVersion(a,{fee_usd:5000}).hash);
 assert.throws(()=>renderLegalVersion(a,{fee_usd:'5500'}),{status:400});
 assert.throws(()=>renderLegalVersion(a,{fee_usd:5500,unexpected:'value'}),{status:400});
 const diff=compareLegalVersions(a.markdown,a.markdown.replace('Fee','Agreed fee'));assert.ok(diff.changed);assert.ok(diff.clauses.some(c=>c.anchor==='IMS-04'&&c.changed));
});
