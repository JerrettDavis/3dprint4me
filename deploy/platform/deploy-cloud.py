"""Deploy existing linked cloud projects using installed official CLIs; preview default.

Account creation, DNS ownership, private environment restoration and operations
deployment protection are explicit prerequisites, never inferred from source.
"""
import argparse
import json
import re
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
TARGETS={'storefront':'.','operator':'operator','status':'status','operations':'status/operations','partner':'partner'}


def release_environment(component,environment=None):
    chosen=environment or ('preview' if component=='partner' else 'production')
    if chosen not in ['preview','production']:raise ValueError('Unknown release environment')
    if component=='monitor' and chosen!='production':raise ValueError('Monitor supports production only')
    return chosen


def plan(component,environment=None):
    chosen=release_environment(component,environment)
    if component=='monitor':return ['wrangler','deploy','--config',str(ROOT/'status/wrangler.jsonc')]
    if component not in TARGETS:raise ValueError('Unknown component')
    return ['vercel','deploy',*(['--prod'] if chosen=='production' else ['--target','preview']),'--yes',*(['--local-config',str(ROOT/'partner/vercel.json')] if component=='partner' else []),'--cwd',str(ROOT/TARGETS[component])]


def deploy(component, apply=False, protection_verified=False, environment=None):
    chosen=release_environment(component,environment)
    args=plan(component,chosen)
    if not apply:return {'apply':False,'environment':chosen,'command':args,'prerequisites':'docs/STACK-AUTOMATION.md'}
    if component=='operations' and not protection_verified:raise ValueError('All-deployment authentication must be verified first')
    if component in TARGETS and not (ROOT/TARGETS[component]/'.vercel/project.json').is_file():raise ValueError('Link the exact existing project first')
    if component=='partner':
        try:identity=json.loads((ROOT/'partner/.vercel/project.json').read_text(encoding='utf-8'))
        except (OSError,ValueError):raise ValueError('Link the exact partner project first') from None
        if identity.get('projectName')!='3dprint4me-partners' or not re.fullmatch(r'prj_[A-Za-z0-9]+',identity.get('projectId','')) or not re.fullmatch(r'team_[A-Za-z0-9]+',identity.get('orgId','')):raise ValueError('Link the exact partner project first')
    executable=shutil.which(args[0])
    if not executable:raise ValueError('Install the official provider CLI first')
    if component=='partner':
        # Keep provider-injected toolbar scripts out of this strict static shell.
        endpoint=f"/v9/projects/{identity['projectId']}?teamId={identity['orgId']}"
        subprocess.run([executable,'api',endpoint,'--method','PATCH','--field','enablePreviewFeedback=false','--field','enableProductionFeedback=false','--silent'],cwd=ROOT/'partner',check=True,timeout=60)
    subprocess.run([executable,*args[1:]],cwd=ROOT,check=True,timeout=900)
    return {'deployed':component,'environment':chosen,'verified':False,'next':'Run the acceptance checklist in docs/STACK-AUTOMATION.md'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component',choices=[*TARGETS,'monitor'],required=True)
    parser.add_argument('--environment',choices=['preview','production'])
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--operations-protection-verified',action='store_true')
    args=parser.parse_args()
    try:print(json.dumps(deploy(args.component,args.apply,args.operations_protection_verified,args.environment)))
    except Exception:raise SystemExit('Cloud deployment failed; consult the provider locally. No credentials are accepted as arguments.')
