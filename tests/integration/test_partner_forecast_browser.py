"""Native owner forecast lifecycle; all money and people are disposable synthetic data."""
import json
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig
from tests.integration.test_partner_consent_referral_browser import bonus_offer,visit,qualify,database


def forecast(w):
    response=w['owner'].evaluate("async ({api,programId})=>{const r=await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource:'forecasts',programId}),{credentials:'include'});return {status:r.status,body:await r.json()};}",{'api':w['fixture']['apiOrigin'],'programId':w['programId']})
    return response


def test_native_forecasts_replace_fee_and_bonus_reserves_preserve_week_and_show_unfunded_debt():
    with reviewed_budget_workspace() as w:
        gig,ref=bonus_offer(w)
        result=forecast(w);assert result['status']==200;row=result['body']['items'][0]
        assert row['pendingFeeCents']==5000 and row['contingentBonusCents']==1000 and row['potentialTotalCents']==6000
        payable=finish_gig(w,gig)
        payment=w['post']('payment.record',{'payableId':payable['id'],'amountCents':2000,'paymentReference':'SYNTHETIC-FORECAST-NOT-ACTUAL-PAYMENT','method':'bank_transfer','occurredAt':'2026-10-26T12:00:00Z','verified':True})
        row=forecast(w)['body']['items'][0]
        assert row['pendingFeeCents']==0 and row['paidCents']==2000 and row['remainingExposureCents']==4000 and row['potentialTotalCents']==6000
        week=w['budgets']()[0]
        w['post']('program.week_cap',{'programId':w['programId'],'weekStart':'2026-10-26','capCents':1000,'expectedRevision':week['revision'],'reason':'Synthetic lowered authorization preserves existing obligations.'})
        w['post']('payable.adjust',{'payableId':payable['id'],'amountCents':6000,'reason':'Synthetic independently acknowledged additional lawful obligation.','resolutionReference':'SYNTHETIC-FORECAST-ADJUSTMENT','partnerAcknowledged':True,'verifiedResolution':True})
        row=forecast(w)['body']['items'][0]
        assert row['potentialTotalCents']==12000 and row['unfundedExposureCents']==6000
        assert row['weeks'][0]['capCents']==1000 and row['weeks'][0]['potentialTotalCents']==12000
        w['fixture']['setClock']('2026-11-02T12:00:00Z')
        partner=w['pages'][0];partner.goto(w['origin'])
        partner.get_by_label('Account code',exact=True).fill(w['accounts'][0]['id'])
        partner.get_by_label('Passphrase',exact=True).fill('Synthetic budget partner private passphrase')
        partner.get_by_role('button',name='Sign in',exact=True).click()
        partner.get_by_role('heading',name='Hello, Budget Partner 1.',exact=True).wait_for()
        future=w['offer'](4000);w['accept'](future)
        w['post']('payment.reverse',{'paymentId':payment['id'],'paymentReference':'SYNTHETIC-FORECAST-RETURN','occurredAt':'2026-11-02T12:00:00Z','verifiedNotSettled':True,'reason':'Synthetic confirmed returned payment.'})
        row=forecast(w)['body']['items'][0]
        assert row['paidCents']==0 and row['potentialTotalCents']==16000
        weeks={r['weekStart']:r for r in row['weeks']}
        assert weeks['2026-10-26']['potentialTotalCents']==12000 and weeks['2026-11-02']['potentialTotalCents']==4000
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#forecasts/'+w['programId'])
        owner.get_by_role('heading',name='Spend forecasts',exact=True).wait_for()
        assert 'Exposure above historical authorization: $60.00' in owner.locator('main').inner_text()
        assert owner.evaluate('document.documentElement.scrollWidth<=innerWidth')
        cookie=next(c['value'] for c in w['pages'][0].context.cookies() if c['name']=='__Host-3dp-partner')
        denied=w['pages'][0].request.get(w['fixture']['apiOrigin']+'/api/operator-partners?resource=forecasts&programId='+w['programId'],headers={'Origin':w['fixture']['ownerOrigin'],'Cookie':'__Host-3dp-partner='+cookie})
        assert denied.status==401 and w['programId'] not in denied.text()
        assert forecast(w)['status']==200


def test_native_forecast_earned_bonus_is_counted_once_and_incomplete_evidence_fails_safely():
    with reviewed_budget_workspace() as w:
        gig,ref=bonus_offer(w);lead=visit(w,gig,consent=True)[0];qualification=qualify(w,lead)
        w['post']('referral.award',{'referralId':ref['id'],'ruleId':'introduction','qualificationId':qualification['id'],'criteriaConfirmed':True,'antiFraudConfirmed':True})
        row=forecast(w)['body']['items'][0]
        assert row['pendingFeeCents']==5000 and row['contingentBonusCents']==0 and row['outstandingCents']==1000 and row['potentialTotalCents']==6000
        # Deliberately damage only this disposable database to prove HTTP failure
        # is generic rather than silently reporting a smaller financial exposure.
        database(w,"WITH changed AS (UPDATE partner_program_weeks SET committed_cents=committed_cents+1 WHERE program_id='"+w['programId']+"' RETURNING id) SELECT to_json(count(*)) FROM changed")
        result=forecast(w)
        assert result['status']==503 and result['body']['error']=='The partner service is temporarily unavailable. Please try again later.'
        assert 'reservation' not in json.dumps(result['body']).lower()
