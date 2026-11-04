"""Task navigation and deliberate administrative actions."""
import pytest
from tests.e2e.test_partner_owner import install_owner_fixture, install_access_fixture
from tests.e2e.test_partner_owner_finance import install_finance_fixture
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser


def test_owner_mobile_menu_navigates_with_parent_state_and_focus():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_finance_fixture(page)
        page.goto(origin+'/partners#campaigns')
        page.get_by_role('heading',name='Campaigns',exact=True).wait_for()
        toggle=page.get_by_role('button',name='Workspace menu',exact=False)
        assert toggle.get_attribute('aria-expanded')=='false'
        assert page.locator('#partner-navigation').is_hidden()
        toggle.click()
        page.get_by_role('link',name='Finance',exact=True).click()
        page.wait_for_function("location.hash === '#finance'")
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        assert toggle.get_attribute('aria-expanded')=='false'
        assert page.title()=='Partner finance · Administration · 3dprint4.me'
        assert page.evaluate("document.activeElement.id === 'owner-content'")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_accounts_and_payments_begin_as_review_not_mutation_forms():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(1440,900)) as site:
        page=site.page;install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        page.get_by_role('heading',name='Partner accounts',exact=True).wait_for()
        assert page.locator('[data-partner-access] form').first.is_hidden()
        page.get_by_text('Manage private access',exact=True).first.click()
        assert page.locator('[data-partner-access] form').first.is_visible()
        assert page.get_by_role('button',name='Create account',exact=True).is_hidden()
        page.get_by_text('Create an invited account',exact=True).click()
        assert page.get_by_role('button',name='Create account',exact=True).is_visible()
        install_finance_fixture(page);page.goto(origin+'/partners#finance')
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        assert page.locator('[data-payment]').is_hidden()
        assert '$30.00' in page.locator('[data-payable]').inner_text()
        page.get_by_text('Record a settled payment',exact=True).click()
        assert page.locator('[data-payment]').is_visible()
        assert page.get_by_label('I independently verified that this payment actually settled.',exact=True).is_visible()

def test_owner_finance_detail_keeps_parent_and_browser_back_focus():
    from tests.e2e.test_partner_owner_finance import BATCH
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_finance_fixture(page)
        page.goto(origin+'/partners#finance/export/'+BATCH)
        page.get_by_role('heading',name='Accounting export',exact=True).wait_for()
        page.locator('#owner-menu').click()
        assert page.locator('#partner-navigation [aria-current=page]').inner_text()=='Finance'
        page.get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        page.go_back()
        page.get_by_role('heading',name='Accounting export',exact=True).wait_for()
        assert page.title().startswith('Accounting export')
        assert page.evaluate("document.activeElement.id === 'owner-content'")
        page.locator('#owner-menu').click()
        assert page.locator('#partner-navigation [aria-current=page]').inner_text()=='Finance'


def test_closing_private_access_clears_ephemeral_handoff():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        page.get_by_text('Manage private access',exact=True).click()
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.get_by_label('One-time recovery code',exact=True).wait_for()
        page.get_by_text('Manage private access',exact=True).click()
        page.wait_for_function("!document.querySelector('.owner-access-code input')")
        page.get_by_text('Manage private access',exact=True).click()
        assert page.get_by_label('One-time recovery code',exact=True).count()==0
        assert not page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).is_checked()

def test_locked_owner_navigation_stays_hidden_after_desktop_resize():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_owner_fixture(page)
        page.goto(origin+'/partners#programs')
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        def denied(route):
            route.fulfill(status=401,content_type='application/json',body='{"error":"Sign in required"}')
        page.route('**/api/operator-partners*',denied)
        page.locator('#owner-menu').click()
        page.get_by_role('link',name='Campaigns',exact=True).click()
        page.get_by_role('heading',name='Owner sign-in required',exact=True).wait_for()
        assert page.evaluate("document.activeElement.id === 'owner-content'")
        page.set_viewport_size({'width':1440,'height':900})
        page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        assert page.locator('#partner-navigation').is_hidden()
        assert page.locator('#owner-menu').is_hidden()

@pytest.mark.parametrize('width',[390,1440])
def test_owner_lands_on_review_work_before_program_setup(width):
    import json
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(width,520)) as site:
        page=site.page;install_owner_fixture(page)
        def gigs(route):
            if route.request.method=='GET' and 'resource=gigs' in route.request.url:
                items=[{'id':'offered','status':'offered','partnerId':'p','revision':1,'feeCents':1000,'maximumBonusCents':0,'terms':{'title':'Optional offer'}}, {'id':'submitted','status':'submitted','partnerId':'p','revision':2,'feeCents':2000,'maximumBonusCents':0,'terms':{'title':'Submitted work'}}]
                route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':items}))
            else: route.fallback()
        page.route('**/api/operator-partners*',gigs)
        page.goto(origin+'/partners')
        page.get_by_role('heading',name='Partner gigs',exact=True).wait_for()
        assert page.locator('#partner-navigation [aria-current=page]').inner_text()=='Gigs'
        assert page.get_by_text('1 record needs attention.',exact=True).is_visible()
        first=page.locator('.owner-gig-list > li').first.get_by_role('link')
        assert first.inner_text()=='Submitted work'
        assert first.bounding_box()['y'] < 520
        assert page.get_by_role('button',name='Create offer',exact=True).is_hidden()
        assert page.get_by_role('button',name='Save program controls',exact=True).count()==0

def test_owner_menu_breakpoint_preserves_a_visible_keyboard_target():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(1440,900)) as site:
        page=site.page;install_owner_fixture(page)
        page.goto(origin+'/partners#campaigns')
        page.get_by_role('heading',name='Campaigns',exact=True).wait_for()
        page.locator('#partner-navigation [aria-current=page]').focus()
        page.set_viewport_size({'width':390,'height':844})
        page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        assert page.evaluate("document.activeElement.id === 'owner-menu'")
        page.set_viewport_size({'width':1440,'height':900})
        page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        assert page.evaluate("document.activeElement.matches('#partner-navigation [aria-current=page]')")


def test_owner_accounts_start_with_a_record_in_short_phone_view():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,520)) as site:
        page=site.page;install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        heading=page.get_by_role('heading',name='Partner accounts',exact=True)
        heading.wait_for()
        assert heading.bounding_box()['y'] < 220
        assert page.get_by_role('heading',name='Synthetic Access Partner',exact=True).bounding_box()['y'] < 520
        assert page.locator('header').get_by_text('Open QA workspace',exact=True).count()==0

def test_mixed_program_clearance_identifies_each_program():
    import json
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;_,program=install_owner_fixture(page)
        cleared={**program,'id':'cleared-program','label':'Cleared synthetic program','clearance':{'allowed':True,'missing':[]}}
        def programs(route):
            if route.request.method=='GET' and 'resource=programs' in route.request.url:
                route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[program,cleared]}))
            else: route.fallback()
        page.route('**/api/operator-partners*',programs)
        page.goto(origin+'/partners')
        page.get_by_role('heading',name='Partner gigs',exact=True).wait_for()
        assert '1 of 2 programs cleared' in page.locator('#partner-clearance summary').inner_text()
        page.locator('#partner-clearance summary').click()
        assert 'Synthetic outreach: New work unavailable' in page.locator('#partner-clearance').inner_text()
        assert 'Cleared synthetic program: New work available' in page.locator('#partner-clearance').inner_text()


def test_access_feedback_occupies_its_own_space_above_the_record():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(320,844)) as site:
        page=site.page;install_access_fixture(page)
        page.goto(origin+'/partners#partners')
        page.get_by_text('Manage private access',exact=True).click()
        page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
        page.get_by_role('button',name='Issue recovery code',exact=True).click()
        page.get_by_label('One-time recovery code',exact=True).wait_for()
        assert page.locator('#owner-message').inner_text()=='One-time code ready for private handoff.'
        assert page.evaluate("document.querySelector('#owner-message').getBoundingClientRect().bottom <= document.querySelector('main').getBoundingClientRect().top")
        assert page.get_by_label('One-time recovery code',exact=True).count()==1
