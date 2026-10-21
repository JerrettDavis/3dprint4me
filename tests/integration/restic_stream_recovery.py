"""Test pinned Restic streaming, copied snapshot lookup and readback on this OS.

python tests/integration/restic_stream_recovery.py --restic /private/tools/restic
Only synthetic data and temporary disposable repositories are used.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('controller',ROOT/'deploy/platform/backup-controller.py')
controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)


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
    return {'encrypted_stream_copy_readback':'passed','stores':2,'pinned_restic':'0.19.1','fixture_data':'synthetic'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--restic',type=Path,required=True)
    args=parser.parse_args()
    try:print(json.dumps(rehearse(args.restic)))
    except Exception:raise SystemExit('Synthetic Restic rehearsal failed; private diagnostics suppressed.')
