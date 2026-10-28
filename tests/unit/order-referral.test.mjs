import {readFile} from 'node:fs/promises';
import {REFERRAL_CONSENT_TEXT,REFERRAL_CONSENT_VERSION} from '../../public/assets/js/order/referral.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProjectRequest} from '../../lib/validation.js';
import {projectRequestFromData} from '../../public/assets/js/order/model.js';
import {createDraftStore} from '../../public/assets/js/order/draft-store.js';
const referral={code:'AbCdEfGh1234_-xy',consent:true,consentVersion:'referral-v1'};
const base={projectTitle:'Synthetic project',description:'Project review requested.',contact:{name:'Synthetic customer',email:'customer@example.test'},consent:true,modelUrl:'https://example.test/model.stl'};
for(const service of ['print','design','repair','consult'])test(service+' preserves only explicitly opted-in referral outside service specifications',()=>{
 const request=projectRequestFromData({data:{service,referralCode:referral.code,referralConsent:true,material:'pla'},estimate:{},files:[],buildSummary:data=>({...base,service,specifications:{...data}})});
 assert.deepEqual(request.referral,referral);
 assert.ok(!('referralCode' in request.specifications)&&!('referralConsent' in request.specifications));
 assert.deepEqual(normalizeProjectRequest(request).referral,referral);
 const off=projectRequestFromData({data:{service,referralCode:referral.code,referralConsent:false},estimate:{},files:[],buildSummary:()=>({...base,service})});
 assert.ok(!('referral' in off));
});
test('server rejects unconsented, malformed, stale and injected referral claims',()=>{
 for(const value of [{...referral,consent:false},{...referral,code:'bad'},{...referral,consentVersion:'future'},{...referral,paid:true},{...referral,consent:'true'},'bad'])assert.throws(()=>normalizeProjectRequest({...base,service:'consult',referral:value}),error=>error.status===400);
 assert.ok(!('referral' in normalizeProjectRequest({...base,service:'consult'})));
});
test('pending device drafts never save or restore referral permission or code; recovery copies retain opted-in choice',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const store=createDraftStore({storage,draftKey:'draft',submittedKey:'sent'});
 store.saveDraft({service:'consult',referralCode:referral.code,referralConsent:true});
 assert.ok(!values.get('draft').includes(referral.code));assert.ok(!('referralConsent' in store.loadDraft()));
 values.set('draft',JSON.stringify({service:'consult',referralCode:referral.code,referralConsent:true,referral}));
 assert.deepEqual(store.loadDraft(),{service:'consult'});
 store.saveSubmitted({...base,referral});assert.deepEqual(JSON.parse(values.get('sent'))[0].referral,referral);
});

test('published referral permission copy matches the version accepted by the server',async()=>{
 const html=await readFile(new URL('../../public/order.html',import.meta.url),'utf8');
 assert.ok(html.includes('label for="referral-consent">'+REFERRAL_CONSENT_TEXT+'</label>'));
 assert.equal(referral.consentVersion,REFERRAL_CONSENT_VERSION);
});
