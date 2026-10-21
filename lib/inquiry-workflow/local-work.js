import { randomBytes } from 'node:crypto';

/** Called only within the local repository's serialized, atomic file update. */
export function acceptLocalInquiry(state,row,{now=new Date().toISOString()}={}) {
  let inquiry=state.inquiries.find(x=>x.id===row.id);
  if(!inquiry){inquiry=structuredClone(row);state.inquiries.push(inquiry);}
  inquiry.status='submitted';inquiry.submitted_at??=row.submitted_at??now;
  let item=state.workItems.find(x=>x.inquiryId===row.id);
  if(item)return {workItem:item,created:false};
  item={id:'work_'+randomBytes(16).toString('hex'),kind:'inquiry',inquiryId:row.id,requestId:null,
    projectDraft:false,status:'submitted',previousStatus:null,priority:'normal',acknowledgedAt:null,
    acknowledgedBy:null,targetDate:null,assignedOperatorId:null,revision:1,
    createdAt:inquiry.submitted_at,updatedAt:now,completedAt:null};
  state.workItems.push(item);
  const event={id:String(state.events.length+1),workItemId:item.id,requestId:null,type:'work.created',
    actorType:'system',actorId:null,data:{version:1,source:'inquiry'},occurredAt:now};
  state.events.push(event);
  state.outbox.push({id:String(state.outbox.length+1),eventId:event.id,kind:'new_work',
    payload:{version:1,eventId:event.id,workId:item.id,route:'/work/'+item.id},state:'pending',
    attemptCount:0,nextAttemptAt:now,createdAt:now,updatedAt:now});
  return {workItem:item,created:true};
}
