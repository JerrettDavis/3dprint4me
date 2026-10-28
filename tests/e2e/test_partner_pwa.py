"""Real worker/cache lifecycle; API data is an explicitly synthetic fixture."""
from tests.support.partner_harness import running_partner_shell
from tests.support.browser_harness import SiteBrowser
from tests.e2e.test_partner_shell import install_partner_fixture, PARTNER


def test_static_worker_cold_reload_recovers_only_local_drafts_and_logout_clears_cache():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;install_partner_fixture(page)
        page.goto(origin)
        page.get_by_role('heading',name='Hello, Synthetic Partner.',exact=True).wait_for()
        page.wait_for_function("() => !!navigator.serviceWorker.controller")
        assert page.evaluate("async()=> (await caches.keys()).includes('partner-shell-v7')")
        assert page.evaluate("async()=>!!(await caches.match('/assets/statements.js'))")
        page.evaluate("""async accountId=>{
            const {createVisitDraftStore}=await import('/assets/drafts.js');
            const store=createVisitDraftStore({storage:localStorage,accountId});
            store.prepare({gigId:'20000000-1000-4000-8000-100000000001',expectedGigRevision:2});
            store.save({gigId:'20000000-1000-4000-8000-100000000001',expectedGigRevision:2,businessName:'Offline synthetic business',approximateArea:'Tulsa',outcome:'unavailable',placement:'none',sampleCount:0,visitedAt:'2026-10-24T12:00:00Z'});
        }""",PARTNER['id'])
        page.unroute('**/api/partner/v1/**')
        page.context.set_offline(True)
        page.goto(origin+'/drafts')
        page.get_by_role('heading',name='This device, offline',exact=True).wait_for()
        assert page.get_by_role('navigation').is_hidden()
        page.get_by_label('Account code for device drafts',exact=True).fill(PARTNER['id'])
        page.get_by_role('button',name='Open device drafts',exact=True).click()
        page.get_by_text('Offline synthetic business',exact=True).wait_for()
        assert page.get_by_role('button',name='Send pending business drafts',exact=True).is_disabled()
        page.get_by_role('button',name='Record another business visit',exact=True).click()
        page.get_by_label('Business name',exact=True).fill('Second offline business')
        assert page.locator('#visit-consent').is_disabled()
        page.locator('#device-permission').check()
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.reload()
        page.get_by_role('heading',name='This device, offline',exact=True).wait_for()
        page.context.set_offline(False)
        install_partner_fixture(page)
        page.goto(origin)
        page.get_by_role('heading',name='Hello, Synthetic Partner.',exact=True).wait_for()
        cached=page.evaluate("""async()=>{const rows=[];for(const name of await caches.keys()){const cache=await caches.open(name);for(const r of await cache.keys())rows.push([r.url,await(await cache.match(r)).text()]);}return rows;}""")
        assert all('/api/' not in url for url,_ in cached)
        assert all('Offline synthetic business' not in body and 'synthetic-memory-only' not in body and PARTNER['id'] not in body for _,body in cached)
        page.get_by_role('button',name='Sign out',exact=True).click()
        page.get_by_text('Signed out.',exact=True).wait_for()
        assert page.evaluate("async()=>!(await caches.keys()).some(k=>k.startsWith('partner-shell-'))")
        assert page.evaluate("!Object.keys(localStorage).some(k=>k.startsWith('3dp-partner-'))")


def test_worker_migrates_only_its_own_static_cache_and_ignores_unknown_routes():
    with running_partner_shell() as origin,SiteBrowser() as site:
        page=site.page
        page.route(origin+'/',lambda route:route.fulfill(content_type='text/html',body='<!doctype html><title>Previous shell</title>'))
        page.goto(origin)
        page.evaluate("""async()=>{await(await caches.open('partner-shell-old')).put('/obsolete.js',new Response('obsolete'));await(await caches.open('unrelated-app')).put('/unrelated',new Response('keep'));}""")
        page.unroute(origin+'/')
        page.evaluate("async()=>{await navigator.serviceWorker.register('/sw.js');}")
        page.wait_for_function('()=>!!navigator.serviceWorker.controller',timeout=5000)
        assert page.evaluate("async()=>!(await caches.keys()).includes('partner-shell-old')&&(await caches.keys()).includes('unrelated-app')")
        page.goto(origin+'/unknown-private-path')
        assert 'Not found.' in page.locator('body').inner_text()
        page.goto(origin+'/help')
        page.get_by_role('heading',name='Help & privacy',exact=True).wait_for()
        page.evaluate("async()=>{await fetch('/assets/partner.js?private-query=excluded');await fetch('/api/not-a-static-route',{method:'POST',body:'private-post'});}")
        entries=page.evaluate("async()=> (await(await caches.open('partner-shell-v7')).keys()).map(r=>r.url)")
        assert all('private-query' not in url and '/api/' not in url and 'unknown-private-path' not in url for url in entries)


def test_sign_out_clears_another_open_tab_private_view():
    with running_partner_shell() as origin,SiteBrowser() as site:
        first=site.page;install_partner_fixture(first);first.goto(origin)
        first.get_by_role('heading',name='Hello, Synthetic Partner.',exact=True).wait_for()
        second=site.context.new_page();install_partner_fixture(second);second.goto(origin+'/agreements')
        second.get_by_role('heading',name='Your agreements',exact=True).wait_for()
        first.get_by_role('button',name='Sign out',exact=True).click()
        first.get_by_text('Signed out.',exact=True).wait_for()
        second.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        assert 'Issued synthetic text' not in second.locator('body').inner_text()


def test_preparation_does_not_claim_offline_reload_when_worker_is_unavailable():
    from tests.e2e.test_partner_visits import visit_fixture,GIG
    with running_partner_shell() as origin,SiteBrowser() as site:
        site.context.add_init_script('delete Object.getPrototypeOf(navigator).serviceWorker;')
        page=site.page;visit_fixture(page);page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_role('button',name='Prepare this gig for offline business drafts',exact=True).click()
        page.get_by_text('Offline reload is unavailable in this browser. Keep this page open to save business drafts.',exact=True).wait_for(timeout=3000)
        assert page.evaluate("!Object.keys(localStorage).some(k=>k.startsWith('3dp-partner-preparation-'))")


def test_preparing_again_preserves_the_active_release_static_set():
    with running_partner_shell() as origin,SiteBrowser() as site:
        page=site.page;page.goto(origin+'/help')
        page.wait_for_function('()=>!!navigator.serviceWorker.controller')
        value=page.evaluate("""async()=>{const cache=await caches.open('partner-shell-v7');await cache.put('/assets/partner.js',new Response('/* active release fixture */'));const {prepareOfflineShell}=await import('/assets/pwa.js');await prepareOfflineShell();return(await cache.match('/assets/partner.js')).text();}""")
        assert value=='/* active release fixture */'
