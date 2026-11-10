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


def test_host_preflight_uses_the_verified_release_compose_path():
    source=(Path(__file__).resolve().parents[2]/'deploy/platform/partner-qa-host.py').read_text(encoding='utf-8')
    assert "str(source/'deploy/platform/compose.yml')" in source
    assert "ROOT/'source/deploy/platform/compose.yml'" not in source


def test_existing_nonnull_cluster_identity_is_not_reinserted_on_upgrade():
    source=(Path(__file__).resolve().parents[2]/'deploy/platform/partner-qa-host.py').read_text(encoding='utf-8')
    assert "INSERT INTO partner_qa_identity(singleton,realm) SELECT true,'qa' WHERE NOT EXISTS" in source
    assert "INSERT INTO partner_qa_identity VALUES" not in source


def test_host_inventory_reads_the_export_once_without_guard_references():
    root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('qa_inventory',root/'deploy/platform/partner-qa-host.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    names=module.migration_inventory((root/'scripts/migrate-neon.mjs').read_text(encoding='utf-8'))
    assert len(names)==18 and len(set(names))==18
    assert names[-1]=='018_supply_ledger.sql'
