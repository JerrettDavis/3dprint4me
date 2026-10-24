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


GIG_ID = '30000000-1000-4000-8000-100000000001'


def install_offer_fixture(page):
    install_partner_fixture(page)
    item = {'id': GIG_ID, 'status': 'offered', 'revision': 1, 'feeCents': 1000,
            'maximumBonusCents': 0, 'terms': {'title': 'Synthetic introductions', 'area': 'Tulsa',
            'deadline': '2026-12-01', 'tasks': ['Permitted business introductions'], 'materials': []}}
    negotiations = [{'id': 'prior', 'proposed_fee_cents': 1250, 'actor_id': 'owner',
                     'message': '<img src=x onerror=alert(1)>', 'created_at': '2026-10-24T12:00:00Z'}]
    page.route('**/api/partner/v1/gig?*', lambda route: route.fulfill(status=200,
               content_type='application/json', body=json.dumps({'item': item, 'events': [], 'negotiations': negotiations})))
    return item, negotiations


def test_partner_counteroffer_exact_retry_and_inert_history():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844), color_scheme='dark', reduced_motion='reduce') as site:
        page = site.page
        item, negotiations = install_offer_fixture(page)
        pending, commands = [], []
        def command(route):
            commands.append(route.request.post_data_json)
            pending.append(route)
        page.route('**/api/partner/v1/commands', command)
        page.goto(origin + '/gigs/' + GIG_ID)
        page.get_by_label('Proposed fee (USD)', exact=True).fill('12.34')
        assert page.locator('main img').count() == 0
        assert '<img src=x onerror=alert(1)>' in page.get_by_role('region', name='Fee discussion').inner_text()
        page.get_by_label('Message to the owner', exact=True).fill('Can this cover the additional materials?')
        page.get_by_role('button', name='Send counterproposal', exact=True).click()
        page.wait_for_function('document.querySelector("#counteroffer button").disabled')
        assert page.get_by_label('Proposed fee (USD)', exact=True).is_disabled()
        assert page.get_by_role('button', name='Save decision', exact=True).is_disabled()
        assert commands[0]['action'] == 'gig.counteroffer'
        assert commands[0]['input'] == {'gigId': GIG_ID, 'expectedRevision': 1, 'proposedFeeCents': 1234,
                                        'message': 'Can this cover the additional materials?'}
        pending.pop(0).abort()
        page.get_by_text('Unable to reach the partner service. Check your connection and try again.', exact=True).wait_for()
        page.get_by_role('button', name='Send counterproposal', exact=True).click()
        page.wait_for_function('document.querySelector("#counteroffer button").disabled')
        assert len(commands) == 2 and commands[1] == commands[0]
        item['revision'] = 2
        negotiations.append({'id': 'new', 'proposed_fee_cents': 1234, 'actor_id': PARTNER['id'],
                             'message': 'Can this cover the additional materials?', 'created_at': '2026-10-24T12:01:00Z'})
        pending.pop(0).fulfill(status=200, content_type='application/json', body=json.dumps({'id': GIG_ID, 'revision': 2}))
        page.get_by_text('Counterproposal recorded. The offered fee is unchanged until the owner sends a revised offer.', exact=True).wait_for()
        assert '$10.00 offered fee' in page.locator('main').inner_text()
        assert 'You proposed $12.34' in page.get_by_role('region', name='Fee discussion').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors


def test_partner_delayed_counteroffer_does_not_replace_current_page():
    with running_partner_shell() as origin, SiteBrowser(viewport=(320, 844)) as site:
        page = site.page
        install_offer_fixture(page)
        pending = []
        page.route('**/api/partner/v1/commands', lambda route: pending.append(route))
        page.goto(origin + '/gigs/' + GIG_ID)
        page.get_by_label('Proposed fee (USD)', exact=True).fill('15.00')
        page.get_by_label('Message to the owner', exact=True).fill('A different fee request')
        page.get_by_role('button', name='Send counterproposal', exact=True).click()
        page.get_by_role('navigation').get_by_role('link', name='Help', exact=True).click()
        page.get_by_role('heading', name='Help & privacy').wait_for()
        pending[0].fulfill(status=200, content_type='application/json', body=json.dumps({'id': GIG_ID, 'revision': 2}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading', name='Help & privacy').is_visible()
        assert page.locator('#message').is_hidden()
        assert not site.page_errors


@pytest.mark.parametrize('gig_status', ['accepted', 'declined'])
def test_partner_fee_history_survives_after_offer_closes(gig_status):
    with running_partner_shell() as origin, SiteBrowser(viewport=(320,844)) as site:
        item, _ = install_offer_fixture(site.page)
        item['status'] = gig_status
        site.page.goto(origin + '/gigs/' + GIG_ID)
        site.page.get_by_role('region', name='Fee discussion').wait_for()
        assert 'Owner proposed $12.50' in site.page.get_by_role('region', name='Fee discussion').inner_text()
        assert site.page.get_by_role('button', name='Send counterproposal', exact=True).count() == 0
        assert site.page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors


def install_referral_fixture(page):
    install_partner_fixture(page)
    data={'items':[{'id':'private-referral','gigId':GIG_ID,'code':'AbCdEfGh1234_-xy','policyHash':'b'*64,
                   'bonusRules':[{'id':'sale','trigger':'verified_sale','amountCents':2000,'maximumAwards':1,
                   'criteria':'Independent settled purchase <img src=x onerror=alert(1)>','qualifiesBy':'2026-12-31',
                   'refundTreatment':'Owner reviews refunds separately.'}]}],
          'awards':[{'id':'earned-award','referralId':'private-referral','ruleId':'sale','kind':'verified_sale',
                     'amountCents':2000,'earnedAt':'2026-10-24T12:00:00Z'}], 'customerEmail':'DO-NOT-DISPLAY@example.test'}
    page.route('**/api/partner/v1/referrals',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(data)))
    return data


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_partner_referral_codes_policy_and_earned_awards_do_not_expose_customers_or_claim_payment(width,theme):
    with running_partner_shell() as origin, SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page
        install_referral_fixture(page)
        page.goto(origin+'/referrals')
        page.get_by_role('heading',name='Your referrals',exact=True).wait_for()
        text=page.locator('main').inner_text()
        assert 'AbCdEfGh1234_-xy' in text and 'b'*64 in text
        assert '$20.00 earned' in text and 'An earned award is an amount owed, not confirmation of payment.' in text
        assert 'Independent settled purchase <img src=x onerror=alert(1)>' in text
        assert 'DO-NOT-DISPLAY' not in text and page.locator('main img').count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors


def take_activity_request(page,pending):
    for _ in range(100):
        if pending:return pending.pop(0)
        page.wait_for_timeout(10)
    raise AssertionError('Activity command did not reach the service')


def activity_fixture(page):
    install_partner_fixture(page)
    record={'id':'70000000-1000-4000-8000-100000000001','startedAt':'2026-10-24T12:00:00Z','endedAt':None,'runningSince':'2026-10-24T12:00:00Z','elapsedSeconds':37,'revision':1,'optional':True}
    page.route('**/api/partner/v1/activity',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[record]})))
    return record


def test_partner_activity_lost_response_retries_same_key_and_locks_all_controls():
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;activity_fixture(page);pending=[]
        page.route('**/api/partner/v1/commands',lambda route:pending.append(route))
        page.goto(origin+'/activity')
        page.get_by_role('button',name='Pause',exact=True).click()
        assert page.get_by_role('button',name='Stop',exact=True).is_disabled()
        assert page.get_by_role('button',name='Delete record',exact=True).is_disabled()
        first=take_activity_request(page,pending);key=first.request.post_data_json['key'];first.abort('failed')
        page.get_by_role('button',name='Pause',exact=True).wait_for(state='visible')
        page.wait_for_function("()=>!document.querySelector('[data-action=pause]').disabled")
        page.get_by_role('button',name='Pause',exact=True).click()
        retry=take_activity_request(page,pending)
        assert retry.request.post_data_json['key']==key
        retry.fulfill(status=200,content_type='application/json',body='{}')
        page.get_by_text('Optional activity updated.',exact=True).wait_for()
        assert '37 saved seconds' in page.locator('main').inner_text()
        page.get_by_role('button',name='Stop',exact=True).click()
        held=take_activity_request(page,pending)
        assert page.locator('#message').is_hidden()
        held.fulfill(status=200,content_type='application/json',body='{}')


def test_partner_activity_delayed_command_preserves_navigation_and_expired_session_hides_records():
    with running_partner_shell() as origin,SiteBrowser(viewport=(320,844),color_scheme='dark') as site:
        page=site.page;activity_fixture(page);pending=[]
        page.route('**/api/partner/v1/commands',lambda route:pending.append(route))
        page.goto(origin+'/activity');page.get_by_role('button',name='Stop',exact=True).click()
        page.get_by_role('navigation').get_by_role('link',name='Help',exact=True).click()
        page.get_by_role('heading',name='Help & privacy',exact=True).wait_for()
        take_activity_request(page,pending).fulfill(status=200,content_type='application/json',body='{}')
        page.wait_for_timeout(80)
        assert page.get_by_role('heading',name='Help & privacy',exact=True).count()==1
        assert page.locator('#message').is_hidden()
        page.goto(origin+'/activity');page.get_by_role('button',name='Pause',exact=True).click()
        take_activity_request(page,pending).fulfill(status=401,content_type='application/json',body='{"error":"Sign in required"}')
        page.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        assert page.get_by_role('navigation').is_hidden()
        assert page.get_by_role('button',name='Delete record',exact=True).count()==0


def test_partner_activity_revision_conflict_requires_explicit_refresh():
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;record=activity_fixture(page)
        page.route('**/api/partner/v1/commands',lambda route:route.fulfill(status=409,content_type='application/json',body='{"error":"This optional activity record has changed."}'))
        page.goto(origin+'/activity');page.get_by_role('button',name='Pause',exact=True).click()
        page.get_by_text('This optional activity record has changed.',exact=True).wait_for()
        record.update(runningSince=None,revision=2)
        page.get_by_role('button',name='Refresh activity records',exact=True).click()
        page.get_by_role('button',name='Resume',exact=True).wait_for()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')


@pytest.mark.parametrize('width',[320,390])
def test_partner_failed_enrollment_keeps_safe_error_visible_after_auth_form_reset(width):
    with running_partner_shell() as origin,SiteBrowser(viewport=(width,844),color_scheme='dark') as site:
        page=site.page;install_partner_fixture(page,signed_in=False)
        page.route('**/api/partner/v1/invite/redeem',lambda route:route.fulfill(status=401,content_type='application/json',body='{"error":"private credential detail"}'))
        page.goto(origin+'/join');page.get_by_label('Invitation or recovery code',exact=True).fill('synthetic used code')
        page.get_by_label('Choose a passphrase',exact=True).fill('Synthetic private passphrase')
        page.get_by_role('button',name='Set passphrase and continue',exact=True).click()
        page.get_by_text('Sign-in could not be completed. Check your details or contact the owner.',exact=True).wait_for(timeout=3000)
        assert page.get_by_role('heading',name='Set up your private access',exact=True).count()==1
        assert page.get_by_label('Choose a passphrase',exact=True).input_value()==''
        assert 'private credential detail' not in page.locator('body').inner_text()
        assert page.evaluate('document.activeElement.id')=='message'
        page.keyboard.press('Tab')
        assert page.evaluate('document.activeElement.name')=='account'
        assert page.evaluate("()=>{const m=document.querySelector('#message').getBoundingClientRect(),b=document.querySelector('main form button').getBoundingClientRect();return m.bottom<=b.top||m.top>=b.bottom||m.right<=b.left||m.left>=b.right;}"),'Error notice must not cover the retry control'


@pytest.mark.parametrize('view,button',[('profile','Download data copy'),('earnings','Download statement CSV')])
def test_partner_late_export_failure_preserves_current_page_and_focus(view,button):
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_partner_fixture(page);pending=[]
        totals={key:0 for key in ['committedCents','submittedCents','earnedBonusCents','contingentBonusCents','outstandingCents','paidCents','disputedCents']}
        page.route('**/api/partner/v1/earnings',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[],'totals':totals})))
        page.route('**/api/partner/v1/commands',lambda route:pending.append(route))
        page.goto(origin+'/'+view)
        control=page.get_by_role('button',name=button,exact=True)
        control.evaluate('(element)=>window.__heldExportControl=element')
        control.click();held=take_activity_request(page,pending)
        page.get_by_role('navigation').get_by_role('link',name='Help',exact=True).click()
        page.get_by_role('heading',name='Help & privacy',exact=True).wait_for()
        held.fulfill(status=503,content_type='application/json',body='{"error":"Temporarily unavailable"}')
        page.wait_for_function('()=>!window.__heldExportControl.disabled')
        assert page.get_by_role('heading',name='Help & privacy',exact=True).count()==1
        assert page.locator('#message').is_hidden()
        assert page.evaluate('document.activeElement.id')=='main'

@pytest.mark.parametrize('view,button',[('profile','Download data copy'),('earnings','Download statement CSV')])
def test_partner_export_expired_session_removes_private_view(view,button):
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_partner_fixture(page)
        totals={key:0 for key in ['committedCents','submittedCents','earnedBonusCents','contingentBonusCents','outstandingCents','paidCents','disputedCents']}
        page.route('**/api/partner/v1/earnings',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[],'totals':totals})))
        page.route('**/api/partner/v1/commands',lambda route:route.fulfill(status=401,content_type='application/json',body='{"error":"Sign in required"}'))
        page.goto(origin+'/'+view);page.get_by_role('button',name=button,exact=True).click()
        page.get_by_text('Your session has ended. Sign in again.',exact=True).wait_for()
        assert page.get_by_role('heading',name='Your work. Your records.',exact=True).count()==1
        assert page.get_by_role('navigation').is_hidden()
        assert page.get_by_role('button',name=button,exact=True).count()==0
        assert 'Synthetic Partner' not in page.locator('main').inner_text()
        assert page.evaluate('document.activeElement.id')=='message'
