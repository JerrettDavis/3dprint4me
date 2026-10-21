import json
from pathlib import Path
import pytest
from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace


@pytest.mark.parametrize('theme', ['light', 'dark'])
def test_operator_inquiry_detail_conversion_and_private_link_fallback(theme):
    with running_operator_workspace() as (_, operator, __):
        item = dict(id='work_inquiry123', inquiryId='INQ-source123', kind='inquiry', status='submitted', revision=1, priority='normal', submittedAt='2026-10-21T12:00:00Z')
        inquiry = dict(name='Visitor', replyEmail='visitor@example.com', message='A replacement knob', referenceUrl='https://example.com/reference', intent='unknown')
        commands = []
        with SiteBrowser(viewport=(390, 844), color_scheme=theme, reduced_motion='reduce', service_workers='block') as site:
            page = site.page
            def respond(route):
                url = route.request.url
                if 'resource=inquiries' in url:
                    command = route.request.post_data_json
                    commands.append(command)
                    if command['action'] == 'invite':
                        body = dict(url='https://3dprint4.me/order.html#inquiry=private-test-value', token='private-test-value', expiresAt='2026-10-28T12:00:00Z')
                    else:
                        assert route.request.headers.get('idempotency-key')
                        item.update(kind='request', projectDraft=True, revision=2, service='design', projectTitle='Desk knob')
                        body = dict(workId=item['id'], requestId='3DP-draft')
                elif 'id=' in url:
                    assert 'schema=2' in url
                    body = dict(item=item, inquiry=inquiry, request=None if item['kind']=='inquiry' else dict(projectTitle='Desk knob'), files=[dict(name='reference.jpg',path='private/ref',mode='upload')], notes=[], events=[])
                else:
                    body = dict(items=[item])
                route.fulfill(status=200,content_type='application/json',body=json.dumps(body))
            page.route('**/api/operator-work?*', respond)
            page.route('**/api/operator-work', respond)
            page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value:{writeText:async()=>{throw new Error('unavailable')}}});")
            page.goto(operator,wait_until='networkidle')
            assert 'Inquiry · Needs response' in page.locator('#work-list').inner_text()
            with page.expect_response(lambda response: '/api/operator-work?' in response.url and 'kind=inquiry' in response.url):
                page.locator('select[name=kind]').select_option('inquiry')
            page.wait_for_function("document.body.dataset.state === 'ready'")
            page.locator('#work-list button').focus()
            page.keyboard.press('Enter')
            page.get_by_text('A replacement knob', exact=True).wait_for()
            assert page.get_by_role('link',name='Open email reply').get_attribute('href').startswith('mailto:visitor')
            assert page.get_by_role('button',name='Download reference.jpg').count() == 1
            assert page.locator('.invoice-sheet,.print-sheet').count() == 0
            assert page.get_by_role('button',name='Move to Reviewing').count() == 1
            page.get_by_role('button',name='Copy project-request link').click()
            field = page.get_by_label('Private project-request link')
            field.wait_for(state='visible')
            assert field.input_value().endswith('#inquiry=private-test-value')
            assert page.evaluate('document.activeElement.getAttribute("aria-label")') == 'Private project-request link'
            assert 'private-test-value' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
            page.screenshot(path=f'screenshots/operator-inquiry-detail-{theme}.png',full_page=True)
            page.get_by_label('Project service').select_option('design')
            page.get_by_label('Project title').fill('Desk knob')
            page.get_by_label('I reviewed the copied contact and inquiry context.').check()
            page.get_by_role('button',name='Create project draft').click()
            page.locator('.draft-badge').wait_for()
            assert 'Original inquiry' in page.locator('#detail-content').inner_text()
            assert page.locator('.invoice-sheet,.print-sheet').count() == 0
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
            assert commands[-1]['command']['revision'] == 1
            page.screenshot(path=f'screenshots/operator-inquiry-{theme}.png',full_page=True)
            site.assert_no_page_errors(allow_console_warnings=['Service Worker registration blocked by Playwright'])
