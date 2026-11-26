"""Submit fresh owner-verified capacity evidence; no provider scraping or control renewal."""
import argparse
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('attestation_private_files',Path(__file__).with_name('backup-controller.py'))
files=importlib.util.module_from_spec(spec)
spec.loader.exec_module(files)
private=files.private


def send(body,secret):
    path='/heartbeat/manual'
    data=json.dumps(body,separators=(',',':')).encode()
    if len(data)>16384:raise ValueError('Evidence bound')
    signature=hmac.new(secret.encode(),path.encode()+b'\n'+data,hashlib.sha256).hexdigest()
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    request=urllib.request.Request('https://status-api.3dprint4.me'+path,data=data,method='POST',headers={'Content-Type':'application/json','X-Status-Signature':signature,'User-Agent':'3dprint4me-manual-capacity/1'})
    with urllib.request.build_opener(NoRedirect).open(request,timeout=10) as response:
        if response.status!=200:raise ValueError('Evidence rejected')


def attest(config_path,readings_path,now=None):
    now=time.time_ns()//1000000 if now is None else now
    for path in (config_path,readings_path):
        private(path)
        if path.resolve().is_relative_to(ROOT) or path.stat().st_size>16384:raise ValueError('Private bounded input required')
    config=json.loads(config_path.read_text());records=json.loads(readings_path.read_text())
    secret=config.get('STATUS_CONTROL_SECRET')
    if not isinstance(secret,str) or len(secret)<48:raise ValueError('Owner reporting credential required')
    # Use the shared schema, avoiding a second divergent capacity contract.
    code="import {validateCapacity} from './status/lib/capacity.js';let text='';for await(const c of process.stdin)text+=c;const data=JSON.parse(text);process.stdout.write(JSON.stringify(validateCapacity(data.records,data.now)));"
    result=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps({'records':records,'now':now}).encode(),cwd=ROOT,capture_output=True,timeout=10)
    if result.returncode or len(result.stdout)>16384:raise ValueError('Invalid manual evidence')
    records=json.loads(result.stdout)
    if not records:raise ValueError('Manual readings required')
    for row in records:
        if row['source']!='manual' or not 0<=now-row['observedAt']<=86400000:raise ValueError('Fresh manual verification required')
        if row['limit'] is not None and (row.get('limitSource')!='manual' or type(row.get('limitVerifiedAt')) not in (int,float) or not 0<=now-row['limitVerifiedAt']<=86400000):raise ValueError('Fresh allowance verification required')
    send({'observedAt':now,'nonce':secrets.token_hex(16),'details':{'capacity':records}},secret)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--readings',type=Path,required=True)
    args=parser.parse_args()
    try:
        attest(args.config,args.readings)
        print('Dated manual capacity evidence recorded; control attestations unchanged.')
    except Exception:
        raise SystemExit('Manual capacity reporting failed; private diagnostics suppressed.')
