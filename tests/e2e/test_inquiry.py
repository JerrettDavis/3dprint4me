from playwright.sync_api import expect
from tests.support.browser_harness import SiteBrowser


def open_inquiry(page):
    page.locator('.hero-actions [data-ask]').click()
    page.locator('#ask-message').fill('A replacement knob for my desk drawer')
    page.locator('#ask-email').fill('visitor@example.com')


def test_quick_inquiry_offline_is_recoverable_and_neutral():
    with SiteBrowser(viewport=(390, 844), color_scheme='dark') as site:
        page = site.load('/')
        open_inquiry(page)
        assert page.locator('#ask-intent').input_value() == 'unknown'
        page.locator('#save-inquiry').click()
        expect(page.locator('#success-pane')).to_be_visible()
        assert page.locator('#success-title').inner_text() == 'Your inquiry is ready to send'
        assert 'not received' in page.locator('#success-pane').inner_text().lower()
        assert 'mailto:' in page.locator('#email-inquiry').get_attribute('href')
        assert page.locator('#download-inquiry').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        site.assert_no_page_errors()


def test_quick_inquiry_rejection_keeps_editable_fields():
    with SiteBrowser() as site:
        page = site.load('/')
        open_inquiry(page)
        page.evaluate('window.fetch = async () => new Response(JSON.stringify({error:"Check your inquiry details."}), {status:400,headers:{"Content-Type":"application/json"}})')
        page.locator('#save-inquiry').click()
        expect(page.locator('#save-error')).to_be_visible()
        assert page.locator('#ask-message').input_value() == 'A replacement knob for my desk drawer'
        assert not page.locator('#success-pane').is_visible()
        site.assert_no_page_errors()


def test_gallery_context_and_keyboard_dialog():
    with SiteBrowser() as site:
        page = site.load('/')
        page.locator('[data-filter="electronics"]').click()
        assert page.locator('.work-card:visible').count() == 1
        page.locator('.work-card:visible').click()
        page.locator('#project-dialog [data-ask]').click()
        assert 'ESP32' in page.locator('#inquiry-context').inner_text()
        page.keyboard.press('Escape')
        assert not page.locator('#ask-dialog').is_visible()
        site.assert_no_page_errors()


def test_quick_inquiry_success_requires_server_completion():
    with SiteBrowser() as site:
        page = site.load('/')
        open_inquiry(page)
        page.evaluate('''() => { window.calls=[]; window.fetch=async (url,options)=>{
          window.calls.push(JSON.parse(options.body));
          return new Response(JSON.stringify(options.method==='POST' ? {id:'INQ-test',mode:'neon',live:false,uploads:[]} : {id:'INQ-test',live:true}), {status:200});
        }; }''')
        page.locator('#save-inquiry').click()
        expect(page.locator('#success-pane')).to_be_visible()
        assert page.locator('#success-title').inner_text() == 'Inquiry received'
        calls = page.evaluate('window.calls')
        assert len(calls) == 2
        assert calls[0]['inquiry']['intent'] == 'unknown'
        assert calls[1]['submissionKey'] == calls[0]['submissionKey']
        assert 'not email delivery' in page.locator('#success-note').inner_text()
        site.assert_no_page_errors()


def test_storage_denied_still_offers_email_and_download():
    with SiteBrowser() as site:
        page = site.load('/', storage_denied=True)
        open_inquiry(page)
        page.locator('#save-draft').click()
        assert 'could not save' in page.locator('#save-error').inner_text()
        page.locator('#save-inquiry').click()
        assert page.locator('#email-inquiry').is_visible()
        assert page.locator('#download-inquiry').is_visible()
        site.assert_no_page_errors()


def test_lost_completion_retries_same_key_without_false_confirmation():
    with SiteBrowser() as site:
        page = site.load('/')
        open_inquiry(page)
        page.evaluate('''() => { window.keys=[]; window.fetch=async (url,options)=>{
          if(options.method==='PATCH') throw new TypeError('lost response');
          window.keys.push(JSON.parse(options.body).submissionKey);
          return new Response(JSON.stringify({id:'INQ-test',mode:'neon',live:false,uploads:[]}), {status:200});
        }; }''')
        page.locator('#save-inquiry').click()
        expect(page.locator('#save-error')).to_be_visible()
        assert not page.locator('#success-pane').is_visible()
        page.locator('#save-inquiry').click()
        expect(page.locator('#save-error')).to_be_visible()
        keys = page.evaluate('window.keys')
        assert len(keys) == 2 and keys[0] == keys[1]
        site.assert_no_page_errors()


def test_replacement_file_with_same_metadata_starts_new_submission():
    with SiteBrowser() as site:
        page = site.load('/')
        open_inquiry(page)
        page.locator('#ask-files').set_input_files({'name':'part.txt','mimeType':'text/plain','buffer':b'old'})
        page.evaluate('''() => { window.keys=[]; window.fetch=async (url,options)=>{
          if(options.method==='PATCH') throw new TypeError('lost response');
          window.keys.push(JSON.parse(options.body).submissionKey);
          return new Response(JSON.stringify({id:'INQ-test',mode:'neon',live:false,uploads:[]}), {status:200});
        }; }''')
        page.locator('#save-inquiry').click()
        expect(page.locator('#save-error')).to_be_visible()
        page.get_by_role('button', name='Remove part.txt', exact=True).click()
        page.locator('#ask-files').set_input_files({'name':'part.txt','mimeType':'text/plain','buffer':b'new'})
        page.locator('#save-inquiry').click()
        expect(page.locator('#save-error')).to_be_visible()
        keys = page.evaluate('window.keys')
        assert len(keys)==2 and keys[0]!=keys[1]
        site.assert_no_page_errors()
