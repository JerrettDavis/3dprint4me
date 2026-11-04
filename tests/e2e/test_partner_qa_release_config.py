import importlib.util
from pathlib import Path


def test_qa_upgrade_updates_only_release_image_and_preserves_private_credentials(tmp_path):
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('qa_host',root/'deploy/platform/partner-qa-host.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    state=tmp_path/'state.private.json';state.write_bytes(b'{"private":"unchanged-test-placeholder"}');state.chmod(0o600)
    module.configure_qa_release(tmp_path,'sha256:'+'a'*64)
    module.configure_qa_release(tmp_path,'sha256:'+'b'*64)
    assert 'PARTNER_QA_API_IMAGE=sha256:'+'b'*64 in (tmp_path/'compose.env').read_text()
    assert 'sha256:'+'a'*64 not in (tmp_path/'compose.env').read_text()
    assert state.read_bytes()==b'{"private":"unchanged-test-placeholder"}'
