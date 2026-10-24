"""Owner schedule -> actual bounded job -> private native partner download."""
import hashlib
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig


def sign_in(w,index):
    page=w['pages'][index];page.goto(w['origin'])
    page.get_by_label('Account code',exact=True).fill(w['accounts'][index]['id'])
    page.get_by_label('Passphrase',exact=True).fill('Synthetic budget partner private passphrase')
    page.get_by_role('button',name='Sign in',exact=True).click()
    page.get_by_role('heading',name='Hello, Budget Partner '+str(index+1)+'.',exact=True).wait_for()


def test_native_owner_schedules_weekly_statements_and_partners_download_only_their_immutable_balances(tmp_path):
    with reviewed_budget_workspace(statement_jobs=True,observe_outbound=True) as w:
        gig=w['offer'](5000);w['accept'](gig);payable=finish_gig(w,gig)
        w['post']('payment.record',{'payableId':payable['id'],'amountCents':2000,'paymentReference':'SYNTHETIC-WEEKLY-NOT-ACTUAL-PAYMENT','method':'bank_transfer','occurredAt':'2026-10-26T12:00:00Z','verified':True})
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#statements')
        form=owner.locator('[data-statement-schedule="'+w['programId']+'"]')
        form.get_by_label('Schedule weekly statements',exact=True).check()
        form.get_by_role('button',name='Save statement schedule',exact=True).click()
        owner.get_by_text('Statement schedule saved. Existing snapshots are unchanged.',exact=True).wait_for()
        assert w['fixture']['runStatementJob']()['generated']==0
        # Stopping new offers must not suppress statements for existing debt.
        w['post']('program.configure',{'programId':w['programId'],'expectedRevision':3,'enabled':False,'weeklyCapCents':20000})
        w['fixture']['setClock']('2026-11-02T12:00:00Z')
        assert w['fixture']['runStatementJob']()['generated']==2
        sign_in(w,0);sign_in(w,1)
        records=w['read']('statements')['items'];assert len(records)==2
        own=next(s for s in records if s['partnerId']==w['accounts'][0]['id'])
        page=w['pages'][0];page.goto(w['origin']+'/earnings')
        with page.expect_download() as pending:
            page.get_by_role('button',name='Download statement for 2026-11-02',exact=True).click()
        target=tmp_path/'native-weekly.csv';pending.value.save_as(target);original=target.read_bytes()
        assert b',5000,2000,3000,' in original
        assert b'SYNTHETIC-WEEKLY' not in original
        assert hashlib.sha256(original).hexdigest()==own['sha256']
        denied=w['pages'][1].evaluate("async ({api,id})=>{const r=await fetch(api+'/api/partner/v1/statements?'+new URLSearchParams({id}),{credentials:'include'});return {status:r.status,body:await r.json()};}",{'api':w['fixture']['apiOrigin'],'id':own['id']})
        assert denied['status']==404 and 'csv' not in denied['body']
        denied_cursor=w['pages'][1].evaluate("async ({api,id})=>{const r=await fetch(api+'/api/partner/v1/statements?'+new URLSearchParams({before:id}),{credentials:'include'});return r.status;}",{'api':w['fixture']['apiOrigin'],'id':own['id']})
        assert denied_cursor==404
        paged=owner.evaluate("async ({api,id})=>{const r=await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource:'statements',before:id}),{credentials:'include'});return {status:r.status,body:await r.json()};}",{'api':w['fixture']['apiOrigin'],'id':records[0]['id']})
        assert paged['status']==200 and len(paged['body']['items'])==1
        assert paged['body']['schedules']
        w['post']('payment.record',{'payableId':payable['id'],'amountCents':1000,'paymentReference':'SYNTHETIC-WEEKLY-LATER','method':'cash','occurredAt':'2026-11-02T12:00:00Z','verified':True})
        w['fixture']['setClock']('2026-11-02T12:01:00Z')
        assert w['fixture']['runStatementJob']()['generated']==0
        with page.expect_download() as pending:
            page.get_by_role('button',name='Download statement for 2026-11-02',exact=True).click()
        later=tmp_path/'native-weekly-retry.csv';pending.value.save_as(later);assert later.read_bytes()==original
        owner.get_by_role('navigation').get_by_role('link',name='Finance',exact=True).click()
        owner.get_by_role('heading',name='Partner finance',exact=True).wait_for()
        owner.get_by_role('navigation').get_by_role('link',name='Weekly statements',exact=True).click()
        form=owner.locator('[data-statement-schedule="'+w['programId']+'"]')
        form.get_by_label('Schedule weekly statements',exact=True).uncheck()
        with owner.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/operator-partners')) as response:
            form.get_by_role('button',name='Save statement schedule',exact=True).click()
        assert response.value.status==200,response.value.text()
        assert response.value.json()['enabled'] is False
        owner.get_by_text('Statement schedule saved. Existing snapshots are unchanged.',exact=True).wait_for()
        w['fixture']['setClock']('2026-11-09T12:00:00Z')
        assert w['fixture']['runStatementJob']()['generated']==0
        assert len(w['read']('statements')['items'])==2
        assert w['fixture']['outboundAttempts']()==0
