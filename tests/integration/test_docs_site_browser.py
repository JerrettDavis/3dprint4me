"""Rendered handbook checks on the exact GitHub Pages URL prefix."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import pytest
from tests.support.browser_harness import SiteBrowser, ROOT

@pytest.fixture(scope='module')
def handbook():
    class Handler(SimpleHTTPRequestHandler):
        def translate_path(self, path):
            return super().translate_path(path.removeprefix('/3dprint4me'))
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT/'public/handbook')))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}/3dprint4me'
    server.shutdown(); server.server_close(); thread.join()

@pytest.mark.parametrize('width,theme,motion', [(390,'dark','reduce'), (1440,'light','no-preference')])
def test_handbook_navigation_search_themes_and_images(handbook, width, theme, motion):
    output = ROOT/'docs-site/verification'
    output.mkdir(exist_ok=True)
    with SiteBrowser(viewport=(width,960),color_scheme=theme,reduced_motion=motion) as site:
        page=site.page
        failures=[];external=[]
        page.on("response",lambda r: failures.append((r.status,r.url)) if r.status>=400 else None)
        page.on("request",lambda r: external.append(r.url) if not r.url.startswith(handbook) else None)
        page.goto(handbook+'/',wait_until='networkidle')
        assert page.locator('article h1').inner_text().startswith('From first idea to finished work')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.keyboard.press('Tab')
        assert page.locator(':focus').count()==1
        assert page.locator(':focus').evaluate('(n)=>getComputedStyle(n).outlineStyle')!='none'
        page.keyboard.press('Tab')
        page.screenshot(path=str(output/f'home-{width}-{theme}.png'),full_page=True,animations='disabled')
        if width==390:
            page.locator('header label[for="__drawer"]').click()
            page.get_by_role('navigation',name='Navigation').first.get_by_role('link',name='Getting started',exact=True).click()
        else:
            page.get_by_role('link',name='Getting started',exact=True).first.click()
        assert page.locator('article h1').inner_text().startswith('Getting started')
        page.goto(handbook+'/guides/partner/',wait_until='networkidle')
        page.locator('article img').first.wait_for()
        assert page.locator('article img').evaluate_all('(images)=>images.length>=5&&images.every(i=>i.complete&&i.naturalWidth>0)')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(output/f'partner-{width}-{theme}.png'),full_page=True,animations='disabled')
        initial=page.locator('body').get_attribute('data-md-color-scheme')
        for _ in range(3):
            page.locator('[data-md-component="palette"] label:visible').click()
            if page.locator('body').get_attribute('data-md-color-scheme')!=initial:break
        assert page.locator('body').get_attribute('data-md-color-scheme')!=initial
        if width==390:page.locator('header .md-header__button[for="__search"]').click()
        page.locator('.md-search__input').fill('offline')
        page.locator('.md-search-result__item').first.wait_for(timeout=20000)
        assert page.locator('.md-search-result__item').count()>0
        page.keyboard.press('Escape')
        page.goto(handbook+'/reference/partner-qa/flows/QA-060/',wait_until='networkidle')
        assert page.locator('article img').evaluate_all('(images)=>images.length===28&&images.every(i=>i.complete&&i.naturalWidth>0)')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(output/f'bdd-qa060-{width}-{theme}.png'),full_page=True,animations='disabled')
        assert not failures,failures
        assert not external,external
        site.assert_no_page_errors()
