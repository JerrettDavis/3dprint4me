"""Professional review UI fixtures; native tests exercise actual signed packages."""
import base64
import hashlib
import json
from urllib.parse import urlparse, parse_qs
from tests.e2e.test_partner_owner import PROGRAM
from tests.e2e.test_partner_owner_legal import install_legal_fixture, VERSION
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser

PACKAGE='71000000-1000-4000-8000-100000000001'
FEEDBACK='71000000-1000-4000-8000-100000000002'
REVIEWER='Synthetic counsel <script>unsafe()</script>'
IDENTITY='I verified the reviewer identity and this decision through the agreed private channel.'
ZIP_BYTES=b'synthetic private ZIP fixture'
DOCX_BYTES=b'synthetic private DOCX fixture'

def review_fixture(page, *, corrupt=False, archive=ZIP_BYTES):
    commands=install_legal_fixture(page)
    manifest={'schemaVersion':1,'private':True,'packageId':PACKAGE,'programId':PROGRAM,'createdAt':'2026-10-24T10:00:00.000Z','expiresAt':'2026-11-01T10:00:00.000Z','publicKeyFingerprint':'c'*64,
              'versions':[VERSION],'documents':[{'versionId':VERSION,'title':'Services terms','sourceHash':'a'*64,'versionNo':2}],
              'reviewers':[{'name':REVIEWER,'role':'attorney','scopes':['agreement_language','classification']},{'name':'Synthetic accountant','role':'cpa','scopes':['accounting']}]}
    def handle(route):
        if route.request.method=='POST':
            command=route.request.post_data_json
            if command['action'] not in ['legal.export_package','legal.record_review','legal.import_feedback']:route.fallback();return
            commands.append(command)
            result={'id':FEEDBACK if command['action']=='legal.import_feedback' else PACKAGE}
        else:
            q=parse_qs(urlparse(route.request.url).query);resource=q.get('resource',[''])[0]
            if resource=='review-package':result={'id':PACKAGE,'filename':'review-'+PACKAGE+'.zip','contentType':'application/zip','sha256':'0'*64 if corrupt else hashlib.sha256(archive).hexdigest(),'data':base64.b64encode(archive).decode(),'manifest':manifest,'publicKey':'Synthetic public verification key','signature':'synthetic','expiresAt':manifest['expiresAt']}
            elif resource=='review-feedback':result={'id':FEEDBACK,'filename':'feedback-'+FEEDBACK+'.docx','contentType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','sha256':hashlib.sha256(DOCX_BYTES).hexdigest(),'data':base64.b64encode(DOCX_BYTES).decode(),
              'evidence':{'packageId':PACKAGE,'programId':PROGRAM,'versionId':VERSION,'sourceHash':'a'*64,'reviewerName':REVIEWER,'reviewerRole':'attorney','grantedScopes':['agreement_language'],'identityConfirmedBy':'Synthetic owner','receivedAt':'2026-10-24T12:00:00Z','parsed':{'comments':[{'clauseAnchor':'IMS-04','authorClaim':'File author claim','text':'Proposed <img src=x onerror=unsafe()> concern'}],'changes':[{'kind':'insertion','clauseAnchor':'IMS-04','authorClaim':'File author claim','text':'Proposed fee language'}],'warnings':['Compare original attachment manually.']}}}
            else:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands


def test_owner_creates_bounded_named_package_without_approval():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands=review_fixture(page);page.goto(origin+'/partners#legal')
        page.get_by_text('Create professional review package',exact=True).click()
        form=page.locator('[data-review-package-create]')
        form.get_by_label('Services terms - revision 2',exact=True).check()
        form.get_by_role('button',name='Add named reviewer',exact=True).click()
        row=form.locator('[data-reviewer]');row.get_by_label('Reviewer name',exact=True).fill(REVIEWER)
        row.get_by_label('Agreement language',exact=True).check()
        row.get_by_label('Classification',exact=True).check()
        form.get_by_label('Grant expires at (ISO 8601 with timezone)',exact=True).fill('2026-11-01T10:00:00Z')
        form.get_by_label('Private factual brief and review questions',exact=True).fill('Synthetic private facts for this review only.')
        form.get_by_label('I checked redaction, private facts and permission to share this package.',exact=True).check()
        form.get_by_role('button',name='Create private signed package',exact=True).click()
        page.get_by_role('heading',name='Professional review package',exact=True).wait_for()
        body=commands[-1]['input'];assert commands[-1]['action']=='legal.export_package'
        assert body['versionIds']==[VERSION] and body['reviewers']==[{'name':REVIEWER,'role':'attorney','scopes':['agreement_language','classification']}]
        assert body['programId']==PROGRAM and body['redactionConfirmed'] is True
        assert 'Synthetic private facts' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.locator('main script').count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_records_only_an_explicit_granted_exact_hash_decision():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(320,844)) as site:
        page=site.page;commands=review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        form=page.locator('[data-record-review]')
        form.get_by_role('combobox',name='Reviewed source version',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Named reviewer and scope',exact=True).select_option('0')
        assert form.get_by_role('combobox',name='Professional decision',exact=True).input_value()==''
        form.get_by_role('combobox',name='Professional decision',exact=True).select_option('changes_requested')
        form.get_by_label('Evidence reference',exact=True).fill('SYNTHETIC-COUNSEL-RETURN-1')
        form.get_by_label('Reviewed at (ISO 8601 with timezone)',exact=True).fill('2026-10-24T11:00:00Z')
        form.get_by_label(IDENTITY,exact=True).check()
        form.get_by_role('button',name='Record professional decision',exact=True).click()
        page.get_by_text('Professional decision recorded for the exact source hash. This does not publish or issue a document.',exact=True).wait_for()
        body=commands[-1]['input'];assert body=={'programId':PROGRAM,'packageId':PACKAGE,'versionId':VERSION,'versionHash':'a'*64,'scope':'agreement_language','decision':'changes_requested','reviewerName':REVIEWER,'reviewerRole':'attorney','evidenceReference':'SYNTHETIC-COUNSEL-RETURN-1','reviewedAt':'2026-10-24T11:00:00Z'}
        assert page.locator('main script').count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_feedback_import_is_bounded_separate_from_source_and_approval():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands=review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        form=page.locator('[data-import-feedback]')
        form.get_by_role('combobox',name='Returned source version',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Returning named reviewer',exact=True).select_option('0')
        upload=form.get_by_label('Returned DOCX (up to 512 KiB)',exact=True)
        upload.set_input_files({'name':'too-large.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':b'x'*(512*1024+1)})
        form.get_by_label('I confirmed the returning reviewer identity through the agreed private channel.',exact=True).check()
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.get_by_text('Use a DOCX attachment up to 512 KiB.',exact=True).wait_for()
        assert commands==[]
        upload.set_input_files({'name':'private-return.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':DOCX_BYTES})
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.get_by_role('heading',name='Returned professional feedback',exact=True).wait_for()
        assert commands[-1]['action']=='legal.import_feedback'
        body=commands[-1]['input'];assert body['sourceHash']=='a'*64 and body['reviewerIdentityConfirmed'] is True
        assert base64.b64decode(body['data'])==DOCX_BYTES and 'filename' not in body
        assert page.get_by_text('Proposed <img src=x onerror=unsafe()> concern',exact=True).is_visible()
        assert page.locator('main img,main script').count()==0
        assert not any(c['action'] in ['legal.save','legal.record_review','legal.publish'] for c in commands)
        assert 'private-return' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')


def test_owner_corrupt_package_exposes_no_download_or_decision_form():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page,corrupt=True);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        page.get_by_text('Review package integrity check failed. Reopen the saved package.',exact=True).wait_for()
        assert page.locator('[data-package-download],[data-record-review],[data-import-feedback]').count()==0


def test_owner_private_download_is_revoked_on_route_and_signout():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        link=page.locator('[data-package-download]');link.wait_for()
        url=link.get_attribute('href');assert url.startswith('blob:')
        page.get_by_role('link',name='Audit',exact=True).click();page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        assert page.evaluate('async url=>{try {await fetch(url);return false;}catch{return true;}}',url)
        page.goto(origin+'/partners#legal/feedback/'+FEEDBACK)
        link=page.locator('[data-feedback-download]');link.wait_for();url=link.get_attribute('href')
        page.get_by_role('button',name='Sign out',exact=True).click()
        page.get_by_role('heading',name='Owner sign-in required',exact=True).wait_for()
        assert page.evaluate('async url=>{try {await fetch(url);return false;}catch{return true;}}',url)
        assert REVIEWER not in page.locator('body').inner_text()


def test_owner_late_attachment_read_never_posts_after_navigation():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;commands=review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        form=page.locator('[data-import-feedback]')
        form.get_by_role('combobox',name='Returned source version',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Returning named reviewer',exact=True).select_option('0')
        form.get_by_label('Returned DOCX (up to 512 KiB)',exact=True).set_input_files({'name':'private.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':DOCX_BYTES})
        form.get_by_label('I confirmed the returning reviewer identity through the agreed private channel.',exact=True).check()
        page.evaluate("() => {File.prototype.arrayBuffer=function(){return new Promise(resolve=>{window.finishAttachment=()=>resolve(new Uint8Array([1,2,3]).buffer);});};}")
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.wait_for_function("typeof window.finishAttachment==='function'")
        page.get_by_role('link',name='Audit',exact=True).click();page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        page.evaluate('window.finishAttachment()');page.wait_for_timeout(100)
        assert commands==[] and page.get_by_role('heading',name='Partner audit',exact=True).is_visible()


def test_owner_uncertain_decision_retry_keeps_exact_command_key_until_edit():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page);attempts=[]
        def lose(route):
            if route.request.method=='POST' and route.request.post_data_json['action']=='legal.record_review':
                attempts.append(route.request.post_data_json)
                if len(attempts)<3:route.abort()
                else:route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':PACKAGE}))
            else:route.fallback()
        page.route('**/api/operator-partners*',lose);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        form=page.locator('[data-record-review]')
        form.get_by_role('combobox',name='Reviewed source version',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Named reviewer and scope',exact=True).select_option('0')
        form.get_by_role('combobox',name='Professional decision',exact=True).select_option('conditional')
        form.get_by_label('Evidence reference',exact=True).fill('SYNTHETIC-RETURN')
        form.get_by_label('Reviewed at (ISO 8601 with timezone)',exact=True).fill('2026-10-24T11:00:00Z')
        form.get_by_label(IDENTITY,exact=True).check()
        button=form.get_by_role('button',name='Record professional decision',exact=True)
        for _ in range(2):
            button.click();page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        assert attempts[0]==attempts[1]
        form.get_by_label('Decision notes and conditions',exact=True).fill('Clarified condition after independent discussion.')
        button.click();page.get_by_text('Professional decision recorded for the exact source hash. This does not publish or issue a document.',exact=True).wait_for()
        assert attempts[2]['key']!=attempts[0]['key'] and attempts[2]['input']['notes']=='Clarified condition after independent discussion.'


def test_owner_verifies_a_package_at_the_eight_mib_archive_boundary():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page,archive=b'Z'*(8*1024*1024));page.goto(origin+'/partners#legal/package/'+PACKAGE)
        page.locator('[data-package-download]').wait_for(timeout=5000)
        assert not site.page_errors


def test_owner_concealment_during_hashing_cannot_restore_a_private_download():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page)
        page.add_init_script("""(() => {
            const digest=crypto.subtle.digest.bind(crypto.subtle);
            crypto.subtle.digest=async (...args)=>{const result=await digest(...args);return new Promise(resolve=>{window.finishHash=()=>resolve(result);});};
        })()""")
        page.goto(origin+'/partners#legal/package/'+PACKAGE)
        page.wait_for_function("typeof window.finishHash==='function'")
        page.evaluate("""() => {
            Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document,'hidden',{configurable:true,value:false});window.finishHash();
        }""")
        page.get_by_role('heading',name='Professional review package',exact=True).wait_for()
        assert page.locator('[data-package-download]').get_attribute('href') is None


def test_owner_encryption_never_sends_passphrase_and_concealment_cancels_pending_result():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands=review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        form=page.locator('[data-encrypt-review]');secret='Synthetic private handoff passphrase 2026!'
        page.evaluate("""() => {const encrypt=crypto.subtle.encrypt.bind(crypto.subtle);crypto.subtle.encrypt=async (...args)=>{const value=await encrypt(...args);return new Promise(resolve=>{window.finishEncryption=()=>resolve(value);});};}""")
        form.get_by_label('Handoff passphrase (20 to 1024 UTF-8 bytes)',exact=True).fill(secret)
        form.get_by_label('Repeat handoff passphrase',exact=True).fill(secret)
        form.get_by_label('I saved the passphrase separately and will share it through the agreed trusted channel.',exact=True).check()
        form.get_by_role('button',name='Encrypt package on this device',exact=True).click()
        page.wait_for_function("typeof window.finishEncryption==='function'")
        assert form.get_by_label('Handoff passphrase (20 to 1024 UTF-8 bytes)',exact=True).input_value()==''
        page.evaluate("""() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,value:false});window.finishEncryption();}""")
        page.wait_for_function("!document.querySelector('[data-encrypt-review] button[type=button]').disabled")
        assert page.locator('[data-encrypted-download]').is_hidden()
        assert commands==[] and secret not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_encrypted_feedback_uncertain_retry_reuses_decrypted_bytes_without_resending_password():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;review_fixture(page);page.goto(origin+'/partners#legal/package/'+PACKAGE)
        secret='Synthetic private return passphrase 2026!'
        envelope=page.evaluate("async ({secret,bytes})=>{const {encryptReviewArchive}=await import('/assets/review-envelope.js');return encryptReviewArchive(new Uint8Array(bytes),secret,'returned-docx');}",{'secret':secret,'bytes':list(DOCX_BYTES)})
        attempts=[]
        def lose(route):
            if route.request.method=='POST' and route.request.post_data_json['action']=='legal.import_feedback':
                attempts.append(route.request.post_data_json)
                if len(attempts)==1:route.abort()
                else:route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':FEEDBACK}))
            else:route.fallback()
        page.route('**/api/operator-partners*',lose)
        form=page.locator('[data-import-feedback]')
        form.get_by_role('combobox',name='Returned source version',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Returning named reviewer',exact=True).select_option('0')
        form.get_by_label('Returned DOCX (up to 512 KiB)',exact=True).set_input_files({'name':'private.3dpreview','mimeType':'application/json','buffer':json.dumps(envelope).encode()})
        form.get_by_label('Return passphrase (encrypted returns only)',exact=True).fill(secret)
        form.get_by_label('I confirmed the returning reviewer identity through the agreed private channel.',exact=True).check()
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        assert form.get_by_label('Return passphrase (encrypted returns only)',exact=True).input_value()==''
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.get_by_role('heading',name='Returned professional feedback',exact=True).wait_for()
        assert attempts[0]==attempts[1] and base64.b64decode(attempts[0]['input']['data'])==DOCX_BYTES
        assert secret not in json.dumps(attempts)
