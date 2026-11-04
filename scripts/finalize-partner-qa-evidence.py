"""Publish actual pytest outcomes alongside already captured, redacted evidence."""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tests.support.partner_qa_evidence import ROOT, source_fingerprint
from importlib.util import spec_from_file_location, module_from_spec
spec=spec_from_file_location('qa_docs',ROOT/'scripts/build-partner-qa-docs.py');module=module_from_spec(spec);spec.loader.exec_module(module)
parser=argparse.ArgumentParser();parser.add_argument('--junit',required=True);parser.add_argument('--run',required=True);args=parser.parse_args()
root=ROOT/'docs/partner-qa';catalog=json.loads((root/'scenarios.json').read_text(encoding='utf-8'));cases=[]
for test in ET.parse(args.junit).iter('testcase'):
    node=test.attrib['classname'].replace('.','/')+'.py::'+test.attrib['name']
    status='failed' if test.find('failure') is not None or test.find('error') is not None else 'blocked' if test.find('skipped') is not None else 'passed'
    cases.append({'testNodeId':node,'status':status})
for scenario in catalog['scenarios']:scenario['status']=next((c['status'] for c in cases if c['testNodeId']==scenario['testNodeId']),'not-run')
(root/'scenarios.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
summary={'schemaVersion':1,'runId':args.run,'environment':'native','sourceFingerprint':source_fingerprint(),'cases':cases,'counts':{status:sum(c['status']==status for c in cases) for status in ['passed','failed','blocked']}}
(root/'evidence').mkdir(exist_ok=True);(root/'evidence/run-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
module.render(catalog['scenarios']);print(json.dumps(summary['counts']))
