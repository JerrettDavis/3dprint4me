import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.status_capacity import capacity_html, ROOT


@pytest.mark.parametrize('theme', ['light', 'dark', 'system'])
def test_protected_capacity_is_readable_at_390_and_uses_dated_evidence(theme):
    with SiteBrowser(viewport=(390, 844), color_scheme='dark', reduced_motion='reduce') as site:
        page = site.page
        page.set_content(capacity_html(theme), wait_until='load')
        assert page.locator('html').get_attribute('data-theme') == theme
        assert page.get_by_role('heading', name='Capacity & limits', exact=True).count() == 1
        assert page.locator('[data-capacity-status="warning"]').count() >= 1
        assert page.locator('[data-capacity-status="critical"]').count() >= 1
        assert page.locator('[data-capacity-status="stale"]').count() >= 1
        assert page.locator('[data-capacity-status="unknown"]').count() >= 1
        assert page.get_by_text('This reading has expired.', exact=False).count() >= 1
        assert page.get_by_text('08:00 America/Chicago', exact=False).count() == 1
        assert page.locator('script').count() == 0
        assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
        page.keyboard.press('Tab')
        assert page.locator(':focus').get_attribute('href') == 'https://status.3dprint4.me'
        page.keyboard.press('Tab')
        assert page.locator(':focus').get_attribute('href') == '?theme=system'
        if theme != 'system':
            (ROOT / 'screenshots').mkdir(exist_ok=True)
            page.screenshot(path=str(ROOT / 'screenshots' / f'status-capacity-390-{theme}.png'), full_page=True)
        site.assert_no_page_errors()
