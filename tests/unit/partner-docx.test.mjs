import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync,strFromU8 } from 'fflate';
import { createReviewDocx } from '../../lib/partner-outreach/docx.js';
test('review DOCX preserves clause identifiers and escaped text without external relationships',()=>{
 const source='# Review subject\n**DRAFT FOR REVIEW**\n\n## [IMS-01] Parties\nA & B <review>\n\n- First item\n- Second **bold** item\n';
 const bytes=createReviewDocx({markdown:source,sourceHash:'a'.repeat(64)}),files=unzipSync(bytes);
 const xml=strFromU8(files['word/document.xml']);
 assert.match(xml,/w:pStyle w:val="Title"/);assert.match(xml,/IMS-01/);assert.match(xml,/A &amp; B &lt;review&gt;/);
 assert.match(xml,/w:numPr/);assert.match(xml,/w:b\//);assert.doesNotMatch(xml,/\*\*bold\*\*/);
 assert.match(strFromU8(files['word/footer1.xml']),/aaaaaaaa/);
 for(const [name,data]of Object.entries(files))if(name.endsWith('.rels'))assert.doesNotMatch(strFromU8(data),/TargetMode="External"/);
 assert.deepEqual(createReviewDocx({markdown:source,sourceHash:'a'.repeat(64)}),bytes);
});
test('review DOCX bounds source and rejects invalid provenance',()=>{
 assert.throws(()=>createReviewDocx({markdown:'x',sourceHash:'bad'}));
 assert.throws(()=>createReviewDocx({markdown:'x'.repeat(200001),sourceHash:'a'.repeat(64)}));
});
test('simple review tables have repeated headers, padded cells and escaped editable content',()=>{
 const files=unzipSync(createReviewDocx({markdown:'# Review worksheet\n\n| Clause | Question |\n| --- | --- |\n| IMS-04 | Fee & timing |\n| IMS-05 | Cancellation |',sourceHash:'a'.repeat(64)}));
 const xml=strFromU8(files['word/document.xml']);
 assert.match(xml,/<w:tbl>/);assert.match(xml,/<w:tblHeader\/>/);assert.match(xml,/<w:tcMar>/);assert.match(xml,/Fee &amp; timing/);
 assert.equal((xml.match(/<w:tr>/g)??[]).length,3);
});
test('table dimensions fail with an actionable client error',()=>{
 for(const markdown of ['A | B\n--- | ---\nOnly one cell | two | three',Array.from({length:7},(_,i)=>`Header ${i}`).join('|')+'\n'+Array(7).fill('---').join('|')])assert.throws(()=>createReviewDocx({markdown,sourceHash:'a'.repeat(64)}),{status:400});
});
test('the maximum canonical legal source including its final newline remains exportable',()=>{
 assert.ok(createReviewDocx({markdown:'x'.repeat(200000)+'\n',sourceHash:'a'.repeat(64)}).length);
});
