"""Grouped navigation stays discoverable on phones and keyboard reachable."""
import re
import pytest
from tests.support.browser_harness import SiteBrowser
from playwright.sync_api import expect
from tests.support.partner_harness import running_partner_shell
from tests.support.operator_harness import running_operator_workspace
from tests.e2e.test_partner_shell import install_partner_fixture
from tests.e2e.test_partner_owner import install_owner_fixture


@pytest.mark.parametrize('width,height,theme', [(320, 900, 'light'), (390, 900, 'dark'), (768, 900, 'light'), (1440, 900, 'dark'), (1440, 500, 'light'), (844, 390, 'dark')])
@pytest.mark.parametrize('owner', [False, True])
def test_responsive_navigation_reaches_last_destination(width, height, theme, owner):
    workspace = running_operator_workspace() if owner else running_partner_shell()
    with workspace as target, SiteBrowser(viewport=(width, height), color_scheme=theme, reduced_motion='reduce') as site:
        page = site.page
        if owner:
            install_owner_fixture(page)
            origin = target[1]
            page.goto(origin + '/partners#programs')
            page.get_by_role('heading', name='Partner programs', exact=True).wait_for()
        else:
            install_partner_fixture(page)
            page.goto(target)
            page.get_by_role('heading', name='Hello, Synthetic Partner.').wait_for()
        nav = page.get_by_role('navigation')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        compact = width < (1000 if owner else 701)
        if compact:
            assert not nav.is_visible() or nav.bounding_box()['height'] < 100
            menu = page.get_by_role('button', name=re.compile('^Workspace menu'))
            assert menu.get_attribute('aria-expanded') == 'false'
            menu.click()
            expect(menu).to_have_attribute('aria-expanded', 'true')
        else:
            assert nav.bounding_box()['x'] < page.locator('main').bounding_box()['x']
        # Every destination is visible within the page width; tabbing scrolls vertically.
        links = nav.get_by_role('link')
        assert nav.evaluate('(node) => node.scrollWidth <= node.clientWidth')
        links.first.focus()
        for _ in range(links.count() - 1):
            page.keyboard.press('Tab')
        assert links.last.evaluate('(link) => link === document.activeElement')
        assert links.last.evaluate('(link) => {const a=link.getBoundingClientRect();return a.top>=0 && a.bottom<=innerHeight}')
        assert links.last.evaluate('(link) => {const a=link.getBoundingClientRect(),b=link.parentElement.getBoundingClientRect();return a.left>=b.left-1 && a.right<=b.right+1}')
        destination = links.last.inner_text()
        links.last.click()
        page.wait_for_function('(label) => document.querySelector("nav [aria-current=page]")?.textContent === label', arg=destination)
        if compact:
            assert page.get_by_role('button', name=re.compile('^Workspace menu')).get_attribute('aria-expanded') == 'false'
        page.reload()
        page.wait_for_function('(label) => document.querySelector("nav [aria-current=page]")?.textContent === label', arg=destination)
        if compact:
            page.get_by_role('button', name=re.compile('^Workspace menu')).click()
        current = nav.locator('[aria-current=page]')
        assert current.evaluate('(link) => {const a=link.getBoundingClientRect(),b=link.parentElement.getBoundingClientRect();return a.left>=b.left-1 && a.right<=b.right+1}')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors
