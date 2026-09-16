import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

from tests.support.browser_harness import SITE_ROOT, SYSTEM_CHROMIUM_PATH


def test_returning_browser_gets_matching_modules_and_working_theme_after_deploy():
    """Exercise the real HTTP cache, which the inline test harness cannot cover."""
    prior_release = True
    requested = []
    assets = ["/" + path.relative_to(SITE_ROOT).as_posix()
              for path in SITE_ROOT.rglob('*') if path.suffix in ('.js', '.css')]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = urlsplit(self.path).path
            requested.append((prior_release, self.path))
            if path == '/':
                path = '/index.html'
            file = SITE_ROOT / path.lstrip('/')
            if prior_release and path == '/index.html':
                data = ("<!doctype html><button id='theme-button'>Old theme</button><script>"
                        f"Promise.all({json.dumps(assets)}.map(url => fetch(url).then(r => r.text())))"
                        ".then(() => document.title = 'Cached previous release');</script>").encode()
            elif prior_release and path.endswith('.js'):
                data = b"document.querySelector('#removed-control').addEventListener('click', () => {});"
            elif prior_release and path.endswith('.css'):
                data = b'body { pointer-events: none; background: red !important; }'
            else:
                data = file.read_bytes() if file.is_file() else None
            self.send_response(200 if data else 404)
            self.send_header('Content-Type', 'text/javascript' if path.endswith('.js') else mimetypes.guess_type(path)[0] or 'application/octet-stream')
            self.send_header('Cache-Control', 'public, max-age=3600' if path.startswith('/assets/') else 'no-store')
            self.end_headers()
            if data:
                self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            options = {'headless': True, 'args': ['--no-sandbox']}
            if SYSTEM_CHROMIUM_PATH.is_file():
                options['executable_path'] = str(SYSTEM_CHROMIUM_PATH)
            browser = p.chromium.launch(**options)
            page = browser.new_page(viewport={'width': 390, 'height': 844}, color_scheme='light')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            origin = f'http://127.0.0.1:{server.server_port}'
            page.goto(origin)
            page.wait_for_function("document.title === 'Cached previous release'")
            prior_release = False
            page.goto(origin)
            page.locator('#theme-toggle').wait_for(timeout=5000)
            assert not errors, errors
            assert page.evaluate('getComputedStyle(document.body).pointerEvents') == 'auto'
            background = lambda: page.evaluate('getComputedStyle(document.body).backgroundColor')
            assert background() == 'rgb(243, 246, 250)'
            page.emulate_media(color_scheme='dark')
            assert background() == 'rgb(16, 25, 35)'
            page.locator('#theme-toggle').click()  # explicit light overrides a dark OS
            assert background() == 'rgb(243, 246, 250)'
            page.reload()
            page.locator('#theme-toggle').wait_for()
            assert background() == 'rgb(243, 246, 250)'
            page.locator('#theme-toggle').click()  # explicit dark overrides a light OS
            page.emulate_media(color_scheme='light')
            assert background() == 'rgb(16, 25, 35)'
            page.locator('#theme-toggle').click()  # system resumes live OS tracking
            assert background() == 'rgb(243, 246, 250)'
            page.locator('.hero-project').click()
            assert page.locator('#project-dialog').is_visible()
            page.keyboard.press('Escape')
            page.locator('#menu-toggle').click()
            page.locator('#mobile-panel [data-ask]').click()
            assert page.locator('#ask-dialog').is_visible()
            page.locator('#toggle-reference').click()
            assert page.locator('#ask-reference').is_visible()
            page.keyboard.press('Escape')
            for service in ['print', 'design', 'repair', 'consult']:
                page.goto(f'{origin}/order.html?service={service}')
                page.locator('#next-button').click()
                assert page.locator('#project-title').is_visible()
            assert not errors, errors
            # The upgraded document must fetch new URLs for its whole dependency graph.
            new_assets = [url for old, url in requested if not old and url.startswith('/assets/') and urlsplit(url).path.endswith(('.js', '.css'))]
            assert new_assets and all('?v=' in url for url in new_assets)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
