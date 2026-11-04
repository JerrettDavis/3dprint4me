import importlib.util
import json
import hashlib
from pathlib import Path
from types import SimpleNamespace
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support import partner_qa_evidence as evidence


def test_canonical_form_edit_changes_the_evidence_fingerprint(tmp_path):
    folder=tmp_path/'contracts/partner';folder.mkdir(parents=True);form=folder/'sample.md';form.write_text('# DRAFT one',encoding='utf-8')
    before=evidence.source_fingerprint(tmp_path)
    form.write_text('# DRAFT two',encoding='utf-8');evidence.source_fingerprint.cache_clear()
    assert before!=evidence.source_fingerprint(tmp_path)


def test_capture_failure_still_closes_every_browser_resource(monkeypatch):
    site=SiteBrowser();closed=[]
    site.context=SimpleNamespace(close=lambda:closed.append('context'));site.browser=SimpleNamespace(close=lambda:closed.append('browser'));site._playwright=SimpleNamespace(stop=lambda:closed.append('playwright'))
    monkeypatch.setenv('PARTNER_QA_EVIDENCE_RUN','synthetic-cleanup-test')
    def fail(_):raise RuntimeError('expected capture failure')
    monkeypatch.setattr(evidence,'capture_final_partner_state',fail)
    with pytest.raises(RuntimeError,match='expected capture failure'):site.__exit__(None,None,None)
    assert closed==['context','browser','playwright']


def test_capture_theme_supports_a_theme_button_and_theme_select():
    with SiteBrowser() as site:
        site.page.set_content('<button id="theme">Theme</button>')
        evidence.set_capture_theme(site.page,'dark')
        assert site.page.locator('button').inner_text()=='Theme'
        site.page.set_content('<select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select>')
        evidence.set_capture_theme(site.page,'dark')
        assert site.page.locator('select').input_value()=='dark'


def test_finalizer_rejects_missing_stale_or_mismatched_native_run_provenance(tmp_path):
    root=Path(__file__).resolve().parents[2];spec=importlib.util.spec_from_file_location('finalizer',root/'scripts/finalize-partner-qa-evidence.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    run='native-test';fingerprint='a'*64;node='tests/integration/test_example.py::test_one'
    junit=tmp_path/'results.xml';junit.write_text('<testsuite><testcase classname="tests.integration.test_example" name="test_one"/></testsuite>',encoding='utf-8')
    docs=tmp_path/'docs';(docs/'evidence/runs').mkdir(parents=True);(docs/'scenarios.json').write_text(json.dumps({'scenarios':[{'id':'QA-001','testNodeId':node}]}))
    with pytest.raises((ValueError,FileNotFoundError)):module.finalize(junit,run,root=docs,current_fingerprint=lambda:fingerprint)
    start={'schemaVersion':1,'runId':run,'environment':'native','sourceCommit':'b'*40,'sourceFingerprint':fingerprint}
    start_path=docs/'evidence/runs'/f'{run}.start.json';start_path.write_text(json.dumps(start))
    end={**start,'sourceFingerprintAfter':fingerprint,'startSha256':hashlib.sha256(start_path.read_bytes()).hexdigest(),'junitSha256':hashlib.sha256(junit.read_bytes()).hexdigest(),'cases':[{'testNodeId':node,'status':'passed'}],'exitStatus':0}
    end_path=docs/'evidence/runs'/f'{run}.end.json';end_path.write_text(json.dumps(end))
    with pytest.raises(ValueError,match='source'):module.finalize(junit,run,root=docs,current_fingerprint=lambda:'c'*64)
    summary=module.finalize(junit,run,root=docs,current_fingerprint=lambda:fingerprint);assert summary['counts']['passed']==1
    junit.write_text(junit.read_text()+' ')
    with pytest.raises(ValueError,match='artifact'):module.finalize(junit,run,root=docs,current_fingerprint=lambda:fingerprint)


def test_document_inventory_retains_every_explicit_capture_checkpoint():
    import ast
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('qa_docs_checkpoint_test',root/'scripts/build-partner-qa-docs.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tree=ast.parse((root/'tests/integration/test_partner_qa_browser.py').read_text(encoding='utf-8-sig'))
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef))
    steps=module.explicit_evidence_steps(fn)
    assert len(steps)==12
    assert {'owner-entry','sale-simulated','session-denied'}<=set(steps)
