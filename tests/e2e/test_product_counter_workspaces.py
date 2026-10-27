"""Product-counter hierarchy uses real work state and keeps phone navigation usable."""
import json
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.partner_harness import running_partner_shell
from tests.e2e.test_partner_shell import install_partner_fixture


@pytest.mark.parametrize('theme', ['light', 'dark'])
def test_operator_queue_exposes_next_action_before_opening_private_details(theme):
    with running_operator_workspace() as (_, origin, __), SiteBrowser(viewport=(390, 844), color_scheme=theme, service_workers='block') as site:
        page = site.page
        item = dict(id='work_counter123', kind='request', projectTitle='A very long replacement housing project', service='design', status='triage', acknowledged=True, priority='normal', submittedAt='2026-10-21T12:00:00Z')
        page.route('**/api/operator-work*', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [item]})))
        page.goto(origin)
        page.locator('#work-list button').wait_for()
        assert page.locator('#work-list .next-action').inner_text() == 'Next: Prepare quote'
        assert page.locator('#queue-summary').inner_text() == '1 shown · 0 need acknowledgment'
        assert page.locator('#filters').bounding_box()['height'] < 200
        assert page.locator('#work-list button').evaluate('(e) => getComputedStyle(e).borderRadius') == '0px'
        page.locator('.skip-link').focus()
        page.keyboard.press('Tab')
        assert page.locator('.brand').evaluate('(e) => e === document.activeElement')
        focus_contrast = page.locator('.brand').evaluate('''e => {
            const lum=color=>{const c=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
            const a=lum(getComputedStyle(e).outlineColor),b=lum(getComputedStyle(e.closest('.topbar')).backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        }''')
        assert focus_contrast >= 3
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


@pytest.mark.parametrize('theme', ['light', 'dark'])
@pytest.mark.parametrize('work_state,next_step', [('changes_requested', 'Review requested changes'), ('cancellation_requested', 'Await cancellation review'), ('disputed', 'Contact owner about dispute')])
def test_partner_overview_prioritizes_active_work_even_when_new_work_is_off(theme,work_state,next_step):
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844), color_scheme=theme, service_workers='block') as site:
        page = site.page
        install_partner_fixture(page)
        gigs = [{'id': '20000000-1000-4000-8000-100000000001', 'status': work_state, 'feeCents': 4000, 'acceptedAt': '2026-10-24T12:00:00Z', 'terms': {'title': 'Consenting local introductions', 'deadline': '2026-11-02', 'area': 'Tulsa'}}]
        page.route('**/api/partner/v1/gigs', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'items': gigs})))
        page.goto(origin)
        page.get_by_role('heading', name='Your active work', exact=True).wait_for()
        section = page.get_by_role('region', name='Your active work')
        assert next_step in section.inner_text()
        assert section.get_by_role('link', name='Consenting local introductions').get_attribute('href') == '/gigs/' + gigs[0]['id']
        assert 'New work is currently unavailable' in page.locator('main').inner_text()
        assert page.get_by_role('heading', name='Available offers').count() == 1
        assert page.locator('.work-overview').evaluate('(e) => getComputedStyle(e).borderRadius') == '0px'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=f'screenshots/partner-product-counter-{theme}.png', full_page=True)


def test_partner_earnings_separates_amount_owed_from_verified_settlement():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390, 844), service_workers='block') as site:
        page = site.page
        install_partner_fixture(page)
        totals = dict(committedCents=9000, submittedCents=2000, earnedBonusCents=500, contingentBonusCents=1000, outstandingCents=4500, paidCents=4000, disputedCents=0)
        page.route('**/api/partner/v1/earnings', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [], 'totals': totals})))
        page.goto(origin + '/earnings')
        unpaid = page.get_by_role('region', name='Unpaid obligations', exact=True)
        unpaid.wait_for()
        assert '$45.00' in unpaid.inner_text()
        assert '$40.00' not in unpaid.inner_text()
        settled = page.get_by_role('region', name='Verified settlement', exact=True)
        assert '$40.00' in settled.inner_text()
        assert page.get_by_role('button', name='Download statement CSV').count() == 1
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

@pytest.mark.parametrize('explicit', [False, True])
def test_owner_primary_action_remains_readable_in_dark_theme(explicit):
    from tests.e2e.test_partner_owner import install_owner_fixture
    with running_operator_workspace() as (_, origin, __), SiteBrowser(viewport=(390, 844), color_scheme='dark', service_workers='block') as site:
        page = site.page
        install_owner_fixture(page)
        page.goto(origin + '/partners')
        button = page.get_by_role('button', name='Save program controls', exact=True)
        button.wait_for()
        if explicit:
            page.locator('#owner-theme').select_option('dark')
        contrast = button.evaluate('''e => {
            const s=getComputedStyle(e),lum=color=>{const c=color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
            const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        }''')
        assert contrast >= 4.5

