"""Direct staging mappings for owner-control.feature, with synthetic identities."""
import functools
import threading
from contextlib import contextmanager
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig
from tests.integration.test_partner_consent_referral_browser import database
from tests.support.server import ROOT,running_server,request


def partner_command(w,action,input):
    return w['pages'][0].evaluate("""async ({api,action,input})=>{const {createPartnerClient}=await import('/assets/client.js');const c=createPartnerClient({apiOrigin:api});await c.session();try{return {status:200,body:await c.command(action,input,crypto.randomUUID())};}catch(e){return {status:e.status,message:e.message};}}""",{'api':w['fixture']['apiOrigin'],'action':action,'input':input})


def financial_counts(w):
    return database(w,"SELECT json_build_object('reservations',(SELECT count(*) FROM partner_budget_reservations r JOIN partner_gigs g ON g.id=r.gig_id WHERE g.program_id='"+w['programId']+"'),'committed',(SELECT COALESCE(sum(committed_cents),0) FROM partner_program_weeks WHERE program_id='"+w['programId']+"'),'payables',(SELECT count(*) FROM partner_payables p JOIN partner_accounts a ON a.id=p.partner_id WHERE a.program_id='"+w['programId']+"'))")


def test_native_only_owner_can_publish_forty_dollar_campaign_and_partner_sees_frozen_offer():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#campaigns')
        form=owner.locator('#campaign-create');form.get_by_role('combobox',name='Program',exact=True).select_option(w['programId'])
        form.get_by_label('Offer title',exact=True).fill('Synthetic permitted flyer campaign')
        form.get_by_label('Offered fee (USD)',exact=True).fill('40.00')
        form.get_by_label('Permitted area',exact=True).fill('Tulsa permitted business areas')
        form.get_by_label('Completion deadline',exact=True).fill('2026-12-01')
        form.get_by_label('Objective tasks (one per line)',exact=True).fill('Respect no-soliciting signs\nAsk permission before leaving owner-provided flyers')
        form.get_by_label('Supplied materials (one per line, optional)',exact=True).fill('Owner-provided flyers')
        with owner.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/operator-partners')) as created:
            form.get_by_role('button',name='Create campaign draft',exact=True).click()
        assert created.value.status==200;campaign=created.value.json()
        owner.get_by_text('Campaign draft created.',exact=True).wait_for()
        owner.locator('[data-campaign="'+campaign['id']+'"]').get_by_role('button',name='Publish campaign',exact=True).click()
        owner.get_by_text('Campaign state recorded.',exact=True).wait_for()
        gig=w['post']('gig.offer',{'campaignId':campaign['id'],'partnerId':w['accounts'][0]['id']})
        page=w['pages'][0];page.goto(w['origin']+'/gigs/'+gig['id'])
        page.get_by_role('heading',name='Synthetic permitted flyer campaign',exact=True).wait_for()
        assert '$40.00 offered fee' in page.locator('main').inner_text()
        before=w['read']('gig',gig['id'])['item']
        denied=partner_command(w,'campaign.publish',{'campaignId':campaign['id'],'expectedRevision':2})
        assert denied['status']==403
        current=next(c for c in w['read']('campaigns')['items'] if c['id']==campaign['id'])
        assert current['status']=='published' and current['revision']==2
        assert w['read']('gig',gig['id'])['item']==before
        assert financial_counts(w)=={'reservations':0,'committed':0,'payables':0}
        assert w['fixture']['outboundAttempts']()==0


def test_native_owner_suspension_ends_routes_but_preserves_payable_for_lawful_settlement():
    with reviewed_budget_workspace() as w:
        gig=w['offer'](4000);w['accept'](gig);payable=finish_gig(w,gig)
        before=financial_counts(w)
        w['post']('partner.revoke',{'partnerId':w['accounts'][0]['id'],'status':'suspended'})
        page=w['pages'][0];page.goto(w['origin']+'/earnings')
        page.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        assert page.get_by_role('navigation').is_hidden()
        existing=next(p for p in w['read']('ledger')['items'] if p['id']==payable['id'])
        assert existing==payable and financial_counts(w)==before
        w['post']('payment.record',{'payableId':payable['id'],'amountCents':1000,'paymentReference':'SYNTHETIC-SUSPENDED-NOT-ACTUAL-PAYMENT','method':'cash','occurredAt':'2026-10-26T12:00:00Z','verified':True})
        settled=next(p for p in w['read']('ledger')['items'] if p['id']==payable['id'])
        assert settled['amountDueCents']==4000 and settled['paidCents']==1000 and settled['outstandingCents']==3000
        assert financial_counts(w)==before


def test_native_program_pause_denies_unaccepted_work_without_erasing_prior_debt():
    with reviewed_budget_workspace() as w:
        old=w['offer'](4000);w['accept'](old);payable=finish_gig(w,old);new=w['offer'](2000)
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#programs')
        form=owner.locator('[data-program="'+w['programId']+'"]')
        form.get_by_label('Enable new work after all clearance checks pass',exact=True).uncheck()
        form.get_by_role('button',name='Save program controls',exact=True).click()
        owner.get_by_text('Program controls saved.',exact=True).wait_for()
        before=financial_counts(w)
        page=w['pages'][0];page.goto(w['origin']+'/gigs/'+new['id'])
        with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/partner/v1/commands')) as denied:
            page.get_by_role('button',name='Save decision',exact=True).click()
        assert denied.value.status==409 and 'unavailable' in denied.value.json()['error'].lower()
        assert financial_counts(w)==before=={'reservations':1,'committed':4000,'payables':1}
        assert w['read']('gig',new['id'])['item']['status']=='offered'
        assert next(p for p in w['read']('ledger')['items'] if p['id']==payable['id'])==payable
        page.goto(w['origin']+'/earnings');page.get_by_role('heading',name='Your earnings',exact=True).wait_for()
        assert '$40.00' in page.locator('main').inner_text()


@contextmanager
def status_shell():
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'status/public')))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield 'http://127.0.0.1:'+str(server.server_port)
    finally:server.shutdown();server.server_close();thread.join(timeout=5)


def test_native_existing_private_work_inbox_updates_while_storefront_and_status_routes_stay_separate():
    with running_server() as storefront,status_shell() as status,reviewed_budget_workspace(work_seed=True,observe_outbound=True) as w:
        public_before={url:request(url)[2] for url in [storefront+'/',storefront+'/assets/js/order.js',status+'/',status+'/assets/status.js']}
        assert all(request(url)[0]==200 for url in public_before)
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin'])
        owner.locator('#workspace:not([hidden])').wait_for(timeout=4000)
        row=owner.locator('#work-list .work-row').filter(has_text='Synthetic owner-only project');row.click()
        owner.locator('#detail-content:not([hidden])').wait_for()
        assert 'Synthetic confidential project marker.' in owner.locator('#detail-content').inner_text()
        owner.get_by_role('button',name='Acknowledge',exact=True).click()
        owner.locator('.job-heading .kicker').get_by_text('revision 2').wait_for()
        owner.locator('#detail-content').get_by_label('Priority',exact=True).select_option('high')
        owner.locator('.job-heading .kicker').get_by_text('revision 3').wait_for()
        owner.locator('#private-note').fill('Synthetic private owner compatibility note.')
        owner.get_by_role('button',name='Add private note',exact=True).click()
        owner.locator('.job-heading .kicker').get_by_text('revision 4').wait_for()
        # A partner command shares the native database without changing customer work.
        w['post']('program.configure',{'programId':w['programId'],'expectedRevision':2,'enabled':False,'weeklyCapCents':20000})
        owner.reload();owner.locator('#workspace:not([hidden])').wait_for()
        owner.get_by_text('Synthetic private owner compatibility note.',exact=True).wait_for()
        detail=owner.evaluate("async ({api,id})=>(await(await fetch(api+'/api/operator-work?id='+id,{credentials:'include'})).json())",{'api':w['fixture']['apiOrigin'],'id':w['fixture']['privateWorkId']})
        assert detail['item']['revision']==4 and detail['item']['priority']=='high'
        assert detail['request']['contact']['email']=='private-customer@example.test'
        cookie=next(c['value'] for c in w['pages'][0].context.cookies() if c['name']=='__Host-3dp-partner')
        denied=w['pages'][0].request.get(w['fixture']['apiOrigin']+'/api/operator-work?id='+w['fixture']['privateWorkId'],headers={'Origin':w['fixture']['ownerOrigin'],'Cookie':'__Host-3dp-partner='+cookie})
        assert denied.status==401 and 'private-customer@example.test' not in denied.text()
        assert {url:request(url)[2] for url in public_before}==public_before
        assert all(b'private-customer@example.test' not in body for body in public_before.values())
        assert w['fixture']['outboundAttempts']()==0


def test_native_shell_port_reservations_are_distinct_and_exclude_other_binds_until_released():
    import socket
    import pytest
    from tests.support.ports import reserved_loopback_ports
    with reserved_loopback_ports(2) as held:
        addresses=[item.getsockname() for item in held];assert addresses[0]!=addresses[1]
        for address in addresses:
            with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as contender:
                with pytest.raises(OSError):contender.bind(address)
        held[0].close()
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as successor:successor.bind(addresses[0])
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as contender:
            with pytest.raises(OSError):contender.bind(addresses[1])
