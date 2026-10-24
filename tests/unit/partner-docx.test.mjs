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
