"""Publish outcomes only when an actual native run binds source, captures and JUnit."""
import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tests.support.partner_qa_evidence import ROOT, source_fingerprint


def finalize(junit_path,run_id,*,root=ROOT/'docs/partner-qa',current_fingerprint=source_fingerprint):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}',run_id):raise ValueError('Unsafe run ID')
    root=Path(root);junit_path=Path(junit_path);folder=root/'evidence/runs'
    start_path=folder/f'{run_id}.start.json';end_path=folder/f'{run_id}.end.json'
    start=json.loads(start_path.read_text(encoding='utf-8'));end=json.loads(end_path.read_text(encoding='utf-8'))
    for marker in [start,end]:
        if marker.get('schemaVersion')!=1 or marker.get('environment')!='native' or marker.get('runId')!=run_id:raise ValueError('Invalid native run provenance')
    if start['sourceFingerprint']!=current_fingerprint() or end['sourceFingerprintAfter']!=start['sourceFingerprint'] or end['sourceFingerprint']!=start['sourceFingerprint'] or end['sourceCommit']!=start['sourceCommit']:raise ValueError('Native run source changed')
    start_sha=hashlib.sha256(start_path.read_bytes()).hexdigest();junit_sha=hashlib.sha256(junit_path.read_bytes()).hexdigest()
    if end['startSha256']!=start_sha or end['junitSha256']!=junit_sha:raise ValueError('Native run artifact mismatch')
    cases=[]
    for test in ET.parse(junit_path).iter('testcase'):
        node=test.attrib['classname'].replace('.','/')+'.py::'+test.attrib['name']
        status='failed' if test.find('failure') is not None or test.find('error') is not None else 'blocked' if test.find('skipped') is not None else 'passed'
        cases.append({'testNodeId':node,'status':status})
    if sorted(cases,key=lambda c:c['testNodeId'])!=sorted(end['cases'],key=lambda c:c['testNodeId']):raise ValueError('Native run case artifact mismatch')
    catalog=json.loads((root/'scenarios.json').read_text(encoding='utf-8'))
    for scenario in catalog['scenarios']:scenario['status']=next((c['status'] for c in cases if c['testNodeId']==scenario['testNodeId']),'not-run')
    (root/'scenarios.json').write_text(json.dumps(catalog,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    summary={**start,'startSha256':start_sha,'endSha256':hashlib.sha256(end_path.read_bytes()).hexdigest(),'junitSha256':junit_sha,'cases':cases,'counts':{status:sum(c['status']==status for c in cases) for status in ['passed','failed','blocked']}}
    (root/'evidence/run-summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--junit',required=True);parser.add_argument('--run',required=True);args=parser.parse_args()
    summary=finalize(args.junit,args.run)
    from importlib.util import spec_from_file_location,module_from_spec
    spec=spec_from_file_location('qa_docs',ROOT/'scripts/build-partner-qa-docs.py');module=module_from_spec(spec);spec.loader.exec_module(module)
    module.render(json.loads((ROOT/'docs/partner-qa/scenarios.json').read_text(encoding='utf-8'))['scenarios']);print(json.dumps(summary['counts']))
