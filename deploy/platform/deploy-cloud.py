"""Deploy existing linked cloud projects using installed official CLIs; preview default.

Account creation, DNS ownership, private environment restoration and operations
deployment protection are explicit prerequisites, never inferred from source.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[2]
TARGETS={'storefront':'.','operator':'operator','status':'status','operations':'status/operations'}


def plan(component):
    if component=='monitor':return ['wrangler','deploy','--config',str(ROOT/'status/wrangler.jsonc')]
    if component not in TARGETS:raise ValueError('Unknown component')
    return ['vercel','deploy','--prod','--yes','--cwd',str(ROOT/TARGETS[component])]


def deploy(component, apply=False, protection_verified=False):
    args=plan(component)
    if not apply:return {'apply':False,'command':args,'prerequisites':'docs/STACK-AUTOMATION.md'}
    if component=='operations' and not protection_verified:raise ValueError('All-deployment authentication must be verified first')
    if component in TARGETS and not (ROOT/TARGETS[component]/'.vercel/project.json').is_file():raise ValueError('Link the exact existing project first')
    executable=shutil.which(args[0])
    if not executable:raise ValueError('Install the official provider CLI first')
    subprocess.run([executable,*args[1:]],cwd=ROOT,check=True,timeout=900)
    return {'deployed':component,'verified':False,'next':'Run the acceptance checklist in docs/STACK-AUTOMATION.md'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component',choices=[*TARGETS,'monitor'],required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--operations-protection-verified',action='store_true')
    args=parser.parse_args()
    try:print(json.dumps(deploy(args.component,args.apply,args.operations_protection_verified)))
    except Exception:raise SystemExit('Cloud deployment failed; consult the provider locally. No credentials are accepted as arguments.')
