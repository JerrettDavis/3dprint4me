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


@pytest.mark.parametrize("route", ["/", "/order.html"])
def test_dark_palette_contrast_and_system_override_parity(route):
    with SiteBrowser(color_scheme="dark", reduced_motion="reduce") as site:
        page = site.load(route)

        def palette():
            return page.evaluate("""() => {
                const style = getComputedStyle(document.documentElement);
                return Object.fromEntries([
                    'bg', 'paper', 'soft', 'slate-soft', 'teal-soft', 'blue-soft', 'sky-soft',
                    'ink', 'muted', 'accent', 'accent-hover', 'on-accent',
                    'focus-color', 'control-line', 'brand-blue', 'danger'
                ].map(name => [name, style.getPropertyValue('--' + name).trim()]));
            }""")

        def rgb(color):
            return [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]

        def luminance(color):
            channels = [value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4
                        for value in rgb(color)]
            return sum(value * weight for value, weight in zip(channels, (.2126, .7152, .0722)))

        def contrast(one, two):
            lighter, darker = sorted([luminance(one), luminance(two)], reverse=True)
            return (lighter + .05) / (darker + .05)

        system_dark = palette()
        surfaces = ['bg', 'paper', 'soft', 'slate-soft', 'teal-soft', 'blue-soft', 'sky-soft']
        for surface in surfaces:
            for foreground in ['ink', 'muted', 'accent', 'accent-hover', 'danger']:
                assert contrast(system_dark[foreground], system_dark[surface]) >= 4.5, (foreground, surface)
            assert contrast(system_dark['focus-color'], system_dark[surface]) >= 3, surface
            assert contrast(system_dark['control-line'], system_dark[surface]) >= 3, surface
        for background in ['accent', 'accent-hover']:
            assert contrast(system_dark['on-accent'], system_dark[background]) >= 4.5, background
        assert contrast(system_dark['brand-blue'], system_dark['bg']) >= 4.5
        assert luminance(system_dark['bg']) < luminance(system_dark['paper']) < luminance(system_dark['soft'])
        for surface in ['bg', 'paper', 'soft']:
            assert max(rgb(system_dark[surface])) - min(rgb(system_dark[surface])) < .06, surface

        toggle = page.locator('#theme-toggle')
        toggle.click()  # System -> explicit light, even while the OS prefers dark.
        light = palette()
        assert light['bg'] != system_dark['bg']
        toggle.click()
        assert palette() == system_dark
        page.emulate_media(color_scheme="light")
        assert palette() == system_dark
        toggle.click()
        assert palette() == light
        page.emulate_media(color_scheme="dark")
        assert palette() == system_dark
        page.keyboard.press("Tab")
        page.keyboard.press("Shift+Tab")
        assert toggle.evaluate("element => element === document.activeElement")
        assert toggle.evaluate("""element => {
            const style = getComputedStyle(element);
            return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
        }""")
        site.assert_no_page_errors()
