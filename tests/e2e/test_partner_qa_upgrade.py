"""Upgrade the old live worker on the same origin before entering new QA routes."""
from contextlib import contextmanager
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
import json
import mimetypes
import subprocess
import tarfile
import threading
import pytest
from playwright.sync_api import expect
from tests.support.browser_harness import ROOT, SiteBrowser


@lru_cache(maxsize=1)
def old_assets():
    data=subprocess.run(['git','archive','43e60ab6d69a8c4a2e408c73d4423bf6d16d21b5','operator','partner'],cwd=ROOT,check=True,capture_output=True).stdout
    with tarfile.open(fileobj=BytesIO(data)) as archive:return {m.name:archive.extractfile(m).read() for m in archive if m.isfile()}


@contextmanager
def upgrade_origin(kind):
    state={'current':False,'requests':[]};old=old_assets();folder='partner/public' if kind=='partner' else 'operator'
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            path=self.path.split('?')[0];body=None;content_type='text/html; charset=utf-8';status=200
            origin='http://127.0.0.1:'+str(self.server.server_port)
            if path=='/upgrade-setup':body=b'<!doctype html><title>Previous installation</title>'
            elif path in ['/api/config','/config.json']:
                content_type='application/json';body=json.dumps({'apiBase':origin,'apiOrigin':origin,'authProvider':'github'}).encode()
            elif path.startswith('/api/'):
                state['requests'].append(path);content_type='application/json';status=401;body=b'{"error":"Sign in required"}'
            else:
                if kind=='partner' and (path=='/qa' or path.startswith('/qa/')):name='qa.html' if (ROOT/folder/'qa.html').exists() else 'index.html'
                elif kind=='operator' and path=='/partners/qa':name='partners-qa.html' if (ROOT/folder/'partners-qa.html').exists() else 'partners.html'
                else:name='index.html' if path=='/' else 'partners.html' if path=='/partners' else path.lstrip('/')
                if state['current']:
                    file=ROOT/folder/name
                    if file.is_file():body=file.read_bytes()
                else:body=old.get(folder+'/'+name)
                content_type=mimetypes.guess_type(name)[0] or 'application/octet-stream'
                if name.endswith('.js'):content_type='text/javascript'
            if body is None:status=404;body=b'Not found'
            self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield 'http://127.0.0.1:'+str(server.server_port),state
    finally:server.shutdown();server.server_close();thread.join()


@pytest.mark.parametrize('kind',['partner','operator'])
def test_old_live_worker_cannot_boot_live_api_at_new_qa_url(kind):
    with upgrade_origin(kind) as (origin,state),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;page.goto(origin+'/upgrade-setup')
        page.evaluate("async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;}")
        page.wait_for_function('()=>!!navigator.serviceWorker.controller')
        state['current']=True;state['requests'].clear()
        page.goto(origin+('/qa/join' if kind=='partner' else '/partners/qa'))
        expect(page.get_by_text('QA only — representative stubs',exact=True)).to_be_visible(timeout=5000)
        expected='/api/partner-qa/v1/session' if kind=='partner' else '/api/operator-partner-qa'
        page.wait_for_timeout(500)
        assert expected in state['requests'],state['requests']
        assert not any(p.startswith('/api/partner/v1/') or p=='/api/operator-partners' for p in state['requests']),state['requests']
        if kind=='partner':
            page.keyboard.press('Tab')
            expect(page.get_by_role('link',name='Skip to content',exact=True)).to_be_focused()
            page.keyboard.press('Enter')
            assert page.locator('main').evaluate('(node)=>document.activeElement===node')
