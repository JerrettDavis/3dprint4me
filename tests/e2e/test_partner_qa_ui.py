"""QA browser state must remain separate even on the production portal origin."""
import json
from tests.support.partner_harness import running_partner_shell
from tests.support.browser_harness import SiteBrowser
from playwright.sync_api import expect


def test_qa_cold_reopen_keeps_live_drafts_and_caches_separate():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;requests=[]
        def api(route):
            requests.append(route.request.url)
            route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'Sign in required'}))
        site.context.route('**/api/partner-qa/v1/**',api)
        page.goto(origin+'/qa/drafts')
        expect(page.get_by_role('heading',name='This device, offline',exact=True)).to_be_visible()
        page.wait_for_function('()=>!!navigator.serviceWorker.controller')
        page.evaluate("""()=>{localStorage.setItem('3dp-partner-preparation-v1:10000000-1000-4000-8000-100000000001',JSON.stringify([{gigId:'20000000-2000-4000-8000-200000000001',expectedGigRevision:2}]));localStorage.setItem('3dp-partner-qa-preparation-v1:10000000-1000-4000-8000-100000000001',JSON.stringify([{gigId:'30000000-3000-4000-8000-300000000001',expectedGigRevision:3}]));}""")
        page.get_by_label('Account code for device drafts',exact=True).fill('10000000-1000-4000-8000-100000000001')
        page.get_by_role('button',name='Open device drafts',exact=True).click()
        expect(page.get_by_text('Prepared gig 30000000-',exact=False)).to_be_visible()
        assert '20000000-2000' not in page.locator('main').inner_text()
        site.context.set_offline(True)
        cold=site.context.new_page();cold.goto(origin+'/qa/drafts')
        expect(cold.get_by_role('heading',name='This device, offline',exact=True)).to_be_visible()
        assert cold.get_by_text('QA only — representative stubs',exact=True).is_visible()
        cold.get_by_role('button',name='Clear all device drafts',exact=True).click()
        assert cold.evaluate("()=>localStorage.getItem('3dp-partner-qa-preparation-v1:10000000-1000-4000-8000-100000000001')") is None
        assert cold.evaluate("()=>localStorage.getItem('3dp-partner-preparation-v1:10000000-1000-4000-8000-100000000001')") is not None
        assert all('/api/partner-qa/' in url for url in requests)
        assert cold.evaluate("async()=> (await caches.keys()).includes('partner-qa-shell-v5')")
        assert not cold.evaluate("async()=> (await caches.keys()).includes('partner-shell-v11')")
