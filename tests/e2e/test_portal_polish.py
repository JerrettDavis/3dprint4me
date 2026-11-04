"""Visual rhythm, form usability and motion across the live and QA portal shells."""
from pathlib import Path
import pytest
from tests.support.browser_harness import SiteBrowser,ROOT
from tests.support.operator_harness import running_operator_workspace
from tests.support.partner_harness import running_partner_shell
from tests.e2e.test_partner_owner import install_owner_fixture
from tests.e2e.test_partner_shell import install_partner_fixture


@pytest.mark.parametrize('width,theme,motion',[(390,'dark','reduce'),(1440,'light','no-preference')])
@pytest.mark.parametrize('surface',['work','owner','owner-qa','partner','partner-qa','review'])
def test_portal_spacing_controls_focus_and_motion(width,theme,motion,surface):
    owner=surface.startswith('owner');partner=surface.startswith('partner');qa=surface.endswith('-qa')
    workspace=running_partner_shell() if partner else running_operator_workspace()
    with workspace as target,SiteBrowser(viewport=(width,960),color_scheme=theme,reduced_motion=motion) as site:
        page=site.page
        if surface=='review':
            site.context.set_offline(True);page.goto((ROOT/'operator/review-reader.html').as_uri())
            page.get_by_role('heading',name='Offline professional review',exact=True).wait_for()
            control=page.get_by_label('Review passphrase',exact=True)
        elif owner:
            install_owner_fixture(page,realm='qa' if qa else 'live')
            page.goto(target[1]+('/partners/qa' if qa else '/partners'))
            page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
            control=page.get_by_role('spinbutton',name='Default weekly authorization (USD)',exact=True)
            if qa:
                controls=page.locator('.qa-tool')
                assert controls.count()==3
                for button in page.locator('.qa-tools button').all():
                    assert button.bounding_box()['height']>=44
                    assert button.evaluate('(n)=>getComputedStyle(n).borderRadius')!='0px'
        elif partner:
            install_partner_fixture(page,realm='qa' if qa else 'live')
            page.goto(target+('/qa/profile' if qa else '/profile'))
            page.get_by_role('heading',name='Your profile',exact=True).wait_for()
            control=page.get_by_label('Display name',exact=True)
        else:
            page.goto(target[1]);page.get_by_role('heading',name='Incoming work',exact=True).wait_for()
            control=page.get_by_role('combobox',name='View',exact=True)
            page.locator('#toast').evaluate("n=>n.dataset.kind='success'")
            assert '\u2713' in page.locator('#toast').evaluate("n=>getComputedStyle(n,'::before').content")
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        control.focus()
        control.press('Tab');page.keyboard.press('Shift+Tab')
        assert control.evaluate('(n)=>n===document.activeElement')
        assert control.evaluate('(n)=>getComputedStyle(n).outlineStyle')!='none'
        assert control.bounding_box()['height']>=44
        page.wait_for_timeout(250)
        if motion=='reduce':
            assert page.evaluate('document.getAnimations().every(a=>a.playState!=="running")')
        else:
            assert control.evaluate('(n)=>getComputedStyle(n).transitionDuration')!='0s'
        out=ROOT/'docs/portal-polish/screenshots';out.mkdir(parents=True,exist_ok=True)
        # Fictional presentation fixtures only. Mask all fields before recording pixels.
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(out/f'{surface}-{width}-{theme}.png'),full_page=True,animations='disabled',mask=[page.locator('input[type=password],[data-secret],.owner-access-code')])
        opposite='light' if theme=='dark' else 'dark'
        if surface=='work':
            for _ in range(1 if opposite=='light' else 2):page.get_by_role('button',name='Change color theme',exact=True).click()
        else:page.get_by_role('combobox',name='Theme',exact=True).select_option(opposite)
        assert page.evaluate('getComputedStyle(document.documentElement).colorScheme')==opposite
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not site.page_errors

def test_qa_tools_explain_access_and_disable_controls_during_requests():
    from playwright.sync_api import expect
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;session=[];pending=[]
        def respond(route):
            if route.request.method=='POST':pending.append(route);return
            if 'resource=session' in route.request.url:
                session.append(route);return
            route.fulfill(content_type='application/json',body='{"items":[]}')
        page.route('**/api/operator-partner-qa*',respond)
        with page.expect_request(lambda r:'operator-partner-qa' in r.url and 'resource=session' in r.url):
            page.goto(origin+'/partners/qa')
        page.wait_for_function('document.querySelector(".qa-banner")?.dataset.state==="checking"')
        expect(page.get_by_role('button',name='Create synthetic QA run',exact=True,include_hidden=True)).to_be_disabled()
        assert session
        session.pop(0).fulfill(status=401,content_type='application/json',body='{"error":"Owner sign-in required."}')
        page.get_by_role('heading',name='Owner sign-in required',exact=True).wait_for()
        expect(page.get_by_role('button',name='Create synthetic QA run',exact=True,include_hidden=True)).to_be_disabled()
        assert 'Sign in as the owner' in page.locator('#qa-run-result').inner_text()
        expect(page.locator('.qa-tools')).to_be_hidden()
        page.screenshot(path=str(ROOT/'docs/portal-polish/screenshots/owner-qa-access-required.png'),full_page=True)
        with page.expect_request(lambda r:'operator-partner-qa' in r.url and 'resource=session' in r.url):
            page.get_by_role('button',name='Check access again',exact=True).click()
        session.pop(0).fulfill(content_type='application/json',body='{"owner":{"id":"synthetic-owner"},"csrfToken":"synthetic-only"}')
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        create=page.get_by_role('button',name='Create synthetic QA run',exact=True,include_hidden=True)
        expect(create).to_be_enabled();expect(page.locator('.qa-tools')).to_be_visible()
        with page.expect_request(lambda r:'operator-partner-qa' in r.url and r.method=='POST'):
            create.click()
        expect(create).to_be_disabled()
        assert page.locator('.qa-tools').get_attribute('aria-busy')=='true'
        assert 'Creating synthetic QA run' in page.locator('#qa-run-result').inner_text()
        page.screenshot(path=str(ROOT/'docs/portal-polish/screenshots/owner-qa-busy.png'),full_page=True)
        assert pending
        pending.pop(0).fulfill(status=503,content_type='application/json',body='{"error":"QA temporarily unavailable. Try again."}')
        expect(create).to_be_enabled();assert 'Partner administration is temporarily unavailable.' in page.locator('#qa-run-result').inner_text()
        assert page.locator('.qa-tools').get_attribute('aria-busy')=='false'
        page.screenshot(path=str(ROOT/'docs/portal-polish/screenshots/owner-qa-retry.png'),full_page=True)
