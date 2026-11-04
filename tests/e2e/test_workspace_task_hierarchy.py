"""Work tools remain discoverable without covering customer records."""
import json
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace


@pytest.mark.parametrize('size,theme', [((390, 520), 'light'), ((320, 568), 'dark'), ((1440, 810), 'dark')])
def test_workspace_tools_and_first_request_remain_visible(size, theme):
    with running_operator_workspace() as (_, origin, _), SiteBrowser(viewport=size, color_scheme=theme, reduced_motion='reduce') as site:
        page = site.page
        item = dict(id='work_hierarchy123', kind='inquiry', inquiryId='INQ-hierarchy123', status='submitted', priority='normal', revision=1, submittedAt='2026-11-03T18:00:00Z')
        page.route('**/api/operator-work?*', lambda route: route.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [item]})))
        page.goto(origin)
        page.locator('#workspace:not([hidden])').wait_for()
        tools = page.get_by_role('navigation', name='Workspace tools', exact=True)
        assert tools.is_visible()
        assert tools.evaluate('(node) => getComputedStyle(node).position !== "fixed"')
        assert tools.get_by_role('link', name='Partners', exact=True).is_visible()
        first = page.locator('#work-list button').first
        first.wait_for()
        assert first.bounding_box()['y'] + first.bounding_box()['height'] < size[1]
        if size[0] <= 700:
            filters = page.locator('#queue-filters')
            assert not filters.evaluate('(node) => node.open')
            filters.get_by_text('Filter work', exact=True).click()
            filters.locator('select[name=kind]').wait_for(state='visible')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not site.page_errors
