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
