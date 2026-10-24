import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync,strToU8,strFromU8 } from 'fflate';
import { inspectFeedbackDocx } from '../../lib/partner-outreach/feedback-docx.js';
import { annotatedFeedbackParts as annotated } from '../support/partner-feedback-fixture.mjs';
test('LibreOffice saved feedback retains comments and tracked revisions',async()=>{
 const bytes=await readFile(new URL('../fixtures/partner-review/libreoffice-annotated.docx',import.meta.url));
 const result=await inspectFeedbackDocx(bytes);
 assert.equal(result.comments[0].text,'Clarify & disclose.');assert.equal(result.comments[0].clauseAnchor,'IMS-04');
 assert.deepEqual(result.changes.map(c=>[c.kind,c.text]),[['deletion','fee'],['insertion','project fee']]);
});
test('annotated Word comments and insertions/deletions become untrusted clause suggestions, never applied text',async()=>{
 const result=await inspectFeedbackDocx(zipSync(annotated()));
 assert.equal(result.manualReviewRequired,true);assert.equal(result.comments.length,1);
 assert.equal(result.comments[0].text,'Clarify & disclose.');assert.equal(result.comments[0].clauseAnchor,'IMS-04');
 assert.deepEqual(result.changes.map(c=>[c.kind,c.text,c.clauseAnchor]),[['deletion','fee','IMS-04'],['insertion','project fee','IMS-04']]);
 assert.equal(result.comments[0].authorClaim,'Reviewer');
});
test('feedback ZIP/XML rejects traversal, macros, remote relationships, DTD, malformed XML and expansion abuse',async()=>{
 for(const change of [
  files=>{files['../escape.xml']=strToU8('unsafe');},
  files=>{files['word/vbaProject.bin']=new Uint8Array([1,2]);},
  files=>{files['word/_rels/settings.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" TargetMode="External" Target="https://example.test/template.dotm" Type="attachedTemplate"/></Relationships>');},
  files=>{files['word/_rels/settings.xml.rels']=strToU8('<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="rId1" TargetMode="External" Target="https://example.test" Type="hyperlink"/></r:Relationships>');},
  files=>{files['word/document.xml']=strToU8(strFromU8(files['word/document.xml']).replace('<w:body>','<w:body><w:p><w:fldSimple w:instr="DDEAUTO remote command"/></w:p>'));},
  files=>{files['word/comments.xml']=strToU8('<x>'.repeat(45)+'</x>'.repeat(45));},
  files=>{files['word/comments.xml']=strToU8('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///secret">]><x>&a;</x>');},
  files=>{files['word/comments.xml']=strToU8('<w:comments><broken></w:comments>');},
  files=>{files['word/comments.xml']=strToU8('<x>'+(' '.repeat(1500000))+'</x>');},
 ]){const files=annotated();change(files);await assert.rejects(inspectFeedbackDocx(zipSync(files)),{status:400});}
 await assert.rejects(inspectFeedbackDocx(new Uint8Array(524289)),{status:400});
});

test('ambiguous local headers, overlapping entry offsets and trailing ZIP bytes are rejected',async()=>{
 const original=zipSync(annotated(),{level:0});
 const changedName=original.slice();changedName[30]^=1;
 await assert.rejects(inspectFeedbackDocx(changedName),{status:400});
 const trailing=new Uint8Array(original.length+1);trailing.set(original);
 await assert.rejects(inspectFeedbackDocx(trailing),{status:400});
 const otherDisk=original.slice(),diskView=new DataView(otherDisk.buffer);
 diskView.setUint16(diskView.getUint32(otherDisk.length-22+16,true)+34,1,true);
 await assert.rejects(inspectFeedbackDocx(otherDisk),{status:400});
 const overlap=original.slice(),view=new DataView(overlap.buffer),eocd=overlap.length-22;
 const first=view.getUint32(eocd+16,true),second=first+46+view.getUint16(first+28,true)+view.getUint16(first+30,true)+view.getUint16(first+32,true);
 view.setUint32(second+42,view.getUint32(first+42,true),true);
 await assert.rejects(inspectFeedbackDocx(overlap),{status:400});
});
