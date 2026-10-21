import { databaseProvider,getDatabase,hasDatabase } from '../database.js';
import { getLocalOperatorStore,localOperatorEnabled } from '../local-operator.js';
import { createInquiryStore } from '../inquiry-store.js';
import { createLocalInquiryStore } from './local-inquiry-store.js';
import { createInquiryWorkflowRepository } from './repository.js';
import { createLocalInquiryWorkflowRepository } from './local-repository.js';
import { createInquiryWorkflowService } from './service.js';
import { hasBlob,inspectPrivateObject } from '../blob.js';
import { HttpError } from '../http.js';

export function createInquiryWorkflowRuntime({workRepository}={}) {
  const local=typeof workRepository?.inquiryTransaction==='function'||localOperatorEnabled();
  if(!local&&(!hasDatabase()||databaseProvider()!=='postgres'))return {configured:false,service:null};
  const work=local?(workRepository??getLocalOperatorStore()):null;
  const repository=local?createLocalInquiryWorkflowRepository({work}):createInquiryWorkflowRepository({database:getDatabase()});
  const intake=local?createLocalInquiryStore({work}):createInquiryStore();
  const verifyFiles=async files=>{
    if(!files.length)return;
    if(!hasBlob())throw new HttpError(503,'Private attachments are temporarily unavailable.');
    for(const file of files){
      let object;try{object=await inspectPrivateObject(file.path);}catch{throw new HttpError(503,'A private attachment could not be verified. Try again later.');}
      if(object.pathname!==file.path||object.size!==file.size)throw new HttpError(409,'An attachment is missing or incomplete. Keep the original file and contact the shop.');
    }
  };
  const storefrontOrigin=local?(process.env.SITE_URL??'http://127.0.0.1:4173'):'https://3dprint4.me';
  return {configured:true,actionsEnabled:local||process.env.INQUIRY_WORKFLOW_ENABLED==='1',service:createInquiryWorkflowService({repository,verifyFiles,storefrontOrigin}),rate:key=>intake.rate(key)};
}
