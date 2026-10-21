import assert from 'node:assert/strict';
import test from 'node:test';
import {captureInquiryHandoff,takeInquiryText} from '../../public/assets/js/order/inquiry-handoff.js';

test('Fragment is cleared before redemption, capability stays out of projected prefill',async()=>{
  const token='a'.repeat(64),calls=[];
  const handoff=captureInquiryHandoff({location:{hash:'#inquiry='+token,pathname:'/order.html',search:''},history:{replaceState(...args){calls.push(['clear',args]);}},fetchImpl:async(url,options)=>{calls.push(['read',url,JSON.parse(options.body)]);return new Response(JSON.stringify({inquiryId:'INQ-test',inquiry:{name:'Customer',replyEmail:'person@example.com',message:'A part',intent:'question'},files:[]}));}});
  assert.equal(calls[0][0],'clear');
  const context=await handoff.load();
  assert.equal(handoff.token(),token);
  assert.equal(context.prefill.email,'person@example.com');
  assert.equal(context.prefill.service,'');
  assert.equal(JSON.stringify(context).includes(token),false);
  assert.equal(calls[1][2].token,token);
});
test('Malformed invitations fail closed without network access',async()=>{
  const handoff=captureInquiryHandoff({location:{hash:'#inquiry=wrong',pathname:'/order.html',search:''},history:{replaceState(){}},fetchImpl:()=>assert.fail('must not request')});
  assert.equal(handoff.present,true);await assert.rejects(handoff.load,/invitation/);
});
test('Unconfirmed inquiry text is consumed once and never imports authority or consent',()=>{
  let value=JSON.stringify({name:'Customer',email:'person@example.com',message:'My question',referenceUrl:'javascript:bad',intent:'print',token:'private',terms:true,files:[{path:'private'}]});
  const storage={getItem:()=>value,removeItem(){value=null;}};
  const data=takeInquiryText(storage);
  assert.equal(value,null);assert.equal(data.service,'');assert.equal(data.terms,false);assert.equal(data.description,'My question');
  assert.equal(data.modelUrl,'');assert.equal(data.token,undefined);assert.equal(data.files,undefined);
});
