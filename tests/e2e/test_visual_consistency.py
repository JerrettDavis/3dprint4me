import pytest

from tests.support.browser_harness import SiteBrowser


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("width", [390, 1440, 2560])
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
                icon: read('.icon-button', ['borderRadius']),
                controlRadius: getComputedStyle(document.documentElement).getPropertyValue('--radius-sm').trim(),
                navigation: [...document.querySelectorAll('.nav-links a')].map(a => [a.textContent, a.getAttribute('href')]),
                footer: document.querySelector('.site-footer').textContent.replace(/\\s+/g, ' ').trim()
              };
            }""")
            if baseline is None:
                baseline = styles
            assert styles == baseline, route
            assert styles["button"][2] == styles["icon"][0] == styles["controlRadius"], route
            if width >= 1920:
                assert page.locator(".nav-shell").bounding_box()["width"] >= width * .9, route
                if route in ("/privacy.html", "/terms.html"):
                    assert page.locator("article.narrow").bounding_box()["width"] <= 860, route
                if route == "/order.html":
                    assert page.locator(".order-shell").bounding_box()["width"] <= 1400, route
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), route
            page.evaluate('scrollTo(0, 300)')
            page.wait_for_function("Math.abs(document.querySelector('header.site-header').getBoundingClientRect().top) < 1")
            site.assert_no_page_errors()


@pytest.mark.parametrize("theme", ["light", "dark"])
@pytest.mark.parametrize("width", [390, 2560])
def test_storefront_components_follow_shared_radius_roles(theme, width):
    with SiteBrowser(viewport=(width, 960), color_scheme=theme, reduced_motion="reduce") as site:
        for route, roles in [
            ("/", [
                (".shop-opening", "--radius-lg"), (".shop-help", "--radius-lg"),
                ("#ask-dialog", "--radius-lg"), ("#shop-grid .cat-tile", "--radius-md"),
                (".work-card", "--radius-md"), (".shop-heading input", "--radius-sm"),
                ("#ask-message", "--radius-sm"), (".shop-filters button", "--radius-sm"),
            ]),
            ("/order.html", [
                (".choice-card label", "--radius-md"), (".estimate-sidebar", "--radius-lg"),
                ("#project-title", "--radius-sm"),
            ]),
            ("/portfolio.html", [(".project-card", "--radius-md")]),
        ]:
            page = site.load(route)
            for selector, token in roles:
                radii = page.locator(selector).first.evaluate("""(element, token) => ({
                    actual: getComputedStyle(element).borderRadius,
                    expected: getComputedStyle(document.documentElement).getPropertyValue(token).trim()
                })""", token)
                assert radii["actual"] == radii["expected"], (route, selector, radii)
            site.assert_no_page_errors()


def test_shared_inquiry_entry_and_mobile_menu():
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load('/services.html')
        assert page.locator('.nav-actions .button').get_attribute('href') == '/order.html?service=print'
        page = site.load('/?ask=unknown')
        assert page.locator('#ask-dialog').is_visible()
        page.keyboard.press('Escape')
        page.locator('#menu-toggle').click()
        page.locator('#mobile-panel [data-ask]').click()
        assert page.locator('#ask-dialog').is_visible()
        assert page.locator('#menu-toggle').get_attribute('aria-expanded') == 'false'
        site.assert_no_page_errors()
