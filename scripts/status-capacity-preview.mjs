// Synthetic capacity preview for browser tests and screenshot review. No providers.
import { privateSnapshot } from '../status/lib/model.js';
import { updateCapacity } from '../status/lib/capacity.js';
import { operationsPage } from '../status/lib/operations-page.js';
const now=Date.now();
const record=(id,used,limit,source='provider',scope='account',extra={})=>({id,used,limit,observedAt:now-60000,periodStart:null,periodEnd:now+86400000,source,scope,...extra});
const readings=[record('blob-transfer',7.5e9,10e9),record('blob-storage',23e6,1e9),record('resend-daily',45,100),record('resend-monthly',2750,3000),record('host-disk',70e9,100e9,'local','host'),record('host-memory',7e9,8e9,'local','host'),record('rate-sessions-global',225,300,'application','application'),record('rate-sessions-client',null,10,'application','application'),record('backup-downloaded',0,null,'backup','application'),record('backup-reused',23523371,null,'backup','application'),record('cf-requests',15000,100000,'provider','account',{observedAt:now-3*3600000})];
let capacity=updateCapacity({},readings,now);
capacity=updateCapacity(capacity,readings.map(r=>({...r,observedAt:r.observedAt+30000})),now);
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const state={capacity,alerts:{configured:true,digestConfigured:true,digestStatus:'delivered',lastDigestDay:day,lastSuccessAt:now-3600000}};
const response=operationsPage(privateSnapshot(state,now),{theme:process.argv[2]??'system'});
process.stdout.write(await response.text());
