"""Synthetic loopback baseline; run only after all heavy verification jobs finish."""
import sys,json,math,platform,hashlib,subprocess,argparse
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
output=args.output.resolve()
if output.is_relative_to(ROOT/'public'):parser.error('Measurement evidence must stay outside public output.')
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig

def summarize(values):
    ordered=sorted(values)
    return {name:round(ordered[max(0,math.ceil(len(ordered)*q)-1)],3) for name,q in [('p50Ms',.5),('p95Ms',.95),('p99Ms',.99)]}|{'samples':len(values),'minMs':round(ordered[0],3),'maxMs':round(ordered[-1],3)}

with reviewed_budget_workspace(observe_outbound=True) as w:
    gig=w['offer'](5000);w['accept'](gig);finish_gig(w,gig)
    routes=[('partner_gigs',w['pages'][0],'/api/partner/v1/gigs'),('partner_earnings',w['pages'][0],'/api/partner/v1/earnings'),('partner_agreements',w['pages'][0],'/api/partner/v1/agreements'),('owner_programs',w['owner'],'/api/operator-partners?resource=programs'),('owner_forecasts',w['owner'],'/api/operator-partners?resource=forecasts&programId='+w['programId'])]
    metrics={}
    for label,page,path in routes:
        results=page.evaluate("""async ({url})=>{const samples=[];let minimumBytes=Infinity;for(let i=0;i<105;i++){const start=performance.now();const response=await fetch(url,{credentials:'include',cache:'no-store'});const body=await response.text();if(response.status!==200)throw Error('Baseline endpoint failed: '+response.status);JSON.parse(body);minimumBytes=Math.min(minimumBytes,body.length);if(i>=5)samples.push(performance.now()-start);}return {samples,minimumBytes};}""",{'url':w['fixture']['apiOrigin']+path})
        metrics[label]=summarize(results['samples'])|{'minimumResponseCharacters':results['minimumBytes'],'warmupRequests':5}
    assert w['fixture']['outboundAttempts']()==0
    proof={'generatedAt':datetime.now(timezone.utc).isoformat(),'scope':'synthetic disposable native PostgreSQL; loopback browser-to-API fetch+body+JSON; sequential; no production network, real users, mobile hardware, throughput or concurrency claim','quantile':'nearest rank ceil(N*q), 100 measured requests after 5 warmups per endpoint','head':subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True,check=True).stdout.strip(),'os':platform.system(),'metrics':metrics,'syntheticWork':{'partners':2,'acceptedPayableCents':5000},'outboundFetchAttempts':0,'sourceHashes':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['lib/partner-outreach/application.js','lib/partner-outreach/forecasts.js','lib/partner-outreach/http.js','lib/partner-outreach/runtime.js']}}
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:value for key,value in proof.items() if key!='sourceHashes'}))
