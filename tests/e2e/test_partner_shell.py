"""Browser presentation/client contracts with explicit synthetic API fixtures.

Real session cookies, native persistence and packet BDD remain separate release gates.
"""
import json
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.partner_harness import running_partner_shell

PARTNER = {'id': '10000000-1000-4000-8000-100000000001', 'displayName': 'Synthetic Partner'}
ISSUE = {'id': '20000000-1000-4000-8000-100000000001', 'snapshot_sha256': 'a' * 64,
         'snapshot_markdown': '# Issued synthetic text\n<img src=x onerror=alert(1)>', 'issued_at': '2026-10-24T12:00:00Z'}


def install_partner_fixture(page, *, signed_in=True):
    commands = []
    state = {'signed_in': signed_in}

    def respond(route):
        path = route.request.url.split('/api/partner/v1/')[1]
        code, body = 200, {}
        if path == 'session':
            if state['signed_in']:
                body = {'partner': PARTNER, 'csrfToken': 'synthetic-memory-only'}
            else:
                code, body = 401, {'error': 'Sign in required'}
        elif path in ['login', 'invite/redeem']:
            state['signed_in'] = True
            body = {'partner': PARTNER, 'csrfToken': 'synthetic-memory-only'}
        elif path == 'logout':
            state['signed_in'] = False
        elif path == 'profile':
            body = {'item': {'id': PARTNER['id'], 'display_name': PARTNER['displayName'], 'revision': 1, 'profile': {}},
                    'program': {'newWorkAvailable': False}}
        elif path == 'agreements':
            body = {'items': [ISSUE]}
        elif path == 'gigs':
            body = {'items': []}
        elif path == 'commands':
            assert route.request.headers.get('x-csrf-token') == 'synthetic-memory-only'
            command = route.request.post_data_json
            assert command['key']
            commands.append(command)
            body = {'id': 'synthetic-receipt'}
        route.fulfill(status=code, content_type='application/json', body=json.dumps(body))

    page.route('**/api/partner/v1/**', respond)
    return commands


@pytest.mark.parametrize('width,theme', [(320, 'light'), (390, 'dark'), (1440, 'light')])
def test_partner_private_sign_in_and_navigation_layout(width, theme):
    with running_partner_shell() as origin, SiteBrowser(viewport=(width, 844), color_scheme=theme, reduced_motion='reduce') as site:
        page = site.page
        install_partner_fixture(page, signed_in=False)
        page.goto(origin)
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        page.get_by_label('Account code', exact=True).fill(PARTNER['id'])
        page.get_by_label('Passphrase', exact=True).fill('synthetic passphrase private')
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_role('heading', name='Hello, Synthetic Partner.').wait_for()
        assert 'New work is currently unavailable' in page.locator('main').inner_text()
        page.get_by_role('navigation').get_by_role('link', name='Gigs', exact=True).click()
        page.get_by_role('heading', name='No offers yet').wait_for()
        page.get_by_label('Theme', exact=True).select_option('dark')
        assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert 'synthetic-memory-only' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.locator('input[type=password]').count() == 0
        page.get_by_role('button', name='Sign out', exact=True).click()
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        assert page.get_by_role('navigation').is_hidden()
        # Chromium reports the intentional anonymous-session 401 as a resource error.
        site.console = [e for e in site.console if 'status of 401 (Unauthorized)' not in e.text]
        site.assert_no_page_errors()


def test_partner_issued_text_is_inert_and_acknowledgment_uses_exact_hash():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        commands = install_partner_fixture(page)
        page.goto(origin + '/agreements')
        page.get_by_role('heading', name='Your agreements').wait_for()
        assert '<img src=x onerror=alert(1)>' in page.locator('.document').inner_text()
        assert page.locator('main img').count() == 0
        page.get_by_label('I have read this exact issued version.').check()
        page.get_by_role('button', name='Record read acknowledgment').click()
        page.get_by_text('Read acknowledgment recorded.', exact=True).wait_for()
        assert commands[-1]['input'] == {'issueId': ISSUE['id'], 'snapshotHash': ISSUE['snapshot_sha256'], 'readAcknowledgment': True}
        site.assert_no_page_errors()


def test_partner_skip_link_preserves_unsaved_profile_edits():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        install_partner_fixture(page)
        page.goto(origin + '/profile')
        page.get_by_label('Display name', exact=True).fill('Unsaved synthetic edit')
        page.locator('.skip').focus()
        page.keyboard.press('Enter')
        assert page.get_by_label('Display name', exact=True).input_value() == 'Unsaved synthetic edit'
        assert page.evaluate('document.activeElement.id') == 'main'
        site.assert_no_page_errors()


def test_partner_delayed_auth_does_not_replace_help_or_touch_removed_form():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844)) as site:
        page = site.page
        install_partner_fixture(page, signed_in=False)
        pending = []
        page.route('**/api/partner/v1/login', lambda route: pending.append(route))
        page.goto(origin)
        page.get_by_label('Account code', exact=True).fill(PARTNER['id'])
        page.get_by_label('Passphrase', exact=True).fill('synthetic passphrase private')
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.locator('main').get_by_role('link', name='Help & privacy', exact=True).click()
        page.get_by_role('heading', name='Help & privacy').wait_for()
        assert len(pending) == 1
        pending[0].fulfill(status=200, content_type='application/json', body=json.dumps({'partner': PARTNER, 'csrfToken': 'synthetic-memory-only'}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading', name='Help & privacy').is_visible()
        assert page.locator('input[type=password]').count() == 0
        site.console = [e for e in site.console if 'status of 401 (Unauthorized)' not in e.text]
        site.assert_no_page_errors()
