"""Owner presentation fixtures; real GitHub-bound native authorization is separate."""
import json
import pytest
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser

PROGRAM='40000000-1000-4000-8000-100000000001'

def install_owner_fixture(page, *, allowed=True):
    commands=[]
    program={'id':PROGRAM,'label':'Synthetic outreach','enabled':False,'revision':1,
             'default_weekly_cap_cents':20000,'starts_on':'2026-10-01','ends_on':'2026-12-31',
             'settings':{},'clearance':{'allowed':False,'missing':['published_agreement','owner_activation']}}
    def handle(route):
        request=route.request
        if not allowed:
            route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':'Owner access is required.'}));return
        if request.method=='POST':
            assert request.headers['x-csrf-token']=='owner-memory-only'
            command=request.post_data_json;commands.append(command)
            if command['action']=='program.configure':
                program['default_weekly_cap_cents']=command['input']['weeklyCapCents'];program['enabled']=command['input']['enabled'];program['revision']+=1
            result={'id':'synthetic-result','revision':program['revision']}
        else:
            from urllib.parse import urlparse,parse_qs
            resource=parse_qs(urlparse(request.url).query).get('resource',['programs'])[0]
            result={'owner':{'id':'owner'},'csrfToken':'owner-memory-only'} if resource=='session' else {'items':[program] if resource=='programs' else [],'csrfToken':'owner-memory-only'}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands,program

@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_owner_program_gate_and_revisioned_pause_cap_controls(width,theme):
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;commands,program=install_owner_fixture(page)
        page.goto(origin+'/partners')
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        assert 'New work unavailable' in page.locator('#partner-clearance').inner_text()
        assert 'Published agreement' in page.locator('#partner-clearance').inner_text()
        page.get_by_label('Default weekly authorization (USD)',exact=True).fill('175.25')
        page.get_by_role('button',name='Save program controls',exact=True).click()
        page.get_by_text('Program controls saved.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'expectedRevision':1,'enabled':False,'weeklyCapCents':17525}
        assert program['default_weekly_cap_cents']==17525
        assert 'Existing commitments and earned obligations are unchanged.' in page.locator('#partner-clearance').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert 'owner-memory-only' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert not site.page_errors

def test_operator_without_owner_access_gets_no_partner_controls():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        install_owner_fixture(site.page,allowed=False)
        site.page.goto(origin+'/partners')
        site.page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert site.page.locator('main form').count()==0
        assert site.page.locator('#partner-navigation').is_hidden()
        assert 'Synthetic outreach' not in site.page.locator('body').inner_text()
        assert not site.page_errors


def test_owner_campaign_reserves_every_bonus_and_retries_exactly_without_navigating_back():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_owner_fixture(page)
        page.goto(origin+'/partners#campaigns')
        page.get_by_role('heading',name='Campaigns',exact=True).wait_for()
        page.get_by_label('Offer title',exact=True).fill('Synthetic compensated introductions')
        page.get_by_label('Offered fee (USD)',exact=True).fill('40.00')
        page.get_by_label('Permitted area',exact=True).fill('Tulsa permitted business areas')
        page.get_by_label('Completion deadline',exact=True).fill('2026-12-01')
        page.get_by_label('Objective tasks (one per line)',exact=True).fill('Ask permission before leaving materials\nRecord consenting business introductions')
        page.get_by_role('button',name='Add conditional bonus',exact=True).click()
        page.get_by_role('combobox',name='Qualifying event',exact=True).select_option('verified_sale')
        page.get_by_label('Bonus per award (USD)',exact=True).fill('20.00')
        page.get_by_label('Maximum awards',exact=True).fill('2')
        page.get_by_label('Objective qualification criteria',exact=True).fill('Independent fully settled sale with verified customer permission.')
        page.get_by_label('Qualify by (Central date)',exact=True).fill('2026-12-31')
        page.get_by_label('Refund treatment for a paid-sale bonus',exact=True).fill('Owner verifies refunds separately; no automatic clawback.')
        assert '$80.00' in page.locator('[data-reservation]').inner_text()
        pending=[];commands=[]
        def handle(route):
            if route.request.method=='POST':
                commands.append(route.request.post_data_json);pending.append(route)
            else:
                route.fallback()
        page.route('**/api/operator-partners*',handle)
        page.get_by_role('button',name='Create campaign draft',exact=True).click()
        page.wait_for_function('document.querySelector("#campaign-create button.primary").disabled')
        assert page.get_by_label('Offer title',exact=True).is_disabled()
        assert commands[0]['input']['terms']['feeCents']==4000
        assert commands[0]['input']['terms']['maximumBonusCents']==4000
        assert commands[0]['input']['terms']['bonusRules'][0]['maximumAwards']==2
        pending.pop().abort()
        page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        page.get_by_role('button',name='Create campaign draft',exact=True).click()
        page.wait_for_function('document.querySelector("#campaign-create button.primary").disabled')
        assert commands[1]==commands[0]
        page.get_by_role('navigation').get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        pending.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'id':'created'}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading',name='Partner audit',exact=True).is_visible()
        assert page.locator('#owner-message').is_hidden()
        assert not site.page_errors


def test_owner_authorization_loss_clears_private_forms_and_banner():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_owner_fixture(page)
        page.goto(origin+'/partners')
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        def denied(route):
            if route.request.method=='POST':route.fulfill(status=403,body='Access ended')
            else:route.fallback()
        page.route('**/api/operator-partners*',denied)
        page.get_by_role('button',name='Save program controls',exact=True).click()
        page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert 'Synthetic outreach' not in page.locator('body').inner_text()
        assert page.locator('main form').count()==0
        assert page.locator('#partner-clearance').is_hidden()
        assert page.locator('#partner-navigation').is_hidden()
        assert not site.page_errors


def test_owner_skip_link_focus_preserves_unsaved_program_controls():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_owner_fixture(page);page.goto(origin+'/partners')
        page.get_by_label('Default weekly authorization (USD)',exact=True).fill('123.45')
        page.locator('.skip-link').focus();page.keyboard.press('Enter')
        assert page.evaluate('location.hash')==''
        assert page.get_by_label('Default weekly authorization (USD)',exact=True).input_value()=='123.45'
        assert page.evaluate('document.activeElement.id')=='owner-content'
        assert not site.page_errors


ACCOUNT='50000000-1000-4000-8000-100000000001'
ACCESS_TOKEN='v'*43

def install_access_fixture(page, *, status='active', cleared=False):
    _,program=install_owner_fixture(page)
    program['clearance']={'allowed':cleared,'missing':[] if cleared else ['owner_activation']}
    account={'id':ACCOUNT,'program_id':PROGRAM,'display_name':'Synthetic Access Partner','status':status,'revision':1,'profile':{}}
    commands=[]
    def handle(route):
        from urllib.parse import urlparse,parse_qs
        if route.request.method=='POST':
            command=route.request.post_data_json;commands.append(command)
            if command['action']=='partner.invite':
                from datetime import datetime,timedelta,timezone
                result={'token':ACCESS_TOKEN,'partnerId':ACCOUNT,'purpose':command['input']['purpose'],'expiresAt':(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()}
            elif command['action']=='partner.revoke':
                account['status']=command['input']['status'];result={'ok':True}
            else:route.fallback();return
            route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
        elif parse_qs(urlparse(route.request.url).query).get('resource')==['partners']:
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[account]}))
        else:route.fallback()
    page.route('**/api/operator-partners*',handle)
    return commands,account


def test_owner_recovery_code_is_masked_ephemeral_and_never_in_storage_or_url():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;commands,_=install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        code=page.get_by_label('One-time recovery code',exact=True)
        code.wait_for()
        assert code.get_attribute('type')=='password' and code.input_value()==ACCESS_TOKEN
        assert commands[-1]['input']=={'partnerId':ACCOUNT,'purpose':'recover'}
        assert ACCESS_TOKEN not in page.url
        assert ACCESS_TOKEN not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        page.get_by_role('button',name='Reveal code',exact=True).click()
        assert code.get_attribute('type')=='text'
        page.get_by_role('button',name='Hide and clear code',exact=True).click()
        assert page.get_by_label('One-time recovery code',exact=True).count()==0
        assert ACCESS_TOKEN not in page.locator('body').inner_text()
        assert not page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).is_checked()
        assert not site.page_errors


def test_owner_unknown_invitation_result_requires_new_confirmation_and_late_secret_is_not_rendered():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(320,844)) as site:
        page=site.page;install_access_fixture(page)
        pending=[]
        def hold(route):
            if route.request.method=='POST':pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',hold)
        page.goto(origin+'/partners#partners')
        confirm=page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True)
        confirm.check();page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.wait_for_function('document.querySelector("[data-access-issue] button").disabled')
        pending.pop().abort()
        page.get_by_text('The code response was not received. Recheck identity before issuing a replacement; any previous code may already be invalid.',exact=True).wait_for()
        assert not confirm.is_checked()
        # A replacement is a deliberate new issue, not a blind idempotent retry.
        confirm.check();page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.wait_for_function('document.querySelector("[data-access-issue] button").disabled')
        page.get_by_role('navigation').get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        from datetime import datetime,timedelta,timezone
        pending.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'token':ACCESS_TOKEN,'partnerId':ACCOUNT,'purpose':'recover','expiresAt':(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()}))
        page.wait_for_timeout(100)
        assert page.get_by_label('One-time recovery code',exact=True).count()==0
        assert page.get_by_role('heading',name='Partner audit',exact=True).is_visible()
        assert not site.page_errors


def test_owner_suspension_and_revocation_are_explicit_and_preserve_obligation_copy():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands,_=install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        page.get_by_role('combobox',name='Access change',exact=True).select_option('suspended')
        page.get_by_label('I understand that this ends access and invalidates unused codes without changing amounts owed.',exact=True).check()
        page.get_by_role('button',name='Apply access change',exact=True).click()
        page.get_by_text('Portal access suspended. Existing obligations are unchanged.',exact=True).wait_for()
        assert commands[-1]['input']=={'partnerId':ACCOUNT,'status':'suspended'}
        assert page.get_by_role('button',name='Issue recovery code',exact=True).is_visible()
        page.get_by_role('combobox',name='Access change',exact=True).select_option('revoked')
        page.get_by_label('I understand that this ends access and invalidates unused codes without changing amounts owed.',exact=True).check()
        page.get_by_role('button',name='Apply access change',exact=True).click()
        page.get_by_text('Portal access revoked. Existing obligations are unchanged.',exact=True).wait_for()
        assert page.get_by_role('button',name='Issue recovery code',exact=True).count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors


def test_owner_enrollment_is_hidden_until_program_clearance():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_access_fixture(page,status='invited')
        page.goto(origin+'/partners#partners')
        page.get_by_role('heading',name='Partner accounts',exact=True).wait_for()
        assert page.get_by_role('button',name='Issue enrollment code',exact=True).count()==0
        assert 'Enrollment is unavailable until program clearance is complete.' in page.locator('main').inner_text()
        assert not site.page_errors


def test_owner_access_issuance_denial_clears_private_account_view():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        def deny(route):
            if route.request.method=='POST':route.fulfill(status=403,body='No access')
            else:route.fallback()
        page.route('**/api/operator-partners*',deny)
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert 'Synthetic Access Partner' not in page.locator('body').inner_text()
        assert page.locator('main form').count()==0
        assert not site.page_errors


def test_owner_code_response_after_page_hiding_never_becomes_visible():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_access_fixture(page);pending=[]
        def hold(route):
            if route.request.method=='POST':pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',hold);page.goto(origin+'/partners#partners')
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.wait_for_function('document.querySelector("[data-access-issue] button").disabled')
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
        from datetime import datetime,timedelta,timezone
        pending.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'token':ACCESS_TOKEN,'partnerId':ACCOUNT,'purpose':'recover','expiresAt':(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()}))
        page.wait_for_timeout(100)
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))")
        assert page.get_by_label('One-time recovery code',exact=True).count()==0
        assert not site.page_errors


def test_owner_visible_code_expires_and_is_cleared_when_leaving_accounts():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_access_fixture(page);page.goto(origin+'/partners#partners')
        page.get_by_role('heading',name='Partner accounts',exact=True).wait_for()
        page.clock.install()
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.get_by_label('One-time recovery code',exact=True).wait_for()
        page.clock.fast_forward(31*60*1000)
        assert page.get_by_label('One-time recovery code',exact=True).count()==0
        page.get_by_role('link',name='Programs',exact=True).click()
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        assert ACCESS_TOKEN not in page.locator('body').inner_text()
        assert not site.page_errors
