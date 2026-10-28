import { getDatabase } from '../database.js';
import { createPartnerApplication } from './application.js';
import { createPartnerAuth } from './auth.js';
export function createPartnerRuntime({database=getDatabase(),env=process.env,now=()=>new Date()}={}) {
 const app=createPartnerApplication({database,env,now});
 const auth=createPartnerAuth({database,now,canEnroll:app.approvals.canEnroll,verifyOwner:(tx,actor)=>app.guard(tx,actor)});
 return {database,app,auth};
}
let cached;
export function getPartnerRuntime(){
 const database=getDatabase();
 if(cached?.database!==database)cached=createPartnerRuntime({database});
 return cached;
}
