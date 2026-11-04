"""Bind native QA evidence to the source and outcomes of this actual pytest session."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
import pytest
from tests.support.partner_qa_evidence import ROOT, source_fingerprint

_state=None

def pytest_sessionstart(session):
    global _state
    run=os.environ.get('PARTNER_QA_EVIDENCE_RUN')
    if not run or session.config.option.collectonly:return
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}',run):raise pytest.UsageError('Unsafe QA run ID')
    if not session.config.option.xmlpath:raise pytest.UsageError('Evidence run requires --junitxml')
    source_fingerprint.cache_clear()
    start={'schemaVersion':1,'runId':run,'environment':'native','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sourceFingerprint':source_fingerprint()}
    folder=ROOT/'docs/partner-qa/evidence/runs';folder.mkdir(parents=True,exist_ok=True)
    path=folder/f'{run}.start.json'
    with path.open('x',encoding='utf-8') as stream:stream.write(json.dumps(start,indent=2)+'\n')
    _state={'start':start,'path':path,'cases':{}}


def pytest_runtest_logreport(report):
    if _state is None:return
    if report.when=='call' or report.failed or report.skipped:
        _state['cases'][report.nodeid.replace('\\','/')]='failed' if report.failed else 'blocked' if report.skipped else 'passed'


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session,exitstatus):
    if _state is None:return
    source_fingerprint.cache_clear();path=_state['path'];junit=Path(session.config.option.xmlpath)
    end={**_state['start'],'sourceFingerprintAfter':source_fingerprint(),'startSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'junitSha256':hashlib.sha256(junit.read_bytes()).hexdigest(),'cases':[{'testNodeId':node,'status':status} for node,status in sorted(_state['cases'].items())],'exitStatus':int(exitstatus)}
    path.with_name(path.name.replace('.start.json','.end.json')).write_text(json.dumps(end,indent=2)+'\n',encoding='utf-8')
