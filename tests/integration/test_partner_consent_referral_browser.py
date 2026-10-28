"""Direct native consent/qualification and accepted-policy financial evidence."""
import json
import subprocess
import uuid
from datetime import datetime,timezone,timedelta
from tests.support.partner_budget import reviewed_budget_workspace
from tests.integration.test_partner_gig_browser import own
from tests.support.server import request


def database(w,sql):
    result=subprocess.run(['docker','exec',w['fixture']['_container'],'psql','-U','postgres','-Atc',sql],check=True,capture_output=True,text=True,timeout=15)
    return json.loads(result.stdout)


def command(w,action,input,*,page=None,owner=False):
    page=page or w['pages'][0]
    return page.evaluate("""async ({api,action,input,owner})=>{const path=owner?'/api/operator-partners':'/api/partner/v1/commands',session=owner?'/api/operator-partners?resource=session':'/api/partner/v1/session';const s=await(await fetch(api+session,{credentials:'include'})).json();const r=await fetch(api+path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:JSON.stringify({action,input,key:crypto.randomUUID()})});return {status:r.status,body:await r.json()};}""",{'api':w['fixture']['apiOrigin'],'action':action,'input':input,'owner':owner})


def bonus_offer(w,amount=1000,trigger='qualified_lead'):
    rule={'id':'introduction' if trigger=='qualified_lead' else 'sale','trigger':trigger,'amountCents':amount,'maximumAwards':1,'criteria':'Independent consenting project interest.' if trigger=='qualified_lead' else 'Independent fully settled purchase.','qualifiesBy':'2026-12-31'}
    if trigger=='verified_sale':rule['refundTreatment']='Independently review refunds without erasing existing earned obligations.'
    terms={'title':'Synthetic accepted bonus '+str(amount),'feeCents':5000,'maximumBonusCents':amount,'bonusRules':[rule],'tasks':['Permitted voluntary business introductions.'],'materials':[],'area':'Tulsa permitted areas','deadline':'2026-12-31'}
    campaign=w['post']('campaign.create',{'programId':w['programId'],'terms':terms})
    w['post']('campaign.publish',{'campaignId':campaign['id'],'expectedRevision':1})
    gig=w['post']('gig.offer',{'campaignId':campaign['id'],'partnerId':w['accounts'][0]['id']})
    w['accept'](gig)
    ref=next(r for r in w['read']('referrals')['items'] if r['gigId']==gig['id'])
    return gig,ref


def visit(w,gig,*,consent=False,business='Synthetic consent business',email='consenting-project@example.test',instant='2026-10-26T12:00:00Z'):
    page=w['pages'][0];page.goto(w['origin']+'/visits/new?gig='+gig['id'])
    page.get_by_label('Business name',exact=True).fill(business)
    local=page.evaluate("iso=>{const d=new Date(iso);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}",instant)
    page.get_by_label('Visit time',exact=True).fill(local)
    page.get_by_label('Outcome',exact=True).select_option('accepted_material')
    page.get_by_label('Permission to leave materials',exact=True).select_option('permission_received')
    page.get_by_label('Samples left',exact=True).fill('1')
    if consent:
        page.get_by_label('This person explicitly agreed to project follow-up.',exact=True).check()
        page.get_by_label('Project follow-up purpose',exact=True).fill('Requested printed sign project discussion')
        page.get_by_label('Contact email',exact=True).fill(email)
    page.get_by_role('button',name='Submit visit',exact=True).click()
    page.get_by_text('Visit recorded.',exact=True).wait_for()
    return own(w,'leads')['items']


def qualify(w,lead):
    owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#leads')
    card=owner.locator('[data-lead="'+lead['id']+'"]')
    card.get_by_label('Review reason',exact=True).fill('Synthetic specific project permission and independent interest verified.')
    card.get_by_role('button',name='Record lead review',exact=True).click()
    owner.get_by_text('Lead review recorded. No bonus was created.',exact=True).wait_for()
    return next(q for q in w['read']('referrals')['qualifications'] if q['leadId']==lead['id'])


def test_native_business_visit_creates_no_personal_contact_or_followup_queue():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig,ref=bonus_offer(w)
        assert visit(w,gig,business='Sample Coffee')==[]
        visits=own(w,'visits')['items'];assert len(visits)==1 and visits[0]['business_name']=='Sample Coffee'
        assert visits[0]['outcome']=='accepted_material'
        assert not [r for r in w['read']('leads')['items'] if r['partnerId']==w['accounts'][0]['id']]
        assert w['fixture']['outboundAttempts']()==0


def test_native_explicit_project_permission_records_exact_consent_version_before_owner_review():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig,ref=bonus_offer(w);lead=visit(w,gig,consent=True)[0]
        assert lead['status']=='needs_review' and lead['followUpAllowed'] is False
        assert lead['purpose']=='Requested printed sign project discussion'
        assert lead['contact']=={'email':'consenting-project@example.test','preferredContact':'email'}
        evidence=database(w,"SELECT json_build_object('consent',(SELECT evidence FROM partner_consent_events WHERE lead_id='"+lead['id']+"' AND event_type='granted'),'audit',(SELECT minimal_diff FROM partner_audit_events WHERE action='visit.recorded' AND entity_id='"+lead['visitId']+"'))")
        assert evidence['consent']['version']=='follow-up-permission-v1'
        assert evidence['consent']['consentText']==lead['consentText']
        assert evidence['consent']['purpose']==lead['purpose'] and evidence['consent']['sourceVisitId']==lead['visitId']
        assert evidence['audit']['consentVersion']=='follow-up-permission-v1'
        qualification=qualify(w,lead);assert qualification['followUpAllowed'] is True
        assert not [a for a in w['read']('referrals')['awards'] if a['referralId']==ref['id']]
        assert w['fixture']['outboundAttempts']()==0


def test_native_unconsented_email_is_rejected_without_contact_audit_or_notification_side_effects():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig,ref=bonus_offer(w)
        def counts():return database(w,"SELECT json_build_object('visits',(SELECT count(*) FROM partner_visits),'leads',(SELECT count(*) FROM partner_leads),'consent',(SELECT count(*) FROM partner_consent_events),'audit',(SELECT count(*) FROM partner_audit_events),'outbox',(SELECT count(*) FROM partner_outbox))")
        before=counts()
        result=command(w,'visit.record',{'gigId':gig['id'],'expectedGigRevision':2,'clientId':str(uuid.uuid4()),'businessName':'Synthetic rejected email','approximateArea':'Tulsa','visitedAt':'2026-10-26T12:00:00Z','outcome':'unavailable','placement':'none','sampleCount':0,'consent':False,'contact':{'email':'unpermitted@example.test','preferredContact':'email'}})
        assert result['status']==422 and result['body']['error']=='Personal contact details require specific follow-up permission.'
        assert counts()==before and own(w,'leads')['items']==[]
        assert w['fixture']['outboundAttempts']()==0


def test_native_withdrawn_permission_suppresses_owner_contact_and_cannot_be_requalified():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig,ref=bonus_offer(w);lead=visit(w,gig,consent=True)[0];qualify(w,lead)
        page=w['pages'][0];page.goto(w['origin']+'/visits')
        page.get_by_role('button',name='Withdraw follow-up permission',exact=True).click()
        page.get_by_text('Follow-up permission withdrawn.',exact=True).wait_for()
        suppressed=own(w,'leads')['items'][0]
        assert suppressed['status']=='withdrawn' and suppressed['followUpAllowed'] is False
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#leads');owner.reload()
        card=owner.locator('[data-lead="'+lead['id']+'"]');card.get_by_text('Follow-up unavailable',exact=True).wait_for()
        assert 'Permission is suppressed. Contact details are hidden here.' in card.inner_text()
        assert 'consenting-project@example.test' not in card.inner_text()
        assert card.get_by_role('button',name='Record lead review',exact=True).count()==0
        result=command(w,'lead.review',{'leadId':lead['id'],'expectedRevision':suppressed['revision'],'decision':'qualified','reason':'Synthetic attempted stale outreach'},page=owner,owner=True)
        assert result['status']==409
        assert w['fixture']['outboundAttempts']()==0


def test_native_qualified_lead_bonus_survives_different_device_duplicate_evidence_once():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig,ref=bonus_offer(w);sent=[]
        w['pages'][0].on('request',lambda req:sent.append(req.post_data_json) if req.method=='POST' and req.url.endswith('/commands') else None)
        lead=visit(w,gig,consent=True)[0];qualification=qualify(w,lead)
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#referrals')
        form=owner.locator('[data-referral="'+ref['id']+'"] [data-award-rule="introduction"]')
        form.get_by_role('combobox',name='Qualification evidence',exact=True).select_option(qualification['id'])
        form.get_by_label('The frozen qualification criteria and deadline are met.',exact=True).check()
        form.get_by_label('I reviewed self-referral, duplicate and collusion checks.',exact=True).check()
        form.get_by_role('button',name='Award accepted bonus',exact=True).click()
        owner.get_by_text('Earned bonus recorded as payable. This is not a payment confirmation.',exact=True).wait_for()
        original=next(c for c in sent if c['action']=='visit.record')
        with w['site'].browser.new_context(viewport={'width':390,'height':844}) as context:
            other=context.new_page();other.goto(w['origin'])
            other.get_by_label('Account code',exact=True).fill(w['accounts'][0]['id'])
            other.get_by_label('Passphrase',exact=True).fill('Synthetic budget partner private passphrase')
            other.get_by_role('button',name='Sign in',exact=True).click()
            other.get_by_role('heading',name='Hello, Budget Partner 1.',exact=True).wait_for()
            replay={**original['input'],'clientId':str(uuid.uuid4())}
            result=command(w,'visit.record',replay,page=other)
            assert result['status']==409 and result['body']['error']=='This business visit is already recorded.'
            result=command(w,'visit.record',{**replay,'clientId':str(uuid.uuid4()),'businessName':'Synthetic different device same contact'},page=other)
            assert result['status']==409 and result['body']['error']=='This follow-up contact is already recorded. Ask the owner to review the existing contact.'
        replay=command(w,'referral.award',{'referralId':ref['id'],'ruleId':'introduction','qualificationId':qualification['id'],'criteriaConfirmed':True,'antiFraudConfirmed':True},page=owner,owner=True)
        assert replay['status']==200 and replay['body']['amountCents']==1000
        evidence=database(w,"SELECT json_build_object('visits',(SELECT count(*) FROM partner_visits WHERE gig_id='"+gig['id']+"'),'leads',(SELECT count(*) FROM partner_leads WHERE partner_id='"+w['accounts'][0]['id']+"'),'awards',(SELECT count(*) FROM partner_referral_events WHERE referral_id='"+ref['id']+"'),'payables',(SELECT count(*) FROM partner_payables WHERE referral_event_id=(SELECT id FROM partner_referral_events WHERE referral_id='"+ref['id']+"')))" )
        assert evidence=={'visits':1,'leads':1,'awards':1,'payables':1}
        assert own(w,'earnings')['totals']['paidCents']==0 and w['fixture']['outboundAttempts']()==0


def test_native_original_twenty_dollar_sale_bonus_survives_new_ten_dollar_policy():
    initial=(datetime.now(timezone.utc)-timedelta(minutes=1)).isoformat()
    with reviewed_budget_workspace(clock=initial,observe_outbound=True) as w:
        old_gig,old_ref=bonus_offer(w,2000,'verified_sale')
        new_gig,new_ref=bonus_offer(w,1000,'verified_sale')
        page=w['pages'][0];page.goto(w['origin']+'/referrals')
        page.get_by_text(old_ref['code'],exact=True).wait_for()
        old_card=page.locator('section.sheet').filter(has=page.get_by_text(old_ref['code'],exact=True))
        new_card=page.locator('section.sheet').filter(has=page.get_by_text(new_ref['code'],exact=True))
        assert '$20.00 per award' in old_card.inner_text() and '$10.00 per award' in new_card.inner_text()
        body={'projectTitle':'Synthetic accepted-policy sign request','service':'consult','description':'Independent synthetic printed sign project.',
              'contact':{'name':'Synthetic independent customer','email':'original-policy-customer@example.test'},'consent':True,
              'referral':{'code':old_ref['code'],'consent':True,'consentVersion':'referral-v1'}}
        code,_,raw=request(w['fixture']['apiOrigin']+'/api/request',method='POST',payload={'request':body})
        assert code==201;request_id=json.loads(raw)['id']
        code,_,_=request(w['fixture']['apiOrigin']+'/api/request',method='PATCH',payload={'id':request_id,'request':body,'uploadedFiles':[]})
        assert code==200
        w['fixture']['setClock']((datetime.now(timezone.utc)+timedelta(seconds=1)).isoformat())
        data=w['read']('referrals');receipt=next(r for r in data['requests'] if r['id']==request_id)
        assert receipt['code']==old_ref['code']
        assert not [r for r in data['awards'] if r['referralId'] in [old_ref['id'],new_ref['id']]]
        assert not [r for r in data['attributions'] if r['requestId']==request_id]
        attribution=w['post']('referral.attribute',{'referralId':old_ref['id'],'requestId':request_id,'consentedAt':receipt['consentedAt'],'consentVerified':True,'independentCustomerConfirmed':True,'evidenceReference':'SYNTHETIC original web permission independently checked'})
        sale=w['post']('referral.verify_sale',{'referralId':old_ref['id'],'attributionId':attribution['id'],'amountCents':12500,'paymentReference':'SYNTHETIC-NOT-ACTUAL-PAYMENT-ORIGINAL-POLICY','method':'bank_transfer','settledAt':receipt['consentedAt'],'settlementVerified':True,'paidInFull':True,'refundsReviewed':True,'independentCustomerConfirmed':True})
        award=w['post']('referral.award',{'referralId':old_ref['id'],'ruleId':'sale','saleEvidenceId':sale['id'],'criteriaConfirmed':True,'antiFraudConfirmed':True})
        assert award['amountCents']==2000
        data=w['read']('referrals');retained=next(r for r in data['items'] if r['id']==old_ref['id'])
        assert retained['policyHash']==old_ref['policyHash'] and retained['bonusRules'][0]['amountCents']==2000
        assert next(r for r in data['items'] if r['id']==new_ref['id'])['bonusRules'][0]['amountCents']==1000
        earned=[r for r in data['awards'] if r['referralId'] in [old_ref['id'],new_ref['id']]]
        assert len(earned)==1 and earned[0]['referralId']==old_ref['id'] and earned[0]['amountCents']==2000
        page.reload();page.get_by_text('$20.00 earned',exact=True).wait_for()
        assert own(w,'earnings')['totals']['earnedBonusCents']==2000 and own(w,'earnings')['totals']['paidCents']==0
        assert w['fixture']['outboundAttempts']()==0
