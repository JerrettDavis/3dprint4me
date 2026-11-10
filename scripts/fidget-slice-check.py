"""Slice generated fidget fixtures in an isolated Bambu CLI profile.

Run fidget-evidence.mjs first. Windows CLI location can be supplied with --binary.
Official options: github.com/bambulab/BambuStudio/wiki/Command-Line-Usage
No user session settings, files or printer connections are used.
"""
import argparse
import json
import os
import subprocess
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--binary',default='C:/Program Files/Bambu Studio/bambu-studio.exe')
parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parents[1]/'screenshots/fidget-evidence')
parser.add_argument('--only',choices=['classic','knurled','honeycomb','rectangular','spheres','triangle','fit-sample','pixel-face','letters'])
args=parser.parse_args()
root=args.directory.resolve()
reports=[]
summary=root/('slicing-summary-'+args.only+'.json' if args.only else 'slicing-summary.json')
for name in ([args.only] if args.only else ['classic','knurled','honeycomb','rectangular','spheres','triangle','fit-sample','pixel-face','letters']):
    out=root/(name+'-verified-slice')
    out.mkdir(exist_ok=True)
    env=os.environ.copy()
    env['APPDATA']=str(out/'appdata')
    env['LOCALAPPDATA']=str(out/'localappdata')
    command=[args.binary,'--slice','0','--arrange','0','--orient','0','--debug','2','--outputdir',str(out),str(root/(name+'.3mf'))]
    with (out/'slicer.log').open('wb') as log:
        try:
            child=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=180,env=env,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except subprocess.TimeoutExpired:
            reports.append({'name':name,'exit':'timeout','return':None,'warnings':['Slicer did not exit within 180 seconds.']})
            summary.write_text(json.dumps(reports,indent=2))
            print(json.dumps(reports[-1]),flush=True)
            continue
    result=json.loads((out/'result.json').read_text())
    reports.append({'name':name,'exit':child.returncode,'return':result['return_code'],'warnings':[p.get('warning_message','') for p in result.get('sliced_plates',[])]})
    print(json.dumps(reports[-1]),flush=True)
    summary.write_text(json.dumps(reports,indent=2))
summary.write_text(json.dumps(reports,indent=2))
if any(p['exit'] or p['return'] or any(p['warnings']) for p in reports):
    raise SystemExit(1)
