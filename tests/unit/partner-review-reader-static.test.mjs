import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('downloadable offline reader allows only exact inline hashes and no network or native form submission',async()=>{
 const html=await readFile('operator/review-reader.html','utf8');
 for(const tag of ['script','style']){const content=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1];const hash=createHash('sha256').update(content).digest('base64');assert.ok(html.includes("'sha256-"+hash+"'"));}
 assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("form-action 'none'"));assert.ok(!html.includes('unsafe-inline'));assert.ok(!/<(?:script|link)[^>]+(?:src|href)=/i.test(html));
 assert.match(html,/<form id="unlock" method="dialog"/);assert.match(html,/<form id="return-feedback" method="dialog"/);
});
