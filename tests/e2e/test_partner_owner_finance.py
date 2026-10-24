"""Private owner finance presentation; native tests prove durable ledger effects."""
import hashlib
import json
from urllib.parse import urlparse,parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture,PROGRAM
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser

PARTNER='60000000-1000-4000-8000-100000000001'
PAYABLE='60000000-1000-4000-8000-100000000002'
PAYMENT='60000000-1000-4000-8000-100000000003'
GIG='60000000-1000-4000-8000-100000000004'
BATCH='60000000-1000-4000-8000-100000000005'
STAMP='2026-10-24T08:00:00.000Z'
CSV='record_id,amount_cents\r\nsynthetic-record,4000\r\n'

def install_finance_fixture(page,*,bad_hash=False):
    install_owner_fixture(page);commands=[]
    ledger={'items':[{'id':PAYABLE,'partnerId':PARTNER,'gigId':GIG,'programId':PROGRAM,'baseCents':5000,'adjustmentCents':0,'amountDueCents':5000,'paidCents':2000,'outstandingCents':3000,'overpaidCents':0,'status':'part_paid','occurredAt':STAMP}],
            'totals':{'obligationCents':5000,'paidCents':2000,'outstandingCents':3000,'unfundedObligationCents':1000,'authorizedMaximumCents':4000,'offeredCents':0,'committedCents':5000,'earnedBonusCents':0,'contingentBonusCents':0},
            'paymentEvents':[{'id':PAYMENT,'payable_id':PAYABLE,'event_type':'settled','amount_cents':2000,'payment_reference':'PRIVATE-SYNTHETIC-BANK','payment_method':'bank_transfer','occurred_at':STAMP,'reverses_event_id':None}],
            'adjustments':[],'manualPaymentsOnly':True}
    exported={'batchId':BATCH,'basis':'cash','recordCount':1,'csv':CSV,'sha256':'0'*64 if bad_hash else hashlib.sha256(CSV.encode()).hexdigest(),'filename':'partner-accounting-'+BATCH+'.csv','providerMode':'manual_csv','providerImportVerified':False}
    def handle(route):
        if route.request.method=='POST':
            command=route.request.post_data_json;commands.append(command)
            result=exported if command['action']=='finance.export' else {'id':'synthetic-result'}
        else:
            resource=parse_qs(urlparse(route.request.url).query).get('resource',[''])[0]
            result=ledger if resource=='ledger' else {'items':[{'id':PARTNER,'display_name':'Synthetic finance partner'}]} if resource=='partners' else {'items':[{'id':GIG,'partnerId':PARTNER,'status':'cancellation_requested','revision':3,'feeCents':5000,'acceptedAt':STAMP,'terms':{'title':'Synthetic unsafe work'}}]} if resource=='gigs' else {'items':[{'id':BATCH,'programId':PROGRAM,'basis':'cash','from':None,'through':None,'generatedAt':STAMP,'recordCount':1}]} if resource=='exports' else exported if resource=='export' else None
            if result is None:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands


def test_owner_partial_payment_requires_actual_settlement_and_retries_same_key():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;install_finance_fixture(page)
        page.goto(origin+'/partners#finance')
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        assert 'Funding exception' in page.locator('main').inner_text()
        form=page.locator('[data-payment]')
        form.get_by_label('Settled payment (USD)',exact=True).fill('12.34')
        form.get_by_label('Payment reference',exact=True).fill('SYNTHETIC-PARTIAL-1')
        form.get_by_label('Settled at (ISO 8601 with timezone)',exact=True).fill(STAMP)
        form.get_by_label('I independently verified that this payment actually settled.',exact=True).check()
        pending=[];attempts=[]
        def hold(route):
            if route.request.method=='POST':attempts.append(route.request.post_data_json);pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',hold)
        form.get_by_role('button',name='Record verified payment',exact=True).click()
        page.wait_for_function("document.querySelector('[data-payment] button').disabled")
        assert form.get_by_label('Payment reference',exact=True).is_disabled()
        assert attempts[0]['input']=={'payableId':PAYABLE,'amountCents':1234,'paymentReference':'SYNTHETIC-PARTIAL-1','method':'bank_transfer','occurredAt':STAMP,'verified':True}
        pending.pop().abort()
        page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        form.get_by_role('button',name='Record verified payment',exact=True).click()
        page.wait_for_function("document.querySelector('[data-payment] button').disabled")
        assert attempts[0]==attempts[1]
        pending.pop().fulfill(status=200,content_type='application/json',body='{}')
        page.get_by_text('Verified payment recorded. Review the updated outstanding amount.',exact=True).wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert 'PRIVATE-SYNTHETIC-BANK' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')


def test_owner_reversal_adjustment_and_reconciliation_use_separate_evidence():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(320,844)) as site:
        page=site.page;commands=install_finance_fixture(page);page.goto(origin+'/partners#finance')
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        page.get_by_text('Record a confirmed returned transfer',exact=True).click()
        form=page.locator('[data-reversal]')
        form.get_by_label('Nonsettlement reference',exact=True).fill('SYNTHETIC-RETURN')
        form.get_by_label('Reversed at (ISO 8601 with timezone)',exact=True).fill(STAMP)
        form.get_by_label('Reversal reason',exact=True).fill('Bank confirmed returned transfer.')
        form.get_by_label('I verified nonsettlement or return of this original payment.',exact=True).check()
        form.get_by_role('button',name='Record payment reversal',exact=True).click()
        page.get_by_text('Reversal recorded. The original event remains in the ledger.',exact=True).wait_for()
        assert commands[-1]['input']=={'paymentId':PAYMENT,'paymentReference':'SYNTHETIC-RETURN','occurredAt':STAMP,'verifiedNotSettled':True,'reason':'Bank confirmed returned transfer.'}
        page.get_by_text('Record an evidenced obligation adjustment',exact=True).click()
        form=page.locator('[data-adjustment]')
        form.get_by_label('Adjustment (USD, positive or negative)',exact=True).fill('-5.25')
        form.get_by_label('Adjustment reason',exact=True).fill('External correction agreed.')
        form.get_by_label('Resolution reference',exact=True).fill('SYNTHETIC-RESOLUTION')
        for label in ['The partner acknowledged this resolution.','I verified the external resolution evidence.']:form.get_by_label(label,exact=True).check()
        form.get_by_role('button',name='Record obligation adjustment',exact=True).click()
        page.get_by_text('Adjustment recorded. Accepted terms and prior evidence are unchanged.',exact=True).wait_for()
        assert commands[-1]['input']=={'payableId':PAYABLE,'amountCents':-525,'reason':'External correction agreed.','resolutionReference':'SYNTHETIC-RESOLUTION','partnerAcknowledged':True,'verifiedResolution':True}
        page.get_by_text('Reconcile accepted work',exact=True).click()
        form=page.locator('[data-reconciliation]')
        form.get_by_label('Agreed obligation (USD)',exact=True).fill('0')
        form.get_by_label('Resolution reason',exact=True).fill('External safety cancellation resolution.')
        form.get_by_label('Resolution reference',exact=True).fill('SYNTHETIC-SAFETY')
        for label in ['The partner acknowledged this resolution.','I verified the external resolution evidence.']:form.get_by_label(label,exact=True).check()
        form.get_by_role('button',name='Record resolved obligation',exact=True).click()
        page.get_by_text('Resolution recorded. This does not confirm a payment.',exact=True).wait_for()
        assert commands[-1]['input']=={'gigId':GIG,'expectedRevision':3,'agreedCents':0,'reason':'External safety cancellation resolution.','resolutionReference':'SYNTHETIC-SAFETY','partnerAcknowledged':True,'verifiedResolution':True}
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_export_is_durable_hash_checked_download_and_cleared_on_navigation():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;commands=install_finance_fixture(page);page.goto(origin+'/partners#finance')
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        form=page.locator('[data-finance-export]')
        form.get_by_role('combobox',name='Accounting basis',exact=True).select_option('cash')
        form.get_by_label('From (Central date, optional)',exact=True).fill('2026-10-01')
        form.get_by_label('Through (Central date, optional)',exact=True).fill('2026-10-31')
        form.get_by_role('button',name='Create incremental CSV batch',exact=True).click()
        page.get_by_role('heading',name='Accounting export',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'basis':'cash','from':'2026-10-01','through':'2026-10-31'}
        assert 'Provider import is not verified' in page.locator('main').inner_text()
        link=page.get_by_role('link',name='Download verified CSV',exact=True)
        blob=link.get_attribute('href');assert blob.startswith('blob:')
        with page.expect_download() as event:link.click()
        assert event.value.suggested_filename=='partner-accounting-'+BATCH+'.csv'
        assert event.value.path().read_text()==CSV.replace('\r\n','\n')
        page.reload();page.get_by_role('link',name='Download verified CSV',exact=True).wait_for()
        blob=page.get_by_role('link',name='Download verified CSV',exact=True).get_attribute('href')
        page.get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        assert page.evaluate("async url=>{try{await fetch(url);return false;}catch{return true;}}",blob)
        assert 'record_id' not in page.locator('body').inner_text()


def test_owner_export_with_bad_hash_never_creates_a_download():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        install_finance_fixture(site.page,bad_hash=True)
        site.page.goto(origin+'/partners#finance/export/'+BATCH)
        site.page.get_by_role('heading',name='Unable to load partner records',exact=True).wait_for()
        assert 'CSV integrity check failed' in site.page.locator('main').inner_text()
        assert site.page.get_by_role('link',name='Download verified CSV',exact=True).count()==0


def test_owner_export_hash_completion_after_navigation_cannot_restore_private_download():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;install_finance_fixture(page)
        page.add_init_script("""const digest=crypto.subtle.digest.bind(crypto.subtle);window.financeUrls=[];
            const create=URL.createObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);financeUrls.push(url);return url;};
            crypto.subtle.digest=(algorithm,bytes)=>new Promise(resolve=>{window.finishFinanceHash=async()=>resolve(await digest(algorithm,bytes));});""")
        page.goto(origin+'/partners#finance/export/'+BATCH)
        page.wait_for_function('typeof window.finishFinanceHash === "function"')
        page.get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        page.evaluate('finishFinanceHash()')
        page.wait_for_timeout(50)
        assert page.get_by_role('heading',name='Partner audit',exact=True).is_visible()
        assert page.get_by_role('link',name='Download verified CSV',exact=True).count()==0
        assert page.evaluate('financeUrls.length')==0


def test_owner_finance_denial_clears_private_references_and_pending_payment():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;install_finance_fixture(page);page.goto(origin+'/partners#finance')
        page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        def deny(route):
            if route.request.method=='POST':route.fulfill(status=403,content_type='text/plain',body='denied')
            else:route.fallback()
        page.route('**/api/operator-partners*',deny)
        form=page.locator('[data-payment]')
        form.get_by_label('Settled payment (USD)',exact=True).fill('10.00')
        form.get_by_label('Payment reference',exact=True).fill('PRIVATE-SYNTHETIC-PENDING')
        form.get_by_label('Settled at (ISO 8601 with timezone)',exact=True).fill(STAMP)
        form.get_by_label('I independently verified that this payment actually settled.',exact=True).check()
        form.get_by_role('button',name='Record verified payment',exact=True).click()
        page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert 'PRIVATE-SYNTHETIC' not in page.locator('body').inner_text()
        assert page.locator('main input, main form').count()==0
