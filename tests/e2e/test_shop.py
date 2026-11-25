import pytest

from tests.support.browser_harness import SiteBrowser


@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("viewport", [(375, 812), (390, 844), (844, 390), (1440, 1000)])
def test_storefront_shopping_paths_and_readability(viewport, scheme):
    with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
        page = site.load("/")
        assert page.locator(".shop-opening .button").get_attribute("href") == "/shop/"
        assert page.locator(".shop-secondary-link").get_attribute("href") == "/order.html?service=print"
        assert "non-binding" in page.locator(".shop-promises").inner_text()
        assert page.locator(".shop-promises a").get_attribute("href") == "#how-it-works"
        for service in ("print", "design", "repair", "consult"):
            link = page.locator(f'.shop-nav a[href="/order.html?service={service}"]')
            assert link.is_visible()
            assert link.evaluate("""element => {
                const bounds = element.getBoundingClientRect();
                return bounds.left >= 0 && bounds.right <= innerWidth && bounds.height >= 44;
            }""")
        for selector in (".shop-nav", ".shop-filters"):
            assert page.locator(selector).evaluate("element => element.scrollWidth <= element.clientWidth")
        if viewport[0] <= 760:
            for selector in ("#shop-search", "#shop-grid .cat-body p"):
                assert page.locator(selector).first.evaluate("element => parseFloat(getComputedStyle(element).fontSize) >= 16")
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        site.assert_no_page_errors()


@pytest.mark.parametrize("scheme", ["light", "dark"])
@pytest.mark.parametrize("width,min_columns", [(1920, 4), (2560, 6), (3440, 8)])
def test_home_uses_wide_viewports_without_stretching_filtered_cards(width, min_columns, scheme):
    with SiteBrowser(viewport=(width, 1080), color_scheme=scheme, reduced_motion="reduce") as site:
        page = site.load("/")
        for selector in (".nav-shell", ".shop-opening", ".shop-catalog", ".footer-grid"):
            assert page.locator(selector).bounding_box()["width"] >= width * .9
        cards = page.locator("#shop-grid .cat-tile")
        first = cards.first.bounding_box()
        assert 280 <= first["width"] <= 400
        assert page.locator("#shop-grid").evaluate("""element => {
            const style = getComputedStyle(element);
            return parseFloat(style.columnGap) >= 24 && parseFloat(style.rowGap) >= 40;
        }""")
        assert cards.first.locator(".cat-body").evaluate("element => parseFloat(getComputedStyle(element).paddingLeft) >= 24")
        assert page.locator(".shop-layout").evaluate("element => parseFloat(getComputedStyle(element).columnGap) >= 48")
        heading = page.locator(".shop-layout aside>h3").bounding_box()
        first_filter = page.locator(".shop-filters button").first.bounding_box()
        assert first_filter["y"] - heading["y"] - heading["height"] >= 15.9
        assert cards.evaluate_all("""cards => cards.filter(card =>
            Math.abs(card.getBoundingClientRect().top - cards[0].getBoundingClientRect().top) < 1
        ).length""") >= min_columns
        page.locator("#shop-search").fill("fidget")
        visible = page.locator("#shop-grid .cat-tile:visible")
        assert visible.count() == 1
        assert abs(visible.bounding_box()["width"] - first["width"]) <= 1
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        site.assert_no_page_errors()


def test_shop_filter_search_empty_recovery_and_real_paths():
    with SiteBrowser(viewport=(390, 844), color_scheme="light") as site:
        page = site.load("/")
        assert page.locator("#shop-grid .cat-tile").count() == 17
        page.locator('[data-purpose-filter="business"]').focus()
        page.keyboard.press("Enter")
        assert page.locator("#shop-grid .cat-tile:visible").count() == 3
        page.locator("#shop-search").fill("unmatched zebra")
        assert page.locator("#shop-empty").is_visible()
        assert page.locator("#shop-count").inner_text() == "0 starting points"
        page.locator("#shop-reset").click()
        assert page.locator("#shop-grid .cat-tile:visible").count() == 17
        assert page.locator("#shop-search").evaluate("element => element === document.activeElement")
        assert page.locator('[data-purpose-filter="all"]').get_attribute("aria-pressed") == "true"
        page.locator("#shop-search").fill("road")
        assert page.locator("#shop-grid .cat-tile:visible").count() == 1
        assert page.locator("#shop-grid .cat-tile:visible").get_attribute("href") == "/shop/?generator=route-shield"
        page.locator("#shop-search").fill("replacement")
        assert page.locator("#shop-grid .cat-tile:visible").get_attribute("href") == "/order.html?service=design&product=replacement-part"
        page.locator('#shop-search').fill('fidget')
        assert page.locator('#shop-grid .cat-tile:visible').get_attribute('href') == '/shop/?generator=infinity-fidget'
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
        site.assert_no_page_errors()


def test_catalog_request_preserves_product_and_service_context():
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load('/order.html?service=design&product=replacement-part')
        assert page.locator('[name="service"]:checked').input_value() == 'design'
        assert page.locator('#project-title').input_value() == 'Replacement part'
        assert 'Replacement part' in page.locator('#description').input_value()
        site.assert_no_page_errors()


def test_catalog_prefill_is_allowlisted_and_preserves_existing_draft():
    import json
    with SiteBrowser(viewport=(390, 844)) as site:
        page = site.load('/order.html?service=design&product=unrecognized-product')
        assert page.locator('#project-title').input_value() == ''
        page = site.load('/order.html?service=design&product=replacement-part', storage={
            '3dp-project-draft-v1': json.dumps({'projectTitle': 'My existing project', 'description': 'Keep my measurements'})
        })
        assert page.locator('#project-title').input_value() == 'My existing project'
        assert page.locator('#description').input_value() == 'Keep my measurements'
        site.assert_no_page_errors()
