"""The reader runs from a local file with networking disabled; native roundtrip is separate."""
import json
import subprocess
from tests.support.server import ROOT
from tests.support.browser_harness import SiteBrowser

def offline_review_fixture():
    return json.loads(subprocess.run(['node','tests/support/offline-review-fixture.mjs'],cwd=ROOT,check=True,capture_output=True,text=True,timeout=15).stdout)

def unlock_fixture(page,fixture):
    form=page.locator('#unlock')
    form.get_by_label('Encrypted review file',exact=True).set_input_files({'name':'synthetic.3dpreview','mimeType':'application/json','buffer':json.dumps(fixture['envelope']).encode()})
    form.get_by_label('Review passphrase',exact=True).fill(fixture['passphrase'])
    form.get_by_label('Independently trusted signing fingerprint',exact=True).fill(fixture['fingerprint'])
    form.get_by_role('button',name='Unlock and verify locally',exact=True).click()
    page.get_by_role('heading',name='Verified professional review package',exact=True).wait_for()

def test_offline_reader_verifies_and_clears_on_concealment_without_requests():
    fixture=offline_review_fixture()
    with SiteBrowser(viewport=(320,844),color_scheme='dark',reduced_motion='reduce') as site:
        page=site.page;site.context.set_offline(True);requests=[];page.on('request',lambda request:requests.append(request.url))
        page.goto((ROOT/'operator'/'review-reader.html').as_uri());unlock_fixture(page,fixture)
        assert page.locator('#result a').count()==3
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert fixture['passphrase'] not in page.locator('body').inner_text()
        page.evaluate("() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}")
        assert page.locator('#result a').count()==0 and page.locator('#result').is_hidden()
        assert not [url for url in requests if url.startswith(('http:','https:'))]
        assert not site.page_errors
