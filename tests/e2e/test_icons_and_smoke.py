from __future__ import annotations

import datetime

import pytest

from tests.support.browser_harness import SiteBrowser

ALL_ROUTES = [
    "/",
    "/services.html",
    "/portfolio.html",
    "/about.html",
    "/order.html",
    "/privacy.html",
    "/terms.html",
    "/404.html",
]

NAV_ROUTES = {
    "/services.html": "Services",
    "/portfolio.html": "Work",
    "/about.html": "About",
}


def test_every_page_renders_header_footer_icons_and_images_without_errors() -> None:
    with SiteBrowser(viewport=(1366, 960)) as site:
        for route in ALL_ROUTES:
            page = site.load(route)

            # Homepage uses static landmarks; other routes mount shared navigation.
            assert page.locator("header.site-header").count() == 1, route
            assert page.locator("footer.site-footer").count() == 1, route

            # The brand mark icon renders in both the header and the footer.
            brand_marks = page.locator("img.brand-mark")
            assert brand_marks.count() == 2, route
            assert brand_marks.evaluate_all("els => els.every(img => img.complete && img.naturalWidth > 0)"), route

            # Theme toggle always shows a real, non-empty icon (not "undefined").
            theme_icon_html = page.locator("#theme-toggle" if route == "/" else "#theme-toggle").inner_html()
            assert "<svg" in theme_icon_html, route
            assert "undefined" not in theme_icon_html, route

            # Menu toggle icon is present too.
            menu_icon_html = page.locator("#menu-toggle" if route == "/" else "#menu-toggle").inner_html()
            assert "<svg" in menu_icon_html, route

            # Every image on the page finished loading successfully.
            images = page.locator("img")
            if images.count():
                for image in images.all():
                    image.scroll_into_view_if_needed()
                    image.evaluate("img => img.decode()")
                assert images.evaluate_all(
                    "els => els.every(img => img.complete && img.naturalWidth > 0)"
                ), route

            # Nav marks the current page, and only the current page, as active.
            active = page.locator(".nav-links a[aria-current='page']")
            if route in NAV_ROUTES:
                assert active.count() == 1, route
                assert active.inner_text() == NAV_ROUTES[route], route
            else:
                assert active.count() == 0, route

            # Footer year is populated with the real current year.
            assert page.locator("#year").inner_text() == str(datetime.datetime.now().year), route

            site.assert_no_page_errors()


@pytest.mark.parametrize("route", ["/", "/services.html"])
def test_theme_toggle_shows_a_distinct_valid_icon_for_every_theme(route: str) -> None:
    with SiteBrowser(viewport=(1366, 960)) as site:
        page = site.load(route)
        theme = page.locator("#theme-toggle" if route == "/" else "#theme-toggle")

        seen = {}
        for expected_label in ["light", "dark", "system"]:
            theme.click()
            next_label = {"light": "dark", "dark": "system", "system": "light"}[expected_label]
            label = f"Theme: {expected_label}"
            assert theme.get_attribute("aria-label") == label
            assert page.evaluate("localStorage.getItem('3dp-theme')") == expected_label
            html = theme.inner_html()
            assert "<svg" in html
            assert "undefined" not in html
            seen[expected_label] = html

        # Each theme renders a visually distinct icon (sun / moon / monitor).
        assert len(set(seen.values())) == 3
        site.assert_no_page_errors()


def test_site_and_theme_toggle_work_when_browser_storage_is_denied() -> None:
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load("/order.html", storage_denied=True)
        theme = page.locator("#theme-toggle")

        assert page.locator("header.site-header").count() == 1
        assert page.locator("footer.site-footer").count() == 1
        assert page.locator("#year").inner_text() == str(datetime.datetime.now().year)
        theme.click()
        assert theme.get_attribute("aria-label") == "Theme: light"
        page.locator("#next-button").click()
        page.locator("#project-title").fill("Storage-denied project")
        assert page.locator("#draft-storage-note").is_visible()
        site.assert_no_page_errors()


def test_menu_toggle_shows_menu_and_close_icons_correctly() -> None:
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load("/")
        menu = page.locator("#menu-toggle")

        closed_icon = menu.inner_html()
        assert "<svg" in closed_icon

        menu.click()
        open_icon = menu.inner_html()
        assert "<svg" in open_icon
        assert open_icon != closed_icon
        assert menu.get_attribute("aria-label") == "Close menu"

        menu.click()
        reclosed_icon = menu.inner_html()
        assert "<svg" in reclosed_icon
        assert menu.get_attribute("aria-label") == "Open menu"
        site.assert_no_page_errors()


def test_index_category_tiles_are_visible_and_actionable() -> None:
    with SiteBrowser(viewport=(1366, 960)) as site:
        page = site.load("/")
        tiles = page.locator(".cat-tile")
        assert tiles.count() == 8
        for index in range(tiles.count()):
            tile = tiles.nth(index)
            assert tile.is_visible()
            assert tile.locator(".cat-media img, .cat-media svg").first.is_visible()
            assert tile.locator("h3").inner_text().strip()
            assert tile.get_attribute("href") or tile.get_attribute("data-ask")
            symbol = tile.locator(".cat-cta svg use").get_attribute("href")
            assert symbol and page.locator(f"{symbol} path").count() > 0
        site.assert_no_page_errors()
