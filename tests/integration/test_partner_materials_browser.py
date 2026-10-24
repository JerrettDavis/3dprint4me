"""Actual owner materials recording, replay and private partner history."""
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig
from tests.integration.test_partner_consent_referral_browser import command,database


def test_native_owner_records_materials_with_durable_retry_and_partner_private_history():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        gig=w['offer'](5000);w['accept'](gig)
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#gig/'+gig['id'])
        owner.get_by_role('heading',name='Supplied and returned materials',exact=True).wait_for()
        form=owner.locator('[data-material-record]')
        form.get_by_label('Material label 1',exact=True).fill('Sample signs <script>not executable</script>')
        form.get_by_label('Material count 1',exact=True).fill('5')
        attempts=[]
        def lose_first(route):
            if route.request.method=='POST' and route.request.post_data_json['action']=='material.record':
                attempts.append(route.request.post_data_json);response=route.fetch();assert response.status==200
                if len(attempts)==1:route.abort()
                else:route.fulfill(response=response)
            else:route.fallback()
        owner.route('**/api/operator-partners*',lose_first)
        form.get_by_role('button',name='Record materials',exact=True).click()
        owner.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        assert len(w['read']('gig',gig['id'])['materials'])==1
        form.get_by_role('button',name='Record materials',exact=True).click()
        owner.get_by_text('Material record saved. Compensation is unchanged.',exact=True).wait_for()
        assert attempts[0]==attempts[1]
        owner.unroute('**/api/operator-partners*',lose_first)
        form=owner.locator('[data-material-record]');form.get_by_role('combobox',name='Material event',exact=True).select_option('returned')
        form.get_by_label('Material label 1',exact=True).fill('Sample signs <script>not executable</script>')
        form.get_by_label('Material count 1',exact=True).fill('3')
        form.get_by_role('button',name='Record materials',exact=True).click()
        owner.get_by_text('Material record saved. Compensation is unchanged.',exact=True).wait_for()
        page=w['pages'][0];page.goto(w['origin']+'/gigs/'+gig['id'])
        page.get_by_role('heading',name='Supplied and returned materials',exact=True).wait_for()
        assert 'Sample signs <script>not executable</script>' in page.locator('[data-material-history]').inner_text()
        assert page.locator('main script').count()==0 and page.locator('[data-material-record]').count()==0
        denied=command(w,'material.record',{'gigId':gig['id'],'eventType':'issued','items':[{'label':'Unauthorized','count':1}]})
        assert denied['status']==403
        assert page.evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?'+new URLSearchParams({id}),{credentials:'include'})).status",{'api':w['fixture']['apiOrigin'],'id':gig['id']})==200
        denied=w['pages'][1].evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?'+new URLSearchParams({id}),{credentials:'include'})).status",{'api':w['fixture']['apiOrigin'],'id':gig['id']})
        assert denied==404
        before=w['read']('gig',gig['id'])
        denied=command(w,'material.record',{'gigId':gig['id'],'eventType':'returned','items':[{'label':'Sample signs <script>not executable</script>','count':3}]},page=owner,owner=True)
        assert denied['status']==409 and w['read']('gig',gig['id'])==before
        assert before['item']['feeCents']==5000 and w['budgets']()[0]['committed_cents']==5000
        payable=finish_gig(w,gig);assert payable['amountDueCents']==5000
        assert len(w['read']('gig',gig['id'])['materials'])==2
        assert database(w,"SELECT json_build_object('events',count(*)) FROM partner_material_events WHERE gig_id='"+gig['id']+"'")=={'events':2}
        assert w['fixture']['outboundAttempts']()==0


def test_native_large_material_history_is_explicitly_partial_and_keeps_newest_records():
    with reviewed_budget_workspace() as w:
        gig=w['offer'](5000);w['accept'](gig)
        added=database(w,"WITH added AS (INSERT INTO partner_material_events(id,gig_id,event_type,items,actor_id,created_at) SELECT gen_random_uuid(),'"+gig['id']+"','issued',jsonb_build_array(jsonb_build_object('label','Synthetic batch '||n,'count',1)),'synthetic-owner','2026-10-26T12:00Z'::timestamptz+n*interval '1 second' FROM generate_series(1,201) n RETURNING id) SELECT json_build_object('count',count(*)) FROM added")
        assert added=={'count':201}
        data=w['read']('gig',gig['id']);assert data['materialsHasMore'] is True and len(data['materials'])==200
        assert data['materials'][0]['items'][0]['label']=='Synthetic batch 201' and data['materials'][-1]['items'][0]['label']=='Synthetic batch 2'
        page=w['pages'][0];page.goto(w['origin']+'/gigs/'+gig['id'])
        page.get_by_text('Showing the newest 200 material events. Older events are not shown; this is not a complete inventory balance.',exact=True).wait_for()
        assert page.get_by_text('Synthetic batch 201: 1',exact=True).count()==1 and page.get_by_text('Synthetic batch 1: 1',exact=True).count()==0
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#gig/'+gig['id'])
        owner.get_by_text('Showing the newest 200 material events. Older events are not shown; this is not a complete inventory balance.',exact=True).wait_for()
        assert w['budgets']()[0]['committed_cents']==5000 and data['item']['feeCents']==5000
