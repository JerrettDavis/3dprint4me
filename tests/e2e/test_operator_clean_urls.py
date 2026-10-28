"""Real service-worker navigation through the production clean-URL redirects."""
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from tests.support.browser_harness import SiteBrowser

ROOT = Path(__file__).resolve().parents[2]


@contextmanager
def clean_url_operator():
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT/'operator'), **kwargs)

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.endswith('.html'):
                self.send_response(308)
                self.send_header('Location', '/' if path == '/index.html' else path[:-5])
                self.end_headers()
                return
            if path.startswith('/api/'):
                self.send_response(200 if path == '/api/config' else 401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'apiBase': self.origin, 'authBase': None}
                    if path == '/api/config' else {'error': 'Sign in required.'}).encode())
                return
            if path in ('/partners', '/review-reader'):
                self.path = path + '.html'
            super().do_GET()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Handler.origin = f'http://127.0.0.1:{server.server_port}'
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield Handler.origin
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_operator_cached_html_redirects_remain_navigable_online_and_offline():
    with clean_url_operator() as origin, SiteBrowser() as site:
        page = site.page
        page.goto(origin + '/')
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        # The public host redirects these paths. Cache.addAll follows redirects;
        # a redirected cached Response cannot satisfy a manual navigation fetch.
        page.goto(origin + '/partners.html')
        assert page.locator('#owner-content').count() == 1
        site.context.set_offline(True)
        for route, expected in [('/partners.html', '#owner-content'),
                                ('/review-reader.html', 'h1'),
                                ('/index.html', '#workspace')]:
            page.goto(origin + route)
            assert page.locator(expected).count() >= 1
