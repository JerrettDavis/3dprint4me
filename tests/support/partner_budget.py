"""Synthetic reviewed programs created through real browser HTTP boundaries."""
from contextlib import contextmanager,ExitStack
from datetime import datetime,timedelta
from tests.integration.test_partner_native_browser import native_partner_workspace
from tests.support.browser_harness import SiteBrowser


@contextmanager
def reviewed_budget_workspace(clock='2026-10-26T12:00:00Z'):
    with native_partner_workspace(enable_reviewed_launch=True,clock=clock) as (origin,fixture),SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site,ExitStack() as stack:
        api=fixture['apiOrigin'];owner=site.page
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        owner.goto(fixture['ownerOrigin']+'/partners')
        owner.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        def post(action,input):
            response=owner.evaluate("""async ({api,action,input})=>{const s=await(await fetch(api+'/api/operator-partners?resource=session',{credentials:'include'})).json();const r=await fetch(api+'/api/operator-partners',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:JSON.stringify({action,input,key:crypto.randomUUID()})});return {status:r.status,body:await r.json()};}""",{'api':api,'action':action,'input':input})
            assert response['status']==200,response
            return response['body']
        def read(resource,id=None):
            return owner.evaluate("async ({api,resource,id})=>(await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource,...(id?{id}:{})}),{credentials:'include'})).json()",{'api':api,'resource':resource,'id':id})
        program=post('program.create',{'label':'Synthetic native authorization spine','startsOn':'2026-10-01'})
        program_id=program['id'];scopes=['classification','agreement_language','solicitation_policy','accounting']
        version=post('legal.save',{'programId':program_id,'templateKey':'native-budget-source','title':'Synthetic authorization terms','markdown':'# Synthetic test terms\nNo minimum hours. Voluntary permitted business visits. No attendance requirement.','variablesSchema':{},'issuable':True,'requiredScopes':scopes,'expectedRevision':0,'changeReason':'Isolated synthetic budget acceptance evidence.'})
        instant=datetime.fromisoformat(clock.replace('Z','+00:00'))
        package=post('legal.export_package',{'programId':program_id,'versionIds':[version['versionId']],'reviewers':[{'name':'Synthetic counsel','role':'attorney','scopes':scopes[:3]},{'name':'Synthetic accountant','role':'cpa','scopes':['accounting']}],'expiresAt':(instant+timedelta(days=1)).isoformat(),'redactionConfirmed':True})
        for scope in scopes:
            post('legal.record_review',{'programId':program_id,'packageId':package['id'],'versionId':version['versionId'],'versionHash':version['hash'],'scope':scope,'decision':'approved','reviewerName':'Synthetic accountant' if scope=='accounting' else 'Synthetic counsel','reviewerRole':'cpa' if scope=='accounting' else 'attorney','evidenceReference':'SYNTHETIC-NOT-PROFESSIONAL-APPROVAL-'+scope,'reviewedAt':clock})
        post('legal.publish',{'programId':program_id,'versionId':version['versionId'],'expectedRevision':1})
        post('program.configure',{'programId':program_id,'expectedRevision':1,'enabled':True,'weeklyCapCents':20000,'contractVersionId':version['versionId'],'policyVersionId':version['versionId']})
        pages=[];accounts=[]
        for number in [1,2]:
            account=post('partner.create',{'programId':program_id,'displayName':'Budget Partner '+str(number)})
            invite=post('partner.invite',{'partnerId':account['id'],'purpose':'enroll'})
            context=stack.enter_context(site.browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce'))
            page=context.new_page();page.goto(origin+'/join')
            page.get_by_label('Invitation or recovery code',exact=True).fill(invite['token'])
            page.get_by_label('Choose a passphrase',exact=True).fill('Synthetic budget partner private passphrase')
            page.get_by_role('button',name='Set passphrase and continue',exact=True).click()
            page.get_by_role('heading',name='Hello, Budget Partner '+str(number)+'.',exact=True).wait_for()
            post('legal.issue',{'programId':program_id,'versionId':version['versionId'],'versionHash':version['hash'],'partnerId':account['id'],'bindings':{}})
            page.goto(origin+'/agreements');page.get_by_label('I have read this exact issued version.',exact=True).check()
            page.get_by_role('button',name='Record read acknowledgment',exact=True).click();page.get_by_text('Read acknowledgment recorded.',exact=True).wait_for()
            accounts.append(account);pages.append(page)
        def offer(cents,partner=0):
            terms={'title':'Synthetic authorized visits '+str(cents),'feeCents':cents,'maximumBonusCents':0,'tasks':['Permitted objective introduction'],'materials':[],'area':'Tulsa permitted business areas','deadline':'2026-12-31'}
            campaign=post('campaign.create',{'programId':program_id,'terms':terms})
            post('campaign.publish',{'campaignId':campaign['id'],'expectedRevision':1})
            return post('gig.offer',{'campaignId':campaign['id'],'partnerId':accounts[partner]['id']})
        def accept(gig,partner=0,expected=True):
            page=pages[partner];page.goto(origin+'/gigs/'+gig['id']);page.get_by_role('combobox',name='Action',exact=True).select_option('accept')
            page.get_by_role('button',name='Save decision',exact=True).click()
            page.get_by_text('Offer accepted. Receipt' if expected else 'No additional budget is available for this authorization.',exact=not expected).wait_for()
        def budgets():return [r for r in read('budgets')['items'] if r['program_id']==program_id]
        yield {'origin':origin,'fixture':fixture,'site':site,'owner':owner,'pages':pages,'accounts':accounts,'programId':program_id,'post':post,'read':read,'offer':offer,'accept':accept,'budgets':budgets}
