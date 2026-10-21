"""Generate owner-readable systemd units for review; never invokes sudo."""
import argparse
import json
from pathlib import Path, PurePosixPath
import re


def units(root,user):
    root=PurePosixPath(root)
    if not root.is_absolute() or not re.fullmatch(r'/[A-Za-z0-9_./-]+',str(root)) or '..' in root.parts or not re.fullmatch('[a-z_][a-z0-9_-]{0,31}',user):raise ValueError('Literal absolute root and Linux user required')
    here=Path(__file__).resolve().parent
    service=(here/'status-collector.service.example').read_text().replace('REPLACE_PLATFORM_USER',user).replace('REPLACE_PLATFORM_ROOT',str(root)).replace('/status.private.json','/status-collector.private.json')
    return {'3dprint4me-status.service':service,'3dprint4me-status.timer':(here/'status-collector.timer').read_text()}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=PurePosixPath,required=True)
    parser.add_argument('--user',required=True)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    try:
        result=units(args.root,args.user)
        if args.output:
            args.output.mkdir(parents=True,exist_ok=True)
            for name,value in result.items():
                with (args.output/name).open('x',encoding='utf-8',newline='\n') as file:file.write(value)
            print(json.dumps({'generated':list(result),'installed':False}))
        else:print(json.dumps(result))
    except Exception:raise SystemExit('Timer generation failed; existing files are never overwritten.')
