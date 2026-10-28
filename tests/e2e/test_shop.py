from tests.support.browser_harness import SiteBrowser


def test_shop_filter_search_empty_recovery_and_real_paths():
    with SiteBrowser(viewport=(390, 844), color_scheme="light") as site:
        page = site.load("/")
        assert page.locator("#shop-grid .cat-tile").count() == 8
        page.locator('[data-purpose-filter="business"]').click()
        assert page.locator("#shop-grid .cat-tile:visible").count() == 2
        page.locator("#shop-search").fill("unmatched zebra")
        assert page.locator("#shop-empty").is_visible()
        assert page.locator("#shop-count").inner_text() == "0 starting points"
        page.locator("#shop-reset").click()
        assert page.locator("#shop-grid .cat-tile:visible").count() == 8
        page.locator("#shop-search").fill("road")
        assert page.locator("#shop-grid .cat-tile:visible").count() == 1
        assert page.locator("#shop-grid .cat-tile:visible").get_attribute("href") == "/customize/g/route-shield/"
        page.locator("#shop-search").fill("replacement")
        assert page.locator("#shop-grid .cat-tile:visible").get_attribute("href") == "/order.html?service=design&product=replacement-part"
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
