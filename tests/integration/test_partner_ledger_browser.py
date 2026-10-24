"""Direct native accounting boundaries; fixtures never represent real gifts or transfers."""
import csv
import io
import subprocess
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig
from tests.integration.test_partner_consent_referral_browser import database
from tests.integration.test_partner_statement_browser import sign_in


def download_accounting(w,basis):
    owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#finance')
    owner.get_by_role('heading',name='Partner finance',exact=True).wait_for()
    form=owner.locator('[data-finance-export]')
    form.get_by_role('combobox',name='Program',exact=True).select_option(w['programId'])
    form.get_by_role('combobox',name='Accounting basis',exact=True).select_option(basis)
    with owner.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/operator-partners')) as pending:
        form.get_by_role('button',name='Create incremental CSV batch',exact=True).click()
    assert pending.value.status==200
    batch=pending.value.json()
    assert batch['providerMode']=='manual_csv' and batch['providerImportVerified'] is False
    owner.get_by_role('heading',name='Accounting export',exact=True).wait_for()
    with owner.expect_download() as pending:
        owner.get_by_role('link',name='Download verified CSV',exact=True).click()
    content=pending.value.path().read_bytes().decode('utf-8')
    assert content==batch['csv']
    return batch,list(csv.DictReader(io.StringIO(content)))


def test_native_separate_personal_gift_is_absent_from_partner_statement_and_contractor_exports():
    with reviewed_budget_workspace(statement_jobs=True,observe_outbound=True) as w:
        gig=w['offer'](5000);w['accept'](gig);payable=finish_gig(w,gig)
        # A disposable stand-in for separate owner books, deliberately inaccessible
        # to the application role. This is not a production bookkeeping integration.
        partner=w['accounts'][0]['id']
        setup="CREATE SCHEMA synthetic_owner_books; REVOKE ALL ON SCHEMA synthetic_owner_books FROM PUBLIC; CREATE TABLE synthetic_owner_books.personal_gifts(recipient uuid,amount_cents integer,reference text); INSERT INTO synthetic_owner_books.personal_gifts VALUES('"+partner+"',20000,'SYNTHETIC-UNCONDITIONAL-BIKE-GIFT');"
        subprocess.run(['docker','exec',w['fixture']['_container'],'psql','-U','postgres','-v','ON_ERROR_STOP=1','-q','-c',setup],check=True,capture_output=True,text=True,timeout=15)
        proof=database(w,"SELECT json_build_object('amount',(SELECT amount_cents FROM synthetic_owner_books.personal_gifts),'backendAccess',has_schema_privilege('platform_app','synthetic_owner_books','USAGE'))")
        assert proof=={'amount':20000,'backendAccess':False}
        w['post']('payment.record',{'payableId':payable['id'],'amountCents':5000,'paymentReference':'SYNTHETIC-CONTRACTOR-NOT-ACTUAL-PAYMENT','method':'bank_transfer','occurredAt':'2026-10-26T12:00:00Z','verified':True})
        schedule=next(s for s in w['read']('statements')['schedules'] if s['programId']==w['programId'])
        w['post']('statement.schedule',{'programId':w['programId'],'expectedRevision':schedule['revision'],'enabled':True})
        w['fixture']['setClock']('2026-11-02T12:00:00Z');assert w['fixture']['runStatementJob']()['generated']==2
        sign_in(w,0);page=w['pages'][0];page.goto(w['origin']+'/earnings')
        with page.expect_download() as pending:
            page.get_by_role('button',name='Download statement for 2026-11-02',exact=True).click()
        statement=pending.value.path().read_text(encoding='utf-8');rows=list(csv.DictReader(io.StringIO(statement)))
        assert len(rows)==1 and rows[0]['record_id']==payable['id']
        assert rows[0]['amount_due_cents']=='5000' and rows[0]['paid_cents']=='5000' and rows[0]['outstanding_cents']=='0'
        for basis in ['cash','accrual']:
            batch,rows=download_accounting(w,basis)
            assert batch['recordCount']==1 and sum(int(r['amount_cents']) for r in rows)==5000
            assert all(r['partner_internal_id']==partner and r['tax_reporting_class']=='review_required' for r in rows)
            assert '20000' not in batch['csv'] and 'BIKE-GIFT' not in batch['csv']
        assert 'BIKE-GIFT' not in statement
        assert database(w,"SELECT json_build_object('amount',sum(amount_cents),'count',count(*)) FROM synthetic_owner_books.personal_gifts")=={'amount':20000,'count':1}
        assert w['fixture']['outboundAttempts']()==0


def test_native_unconfigured_invoice_ninja_preserves_durable_payable_and_manual_csv_without_customer_invoice():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        assert w['fixture']['invoiceNinjaConfigured'] is False
        before=database(w,"SELECT json_build_object('invoices',(SELECT count(*) FROM invoice_operations))")
        gig=w['offer'](5000);w['accept'](gig);payable=finish_gig(w,gig)
        page=w['pages'][0];page.goto(w['origin']+'/earnings')
        page.get_by_role('heading',name='Your earnings',exact=True).wait_for()
        earnings=page.evaluate("async api=>(await(await fetch(api+'/api/partner/v1/earnings',{credentials:'include'})).json())",w['fixture']['apiOrigin'])
        assert earnings['totals']['outstandingCents']==5000 and earnings['totals']['paidCents']==0
        assert next(p for p in earnings['items'] if p['id']==payable['id'])['amountDueCents']==5000
        batch,rows=download_accounting(w,'accrual')
        assert len(rows)==1 and rows[0]['amount_cents']=='5000' and rows[0]['payment_status']=='not_a_payment'
        w['owner'].reload();w['owner'].get_by_role('link',name='Download verified CSV',exact=True).wait_for()
        reopened=w['read']('export',batch['batchId'])
        assert {key:reopened[key] for key in batch}==batch
        with w['owner'].expect_download() as pending:
            w['owner'].get_by_role('link',name='Download verified CSV',exact=True).click()
        assert pending.value.path().read_bytes()==batch['csv'].encode('utf-8')
        assert next(p for p in w['read']('ledger')['items'] if p['id']==payable['id'])==payable
        assert database(w,"SELECT json_build_object('invoices',(SELECT count(*) FROM invoice_operations))")==before=={'invoices':0}
        assert w['fixture']['outboundAttempts']()==0
