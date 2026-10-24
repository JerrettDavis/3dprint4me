"""Real Chromium cookies/CORS and two-partner reads against disposable PostgreSQL.

This is the first native browser slice, not all nine packet feature scenarios.
"""
import json
import os
import queue
import subprocess
import threading
import time
import signal
import uuid
from contextlib import contextmanager
from tests.support.server import ROOT, free_port, request
from tests.support.browser_harness import SiteBrowser


@contextmanager
def native_partner_workspace():
    port = free_port()
    shell_origin = f'http://127.0.0.1:{port}'
    container = '3dprint4me-partner-browser-' + uuid.uuid4().hex[:8]
    native = subprocess.Popen(['node', 'tests/support/partner-native-server.mjs'], cwd=ROOT,
                              env={**os.environ, 'PARTNER_NATIVE_BROWSER_TEST': '1', 'PARTNER_TEST_SHELL_ORIGIN': shell_origin, 'PARTNER_TEST_CONTAINER_NAME': container},
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=os.name != 'nt')
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(native.stdout.readline()), daemon=True).start()
    shell = None
    try:
        first = lines.get(timeout=150)
        fixture = json.loads(first)
        shell = subprocess.Popen(['node', 'scripts/partner-server.mjs'], cwd=ROOT,
                                 env={**os.environ, 'PARTNER_PORT': str(port), 'PARTNER_API_ORIGIN': fixture['apiOrigin']},
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if request(shell_origin)[0] == 200:
                    break
            except OSError:
                time.sleep(.08)
        else:
            raise TimeoutError('Partner static shell unavailable')
        fixture['_process'] = native
        fixture['_container'] = container
        yield shell_origin, fixture
    finally:
        if shell:
            shell.terminate()
            try:
                shell.wait(timeout=5)
            except subprocess.TimeoutExpired:
                shell.kill()
                shell.wait(timeout=5)
        if native.poll() is None:
            try:
                native.stdin.write('stop\n')
                native.stdin.flush()
                native.wait(timeout=15)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(native.pid), '/T', '/F'], capture_output=True, timeout=10)
                else:
                    os.killpg(native.pid, signal.SIGKILL)
                native.wait(timeout=5)
        # Verify exact name and label before fallback cleanup; never stop unrelated containers.
        inspected = subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, timeout=15)
        if inspected.returncode == 0:
            details = json.loads(inspected.stdout)[0]
            assert details['Name'] == '/' + container
            assert details['Config']['Labels']['3dprint4me.purpose'] == 'partner-browser'
            subprocess.run(['docker', 'rm', '--force', container], check=True, capture_output=True, timeout=15)
        elif not any(message in inspected.stderr.lower() for message in ['no such object', 'no such container']):
            raise RuntimeError('Could not verify disposable partner container cleanup')


def test_native_partner_browser_cookie_csrf_idor_and_logout():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390, 844), reduced_motion='reduce') as site:
        page = site.page
        page.goto(origin)
        page.get_by_label('Account code', exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase', exact=True).fill(fixture['password'])
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_role('heading', name='Hello, Synthetic Partner 1.').wait_for()
        cookies = site.context.cookies()
        cookie = next(c for c in cookies if c['name'] == '__Host-3dp-partner')
        assert cookie['httpOnly'] and cookie['secure'] and cookie['sameSite'] == 'Strict' and cookie['path'] == '/'
        assert '__Host-3dp-partner' not in page.evaluate('document.cookie')
        page.reload()
        page.get_by_role('heading', name='Hello, Synthetic Partner 1.').wait_for()
        result = page.evaluate('''async ({api,other})=>{
          const response=await fetch(api+'/api/partner/v1/gig?id='+other,{credentials:'include',cache:'no-store'});
          return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
        }''', {'api': fixture['apiOrigin'], 'other': fixture['otherGigId']})
        assert result['status'] == 404 and result['cache'] == 'no-store'
        assert 'Synthetic Partner 2' not in json.dumps(result['body'])
        page.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
        page.get_by_label('Display name', exact=True).fill('Synthetic browser saved')
        page.get_by_role('button', name='Save profile', exact=True).click()
        page.get_by_text('Profile saved.', exact=True).wait_for()
        page.reload()
        assert page.get_by_label('Display name', exact=True).input_value() == 'Synthetic browser saved'
        with site.browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce') as other:
            second = other.new_page()
            errors = []
            second.on('pageerror', lambda error: errors.append(str(error)))
            second.goto(origin)
            second.get_by_label('Account code', exact=True).fill(fixture['otherPartnerId'])
            second.get_by_label('Passphrase', exact=True).fill(fixture['password'])
            second.get_by_role('button', name='Sign in', exact=True).click()
            second.get_by_role('heading', name='Hello, Synthetic Partner 2.').wait_for()
            second_cookie = next(c for c in other.cookies() if c['name'] == '__Host-3dp-partner')
            assert second_cookie['value'] != cookie['value']
            denied = second.evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?id='+id,{credentials:'include'})).status", {'api': fixture['apiOrigin'], 'id': fixture['gigId']})
            assert denied == 404
            second.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
            assert second.get_by_label('Display name', exact=True).input_value() == 'Synthetic Partner 2'
            assert not errors
        page.get_by_role('button', name='Sign out', exact=True).click()
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        assert not any(c['name'] == '__Host-3dp-partner' for c in site.context.cookies())
        page.reload()
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        assert not site.page_errors


def test_native_partner_fixture_removes_its_container_after_child_crash():
    with native_partner_workspace() as (_, fixture):
        container = fixture['_container']
        inspected = subprocess.run(['docker', 'inspect', container], check=True, capture_output=True, text=True, timeout=15)
        assert json.loads(inspected.stdout)[0]['Config']['Labels']['3dprint4me.purpose'] == 'partner-browser'
        fixture['_process'].kill()
        fixture['_process'].wait(timeout=5)
    remaining = subprocess.run(['docker', 'ps', '--all', '--filter', 'name=^/' + container + '$', '--format', '{{.Names}}'], check=True, capture_output=True, text=True, timeout=15)
    assert not remaining.stdout.strip()
