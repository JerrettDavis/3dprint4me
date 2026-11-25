"""Test pinned Restic streaming, copied snapshot lookup and readback on this OS.

python tests/integration/restic_stream_recovery.py --restic /private/tools/restic
Only synthetic data and temporary disposable repositories are used.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import sys
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('controller',ROOT/'deploy/platform/backup-controller.py')
controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)


def incremental_rehearsal(root, stores, env):
    """Run the production exporter against synthetic provider bytes, then encrypt it."""
    provider=root/'provider.json';calls=root/'provider-calls.json';loader=root/'provider-loader.mjs'
    mock="""import {readFileSync,writeFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(process.env.BLOB_FIXTURE,'utf8'));let calls=0;
export async function list(){return {blobs:Object.entries(fixture).map(([pathname,o])=>({pathname,size:Buffer.byteLength(o.text),etag:o.etag})),hasMore:false};}
export async function get(path){calls++;writeFileSync(process.env.BLOB_CALLS,JSON.stringify({gets:calls}));const o=fixture[path],bytes=Buffer.from(o.text);return {statusCode:200,stream:new ReadableStream({start(c){c.enqueue(bytes);c.close();}}),blob:{size:bytes.length,etag:o.etag,contentType:'application/octet-stream'}};}
"""
    from urllib.parse import quote
    loader.write_text("export async function resolve(s,c,n){if(s==='@vercel/blob')return {url:"+json.dumps('data:text/javascript,'+quote(mock))+",shortCircuit:true};return n(s,c);}",encoding='utf8')
    node_env={**env,'BLOB_READ_WRITE_TOKEN':'synthetic-only','BLOB_FIXTURE':str(provider),'BLOB_CALLS':str(calls)}
    scenarios=[{'keep.stl':{'text':'synthetic unchanged','etag':'keep'},'change.stl':{'text':'synthetic old','etag':'old'},'delete.stl':{'text':'synthetic deleted','etag':'deleted'}},None,
               {'keep.stl':{'text':'synthetic unchanged','etag':'keep'},'change.stl':{'text':'synthetic new','etag':'new'},'new.stl':{'text':'synthetic added','etag':'added'}}]
    prior=b'{"type":"header","version":1}\n{"type":"footer","version":1,"objects":0}\n'
    expected_gets=[3,0,2];evidence=[]
    for index,fixture in enumerate(scenarios):
        if fixture is None:fixture=scenarios[0]
        provider.write_text(json.dumps(fixture),encoding='utf8');calls.write_text('{"gets":0}',encoding='utf8')
        selected=controller.previous_objects(stores[0],env)
        if selected:
            prior=controller.command(stores[0]+['dump',selected['snapshots'][0],'/'+selected['filename']],env=env,limit=1024*1024)
            if hashlib.sha256(prior).hexdigest()!=selected['sha256']:raise ValueError('Selected fixture prior hash mismatch')
        requirements=json.dumps({'type':'requirements','paths':list(fixture)}).encode()+b'\n'
        result=subprocess.run(['node','--no-warnings','--loader',loader.as_uri(),'scripts/blob-recovery.mjs','export-incremental'],cwd=ROOT,env=node_env,input=requirements+prior,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        if result.returncode:raise ValueError('Synthetic production exporter failed')
        gets=json.loads(calls.read_text())['gets']
        if gets!=expected_gets[index]:raise ValueError('Unexpected synthetic provider GET count')
        reader=controller.ObjectStreamReader(io.BytesIO(result.stdout))
        while reader.read(65536):pass
        counters=reader.finish()
        if counters['downloadedObjects']!=gets:raise ValueError('Transfer counters mismatch')
        records=[json.loads(line) for line in result.stdout.splitlines()]
        objects={r['pathname']:r for r in records if r['type']=='object'}
        if set(objects)!=set(fixture):raise ValueError('Current inventory not preserved')
        for path,obj in objects.items():
            content=base64.b64decode(obj['base64'],validate=True)
            if content!=fixture[path]['text'].encode() or hashlib.sha256(content).hexdigest()!=obj['sha256']:raise ValueError('Reconstructed object mismatch')
        stamp=f'20261125T00000{index}Z';name=f'3dprint4me/platform-{stamp}-objects.ndjson'
        source=controller.summary_snapshot(controller.command(stores[0]+['backup','--stdin','--stdin-filename',name,'--json'],data=io.BytesIO(result.stdout),env=env))
        controller.command(stores[1]+['copy','--from-repo',str(root/'0'),'--from-password-file',str(root/'synthetic-key'),source],env=env)
        copied=controller.copied_snapshot(stores[1],env,source,name)
        expected=hashlib.sha256(result.stdout).hexdigest()
        for store,snapshot in zip(stores,[source,copied]):
            if controller.stream_hash(store+['dump',snapshot,'/'+name],env)!=expected:raise ValueError('Incremental readback mismatch')
        receipt={'version':1,'filename':name.replace('-objects.ndjson','.tar'),'roundtrip_verified':True,'private_objects':{'filename':name,'snapshots':[source,copied],'sha256':expected,'roundtrip_verified':True}}
        controller.command(stores[0]+['backup','--stdin','--stdin-filename',name.replace('-objects.ndjson','-checkpoint.json'),'--tag','platform:3dprint4me-complete-checkpoint','--json'],data=io.BytesIO(json.dumps(receipt).encode()),env=env)
        evidence.append(counters)
    # A damaged newest completed receipt cannot silently fall back to older data.
    receipt['version']=0
    controller.command(stores[0]+['backup','--stdin','--stdin-filename','3dprint4me/platform-20261125T000003Z-checkpoint.json','--tag','platform:3dprint4me-complete-checkpoint','--json'],data=io.BytesIO(json.dumps(receipt).encode()),env=env)
    try:controller.previous_objects(stores[0],env)
    except ValueError:pass
    else:raise ValueError('Damaged newest checkpoint accepted')
    return evidence


def rehearse(executable):
    if hashlib.sha256(executable.read_bytes()).hexdigest()!=controller.RESTIC_SHA256.get(sys.platform):raise ValueError('Pinned Restic 0.19.1 required')
    env={k:v for k,v in os.environ.items() if not k.upper().startswith('RESTIC_')}
    with tempfile.TemporaryDirectory(prefix='3dprint4me-restic-fixture-') as temporary:
        root=Path(temporary);password=root/'synthetic-key';password.write_text(secrets.token_urlsafe(48));stores=[]
        for index in range(2):
            args=[str(executable),'--repo',str(root/str(index)),'--password-file',str(password),'--cache-dir',str(root/('cache'+str(index)))]
            controller.command(args+['init'],env=env);stores.append(args)
        data=b'{"type":"header","version":1}\n{"type":"footer","version":1,"objects":0}\n'
        name='3dprint4me/test-objects.ndjson'
        source=controller.summary_snapshot(controller.command(stores[0]+['backup','--stdin','--stdin-filename',name,'--json'],data=io.BytesIO(data),env=env))
        controller.command(stores[1]+['copy','--from-repo',str(root/'0'),'--from-password-file',str(password),source],env=env)
        copied=controller.copied_snapshot(stores[1],env,source,name)
        expected=hashlib.sha256(data).hexdigest()
        for store,snapshot in zip(stores,[source,copied]):
            if controller.stream_hash(store+['dump',snapshot,'/'+name],env)!=expected:raise ValueError('Readback mismatch')
        evidence=incremental_rehearsal(root,stores,env)
    return {'encrypted_stream_copy_readback':'passed','stores':2,'pinned_restic':'0.19.1','fixture_data':'synthetic','incremental_checkpoints':evidence}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--restic',type=Path,required=True)
    args=parser.parse_args()
    try:print(json.dumps(rehearse(args.restic)))
    except Exception:raise SystemExit('Synthetic Restic rehearsal failed; private diagnostics suppressed.')
