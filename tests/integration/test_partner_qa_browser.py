"""Real browser/API/isolated PostgreSQL QA lifecycle, not mocked UI evidence."""
from tests.integration.test_partner_native_browser import native_partner_workspace
from tests.support.browser_harness import SiteBrowser
from playwright.sync_api import expect
from tests.support.partner_qa_evidence import capture_partner_qa_step


def test_production_portal_qa_isolated_lifecycle_and_canonical_stub_denial():
    with native_partner_workspace(qa_mode=True) as (origin, fixture), SiteBrowser(viewport=(390,844), reduced_motion='reduce') as site:
        owner=site.page
        api=fixture['apiOrigin']
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        owner.goto(fixture['ownerOrigin']+'/partners/qa#programs')
        owner.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        assert owner.get_by_text('QA only — representative stubs',exact=True).is_visible()
        capture_partner_qa_step(owner,scenario_id='QA-060',step_id='owner-entry')
        owner.get_by_role('button',name='Create synthetic QA run',exact=True).click()
        expect(owner.locator('#qa-run-result')).to_contain_text('No real approval or funds', timeout=30000)
        assert 'No real approval or funds' in owner.locator('#qa-run-result').inner_text()
        capture_partner_qa_step(owner,scenario_id='QA-060',step_id='provisioned')
        def post(action,input,expected_status=200):
            r=owner.evaluate("""async ({api,action,input})=>{const s=await(await fetch(api+'/api/operator-partner-qa?resource=session',{credentials:'include'})).json();const r=await fetch(api+'/api/operator-partner-qa',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:JSON.stringify({action,input,key:crypto.randomUUID()})});return {status:r.status,body:await r.json()};}""",{'api':api,'action':action,'input':input})
            assert r['status']==expected_status,r
            return r['body']
        def read(resource,id=None):
            return owner.evaluate("async ({api,resource,id})=>(await fetch(api+'/api/operator-partner-qa?'+new URLSearchParams({resource,...(id?{id}:{})}),{credentials:'include'})).json()",{'api':api,'resource':resource,'id':id})
        programs=read('programs')['items'];program=programs[0]
        account=read('partners')['items'][0]
        seed=post('legal.seed_templates',{'programId':program['id']});assert seed['created']==15
        legal=read('legal');assert legal
        stub=next(x for x in legal['items'] if x['template_key']=='independent-marketing-services')
        invite=post('partner.invite',{'partnerId':account['id'],'purpose':'enroll'})
        page=site.context.new_page();page.goto(origin+'/qa/join')
        page.get_by_label('Invitation or recovery code',exact=True).fill(invite['token'])
        page.get_by_label('Choose a passphrase',exact=True).fill('Synthetic QA private passphrase')
        page.get_by_role('button',name='Set passphrase and continue',exact=True).click()
        page.get_by_role('heading',name='Hello, QA Synthetic Participant A.',exact=True).wait_for()
        assert '/qa' in page.url
        assert page.get_by_text('QA only — representative stubs',exact=True).is_visible()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='enrolled')
        denied=post('legal.issue',{'programId':program['id'],'versionId':stub['latest_version_id'],'versionHash':stub['content_sha256'],'partnerId':account['id'],'bindings':{}},expected_status=409)
        assert 'error' in denied
        live=owner.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=programs',{credentials:'include'})).json()",api)
        assert live['items']==[]
        # The QA cookie does not authenticate the ordinary partner API.
        assert page.evaluate("async api=>(await fetch(api+'/api/partner/v1/session',{credentials:'include'})).status",api)==401
        version=read('legal-version',program['settings']['contractVersionId'])['version']
        post('legal.issue',{'programId':program['id'],'versionId':version['id'],'versionHash':version['content_sha256'],'partnerId':account['id'],'bindings':{'company_dba':'Synthetic QA Fabrication','partner_full_name':'Synthetic Participant A','program_start_date':'2026-10-01'}})
        page.get_by_role('link',name='Agreements',exact=True).click();assert '/qa/agreements' in page.url
        page.get_by_role('heading',name='Your agreements',exact=True).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='agreements')
        exact=page.locator('pre.document').first.inner_text()
        with page.expect_download() as agreement_download:
            page.get_by_role('button',name='Download exact text',exact=True).first.click()
        downloaded=agreement_download.value
        assert downloaded.suggested_filename.startswith('QA-SIMULATED-')
        from pathlib import Path
        assert Path(downloaded.path()).read_text(encoding='utf-8')==exact

        page.get_by_label('I have read this exact issued version.',exact=True).check()
        page.get_by_role('button',name='Record read acknowledgment',exact=True).click()
        page.get_by_text('Read acknowledgment recorded.',exact=True).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='acknowledged')
        terms={'title':'QA synthetic ten business visits','feeCents':5000,'maximumBonusCents':500,'bonusRules':[{'id':'sale','trigger':'verified_sale','amountCents':500,'maximumAwards':1,'criteria':'Synthetic independent paid sale only','qualifiesBy':'2026-12-31','refundTreatment':'QA simulated refund review preserves obligations.'}],'tasks':['Simulate ten permitted business visits; no real outreach.'],'materials':[],'area':'Synthetic permitted business area','deadline':'2026-12-31'}
        campaign=post('campaign.create',{'programId':program['id'],'terms':terms})
        post('campaign.publish',{'campaignId':campaign['id'],'expectedRevision':1})
        gig=post('gig.offer',{'campaignId':campaign['id'],'partnerId':account['id']})
        page.goto(origin+'/qa/gigs/'+gig['id'])
        page.get_by_role('button',name='Accept offer',exact=True).click()
        page.get_by_text('Offer accepted. Receipt',exact=False).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='accepted')
        referral=read('referrals')['items'][0]
        request=post('qa.customer_request',{'referralId':referral['id']})
        attribution=post('referral.attribute',{'referralId':referral['id'],'requestId':request['requestId'],'consentedAt':request['consentedAt'],'consentVerified':True,'independentCustomerConfirmed':True,'evidenceReference':'QA-SIMULATED-OPTIN-001'})
        sale=post('referral.verify_sale',{'referralId':referral['id'],'attributionId':attribution['id'],'amountCents':10000,'paymentReference':'QA-SIMULATED-SALE-001','method':'cash','settledAt':request['consentedAt'],'settlementVerified':True,'paidInFull':True,'refundsReviewed':True,'independentCustomerConfirmed':True})
        post('referral.award',{'referralId':referral['id'],'ruleId':'sale','saleEvidenceId':sale['id'],'criteriaConfirmed':True,'antiFraudConfirmed':True})
        owner.goto(fixture['ownerOrigin']+'/partners/qa#referrals')
        owner.get_by_role('heading',name='Referral review',exact=False).wait_for()
        capture_partner_qa_step(owner,scenario_id='QA-060',step_id='sale-simulated')

        for number in range(10):
            page.goto(origin+'/qa/visits/new?gig='+gig['id'])
            page.get_by_label('Business name',exact=True).fill('QA fictional business '+str(number))
            page.get_by_label('Outcome',exact=True).select_option('accepted_material')
            page.get_by_label('Permission to leave materials',exact=True).select_option('permission_received')
            page.get_by_label('Samples left',exact=True).fill('1')
            with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/partner-qa/v1/commands')) as receipt:
                page.get_by_role('button',name='Submit visit',exact=True).click()
            assert receipt.value.status==200,receipt.value.json()
            page.get_by_text('Visit recorded.',exact=True).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='visits-recorded')
        page.goto(origin+'/qa/gigs/'+gig['id'])
        page.get_by_label('Reason or submission details',exact=True).fill('QA ten simulated permitted visits complete.')
        page.get_by_role('button',name='Submit work for review',exact=True).click()
        page.get_by_text('Decision recorded.',exact=True).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='submitted')
        for action in ['approve','make_payable']:
            item=read('gig',gig['id'])['item']
            post('gig.'+action,{'gigId':gig['id'],'expectedRevision':item['revision'],'reason':'QA simulation — objective criteria confirmed.'})
        payable=next(p for p in read('ledger')['items'] if p['amountDueCents']==5000)
        post('payment.record',{'payableId':payable['id'],'amountCents':2500,'paymentReference':'QA-SIMULATED-PARTIAL-001','method':'other','occurredAt':'2026-11-03T18:00:00Z','verified':True})
        assert next(p for p in read('ledger')['items'] if p['id']==payable['id'])['outstandingCents']==2500
        batch=post('finance.export',{'programId':program['id'],'basis':'cash'})
        assert batch['csv'].startswith('QA SAMPLE — NO LEGAL EFFECT — SIMULATED ACCOUNTING')
        page.goto(origin+'/qa/earnings');page.get_by_role('heading',name='Your earnings',exact=True).wait_for()
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='partial-settlement')
        assert read('leads')['items']==[]
        live=owner.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=programs',{credentials:'include'})).json()",api)
        assert live['items']==[]
        owner.get_by_role('button',name='Retire selected QA run',exact=True).click()
        owner.get_by_text('QA run retired.',exact=False).wait_for()
        page.reload();page.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        assert len(read('programs')['items'])==1
        capture_partner_qa_step(owner,scenario_id='QA-060',step_id='retired')
        capture_partner_qa_step(page,scenario_id='QA-060',step_id='session-denied')

