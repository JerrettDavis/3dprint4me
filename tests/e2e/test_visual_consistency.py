import pytest

from tests.support.browser_harness import SiteBrowser


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("width", [390, 1440])
def test_shared_visual_system_across_routes(theme, width):
    with SiteBrowser(viewport=(width, 960), color_scheme=theme) as site:
        baseline = None
        for route in ["/", "/services.html", "/portfolio.html", "/about.html", "/order.html", "/privacy.html", "/terms.html", "/404.html"]:
            page = site.load(route)
            styles = page.evaluate("""() => {
              const read = (selector, properties) => {
                const style = getComputedStyle(document.querySelector(selector));
                return properties.map(key => style[key]);
              };
              return {
                body: read('body', ['fontFamily', 'fontSize', 'backgroundColor', 'color']),
                header: read('.site-header', ['backgroundColor', 'height']),
                button: read('.nav-actions .button', ['fontFamily', 'fontSize', 'borderRadius', 'backgroundColor']),
                navigation: [...document.querySelectorAll('.nav-links a')].map(a => [a.textContent, a.getAttribute('href')]),
                footer: document.querySelector('.site-footer').textContent.replace(/\\s+/g, ' ').trim()
              };
            }""")
            if baseline is None:
                baseline = styles
            assert styles == baseline, route
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), route
            page.evaluate('scrollTo(0, 300)')
            page.wait_for_function("Math.abs(document.querySelector('header.site-header').getBoundingClientRect().top) < 1")
            site.assert_no_page_errors()


def test_shared_inquiry_entry_and_mobile_menu():
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load('/services.html')
        assert page.locator('.nav-actions .button').get_attribute('href') == '/?ask=unknown'
        page = site.load('/?ask=unknown')
        assert page.locator('#ask-dialog').is_visible()
        page.keyboard.press('Escape')
        page.locator('#menu-toggle').click()
        page.locator('#mobile-panel [data-ask]').click()
        assert page.locator('#ask-dialog').is_visible()
        assert page.locator('#menu-toggle').get_attribute('aria-expanded') == 'false'
        site.assert_no_page_errors()
