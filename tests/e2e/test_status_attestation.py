import importlib.util
import json
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('status_attest',Path(__file__).parents[2]/'deploy/platform/status-capacity-attest.py')


def module():
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def test_attestation_is_manual_dated_and_does_not_resend_control_claims(tmp_path,monkeypatch):
    attest=module();monkeypatch.setattr(attest,'private',lambda p:None)
    config=tmp_path/'keys.json';config.write_text(json.dumps({'STATUS_CONTROL_SECRET':'s'*64}))
    readings=tmp_path/'readings.json';now=1800000000000
    records=[{'id':'blob-transfer','used':75,'limit':100,'source':'manual','scope':'account','observedAt':now,'limitSource':'manual','limitVerifiedAt':now,'periodStart':None,'periodEnd':None}]
    readings.write_text(json.dumps(records))
    bodies=[]
    monkeypatch.setattr(attest,'send',lambda body,secret:bodies.append((body,secret)))
    attest.attest(config,readings,now=now)
    assert set(bodies[0][0]['details'])=={'capacity'}
    assert bodies[0][0]['details']['capacity'][0]['source']=='manual'
    assert bodies[0][1]=='s'*64
    for bad in [{**records[0],'source':'provider'},{**records[0],'observedAt':now-86400001},{**records[0],'limitVerifiedAt':None}]:
        readings.write_text(json.dumps([bad]))
        with pytest.raises(ValueError):attest.attest(config,readings,now=now)
    assert len(bodies)==1
