from __future__ import annotations

from tests.support.browser_harness import SiteBrowser


def test_public_pages_render_theme_and_navigation() -> None:
    with SiteBrowser(viewport=(1440, 1000), color_scheme="light") as site:
        page = site.load("/services.html")

        assert page.title() == "Services and pricing approach — 3dprint4.me"
        assert page.locator("header.site-header").count() == 1
        assert page.locator("footer.site-footer").count() == 1
        assert page.locator("main#main").count() == 1
        assert page.locator(".nav-links a[aria-current='page']").inner_text() == "Services"
        assert page.locator("img").evaluate_all("els => els.every(img => img.complete && img.naturalWidth > 0)")
        assert page.locator("a[target='_blank']").evaluate_all("els => els.every(a => a.rel.split(/\\s+/).includes('noopener'))")

        theme = page.locator("#theme-toggle")
        assert theme.get_attribute("aria-label") == "Theme: system"
        theme.click()
        assert page.locator("html").get_attribute("data-theme") == "light"
        assert page.evaluate("localStorage.getItem('3dp-theme')") == "light"
        theme.click()
        assert page.locator("html").get_attribute("data-theme") == "dark"
        theme.click()
        assert page.locator("html").get_attribute("data-theme") is None

        assert page.locator(".skip-link").get_attribute("href") == "#main"
        site.assert_no_page_errors()


def test_mobile_menu_keyboard_and_no_horizontal_overflow() -> None:
    with SiteBrowser(viewport=(390, 844), color_scheme="dark") as site:
        page = site.load("/")
        menu = page.locator("#menu-toggle")
        panel = page.locator("#mobile-panel")

        assert menu.is_visible()
        assert menu.get_attribute("aria-expanded") == "false"
        menu.click()
        assert menu.get_attribute("aria-expanded") == "true"
        assert panel.evaluate("el => el.classList.contains('open')")
        assert panel.locator("a").first.evaluate("el => el === document.activeElement")
        page.keyboard.press("Escape")
        assert menu.get_attribute("aria-expanded") == "false"
        assert menu.evaluate("el => el === document.activeElement")

        dimensions = page.evaluate("() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })")
        assert dimensions["scroll"] <= dimensions["client"]
        assert page.locator(".hero-actions .button").evaluate_all("els => els.every(el => el.getBoundingClientRect().height >= 44)")
        site.assert_no_page_errors()


def test_reduced_motion_preference_disables_motion() -> None:
    with SiteBrowser(viewport=(1024, 768), reduced_motion="reduce") as site:
        page = site.load("/")
        values = page.evaluate(
            """() => {
              const button = document.querySelector('.button');
              const style = getComputedStyle(button);
              return { animation: style.animationDuration, transition: style.transitionDuration };
            }"""
        )
        durations = page.evaluate("""values => {
          const seconds = value => value.endsWith('ms') ? parseFloat(value) / 1000 : parseFloat(value);
          return [seconds(values.animation), seconds(values.transition)];
        }""", values)
        assert max(durations) <= 0.001
        site.assert_no_page_errors()


def test_published_work_is_readable_without_decorative_images() -> None:
    with SiteBrowser(viewport=(390, 844), color_scheme="dark") as site:
        page = site.load("/about.html")
        assert page.locator(".work-record-list li").count() == 3
        assert page.locator(".work-record-list a").evaluate_all("els => els.every(a => a.getBoundingClientRect().height > 0)")
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

        page = site.load("/portfolio.html")
        assert page.locator(".project-card").count() == 6
        assert page.locator(".project-card a").evaluate_all("els => els.every(a => a.getBoundingClientRect().height >= 44)")
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        site.assert_no_page_errors()


def test_published_projects_show_their_own_work_images() -> None:
    with SiteBrowser(viewport=(1440, 1000), color_scheme="light") as site:
        home = site.load("/")
        featured = home.locator(".hero-case img.project-image")
        assert featured.count() == 1
        assert "Ender 3 Pro" in featured.get_attribute("alt")
        assert featured.evaluate("img => img.complete && img.naturalWidth > 0")

        work = site.load("/portfolio.html")
        images = work.locator(".project-card img.project-image")
        assert images.count() == 6
        assert images.evaluate_all(
            "els => els.every(img => img.complete && img.naturalWidth > 0 && img.alt.trim().length > 12)"
        )
        site.assert_no_page_errors()
