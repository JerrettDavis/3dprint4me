"""Remove only the verified disposable fixture, tolerating Docker --rm races."""
import json
import re
import subprocess
import time


def cleanup_partner_container(name, *, run=subprocess.run, sleep=time.sleep, attempts=30):
    assert re.fullmatch(r'3dprint4me-partner-browser-[a-f0-9]{8}', name)
    assert attempts > 0

    def command(*args):
        return run(['docker', *args], capture_output=True, text=True, timeout=15)

    def absent(result, target):
        # Match Docker's exact missing-object response, not arbitrary daemon errors.
        return result.returncode != 0 and result.stderr.strip().lower() in {
                f'error: no such object: {target}',
                f'error: no such container: {target}',
                f'error response from daemon: no such container: {target}',
                f'error response from daemon: no such object: {target}',
            }

    inspected = command('inspect', name)
    if absent(inspected, name):
        return
    if inspected.returncode:
        raise RuntimeError('Could not verify disposable partner container cleanup')
    details = json.loads(inspected.stdout)[0]
    assert details['Name'] == '/' + name
    assert details['Config']['Labels']['3dprint4me.purpose'] == 'partner-browser'
    container_id = details['Id']
    assert re.fullmatch(r'[a-f0-9]{64}', container_id)
    # The immutable ID prevents deleting a replacement that reuses the name.
    removed = command('rm', '--force', container_id)
    if removed.returncode == 0:
        return
    progress_message = f'removal of container {container_id} is already in progress'
    in_progress = removed.stderr.strip().lower() in {
        progress_message, 'error response from daemon: ' + progress_message,
    }
    if not absent(removed, container_id) and not in_progress:
        raise RuntimeError('Could not remove disposable partner container')
    # --rm may finish after stop/inspect; accept the race only after proving absence.
    for attempt in range(attempts):
        inspected = command('inspect', container_id)
        if absent(inspected, container_id):
            return
        if inspected.returncode:
            raise RuntimeError('Could not verify disposable partner container cleanup')
        if attempt + 1 < attempts:
            sleep(.1)
    raise RuntimeError('Disposable partner container did not disappear after removal')
