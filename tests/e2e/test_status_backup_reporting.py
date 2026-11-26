"""Only verified in-memory checkpoint counters enter signed status reports."""
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('status_backup', Path(__file__).parents[2] / 'deploy/platform/backup-controller.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_backup_reporting_uses_verified_result_without_reopening_objects(tmp_path, monkeypatch):
    config = tmp_path / 'private.json'
    config.write_text(json.dumps({'status_backup_secret': 's' * 64}))
    monkeypatch.setattr(backup, 'private', lambda path: None)
    monkeypatch.setattr(backup.time, 'time_ns', lambda: 1_800_000_000_000_000_000)
    requests = []

    class Response:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *args): pass

    class Opener:
        def open(self, request, timeout):
            requests.append(request)
            return Response()

    monkeypatch.setattr(backup.urllib.request, 'build_opener', lambda *args: Opener())
    result = {'roundtrip_verified': True, 'checkpoint_receipts': ['a', 'b'],
              'private_objects': {'roundtrip_verified': True, 'snapshots': ['a', 'b'],
                                  'downloadedBytes': 0, 'reusedBytes': 1234, 'downloadedObjects': 0, 'reusedObjects': 6}}
    backup.report(config, True, result=result)
    body = json.loads(requests[-1].data)
    metrics = {m['id']: m for m in body['details']['capacity']}
    assert metrics['backup-downloaded']['used'] == 0
    assert metrics['backup-reused']['used'] == 1234
    assert metrics['backup-reused-objects']['used'] == 6
    assert all(m['source'] == 'backup' and m['observedAt'] == body['observedAt'] for m in metrics.values())
    assert requests[-1].get_header('X-status-signature') == hmac.new(b's' * 64, b'/heartbeat/backup\n' + requests[-1].data, hashlib.sha256).hexdigest()
    backup.report(config, False, result=result)
    assert 'capacity' not in json.loads(requests[-1].data)['details']
    backup.report(config, True)
    assert 'capacity' not in json.loads(requests[-1].data)['details'], 'legacy callers retain truthful basic reporting'
