import { HttpError } from '../http.js';

export function createLocalCommunicationRepository({work}) {
  const transaction=fn=>work.inquiryTransaction(state=>{state.communications??=[];return fn(state.communications);});
  return {
    list:workId=>transaction(rows=>rows.filter(row=>row.workId===workId).slice(-200)),
    find:(workId,id)=>transaction(rows=>rows.find(row=>row.workId===workId&&row.id===id)??null),
    create:input=>transaction(rows=>{
      const existing=rows.find(row=>row.workId===input.workId&&row.operatorId===input.operatorId&&row.commandId===input.commandId);
      if(existing){if(existing.fingerprint!==input.fingerprint)throw new HttpError(409,'That message command was already used for different content.');return {...existing,inserted:false};}
      rows.push(input);return {...input,inserted:true};
    }),
    claim:(workId,id,{stamp,claimId,envelope,staleBefore})=>transaction(rows=>{
      const row=rows.find(row=>row.workId===workId&&row.id===id&&row.kind==='email'&&row.state!=='sent'&&(!row.firstAttemptAt||Date.parse(stamp)-Date.parse(row.firstAttemptAt)<23*3600000)&&
        (row.state!=='sending'||row.lastAttemptAt<=staleBefore));
      if(!row)return null;
      if(!row.firstAttemptAt)row.envelope=envelope;
      row.state='sending';row.firstAttemptAt??=stamp;row.lastAttemptAt=stamp;row.claimId=claimId;return row;
    }),
    finish:(workId,id,claimId,state,{resetFirstAttempt=false}={})=>transaction(rows=>{const row=rows.find(row=>row.workId===workId&&row.id===id);if(row?.claimId===claimId){row.state=state;row.claimId=null;if(resetFirstAttempt)row.firstAttemptAt=null;}return row;})
  };
}
