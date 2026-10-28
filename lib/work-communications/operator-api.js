import { createOperatorApiHandler } from '../operator-api.js';
import { HttpError, readJson } from '../http.js';
import { createCommunicationRuntime } from './runtime.js';
export function createCommunicationHandler({work,authorize,allowedOrigins,service}) {
  return createOperatorApiHandler({methods:['GET','POST'],authorize,allowedOrigins,handle:async({req,operator})=>{
    const url=new URL(req.url,'https://operator.invalid');
    const body=req.method==='POST'?await readJson(req,12000):null;
    const id=body?.workId??url.searchParams.get('workId');
    if(!/^work_[A-Za-z0-9_-]{8,123}$/.test(id??''))throw new HttpError(400,'A valid work ID is required.');
    const detail=await work.repository.getWork(id,operator);
    const messages=service??createCommunicationRuntime({workRepository:work.repository});
    if(req.method==='GET')return messages.list(detail);
    const fields=body.action==='create'?['action','workId','command']:['action','workId','messageId'];
    if(Object.keys(body).some(key=>!fields.includes(key)))throw new HttpError(400,'Unexpected communication field.');
    if(body.action==='create')return {message:await messages.create(detail,body.command,operator)};
    if(body.action==='retry'&&/^msg_[a-f0-9]{32}$/.test(body.messageId??''))return {message:await messages.retry(detail,body.messageId,operator)};
    throw new HttpError(400,'Choose a supported communication action.');
  }});
}
