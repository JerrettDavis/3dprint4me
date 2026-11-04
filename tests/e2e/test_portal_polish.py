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
        assert not site.page_errors
