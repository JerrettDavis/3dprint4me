"""Direct native mappings for voluntary gig completion, decline and safety."""
from tests.support.partner_budget import reviewed_budget_workspace
from tests.integration.test_partner_budget_browser import reservations


def offer(w):
    terms={'title':'Synthetic ten permitted business introductions','feeCents':5000,'maximumBonusCents':0,
           'tasks':['Record ten unique allowed business visits; respect restrictions and ask permission before leaving materials.'],
           'materials':[],'area':'Tulsa permitted business areas','deadline':'2026-12-31'}
    campaign=w['post']('campaign.create',{'programId':w['programId'],'terms':terms})
    w['post']('campaign.publish',{'campaignId':campaign['id'],'expectedRevision':1})
    return w['post']('gig.offer',{'campaignId':campaign['id'],'partnerId':w['accounts'][0]['id']})


def decision(w,gig,action,reason=None):
    page=w['pages'][0];page.goto(w['origin']+'/gigs/'+gig['id'])
    page.get_by_role('combobox',name='Action',exact=True).select_option(action)
    if reason:page.get_by_label('Reason or submission details',exact=True).fill(reason)
    page.get_by_role('button',name='Save decision',exact=True).click()
    page.get_by_text('Decision recorded.',exact=True).wait_for()


def owner_gig(w,gig):
    page=w['owner'];page.goto(w['fixture']['ownerOrigin']+'/partners#gig/'+gig['id'])
    page.get_by_role('heading',name='Synthetic ten permitted business introductions',exact=True).wait_for()
    return page


def own(w,resource):
    return w['pages'][0].evaluate("async ({api,resource})=>(await(await fetch(api+'/api/partner/v1/'+resource,{credentials:'include'})).json())",{'api':w['fixture']['apiOrigin'],'resource':resource})


def test_native_gig_accept_ten_unique_visits_submit_and_owner_review_without_attendance():
    with reviewed_budget_workspace() as w:
        gig=offer(w);page=w['pages'][0];page.goto(w['origin']+'/gigs/'+gig['id'])
        page.get_by_role('heading',name='Synthetic ten permitted business introductions',exact=True).wait_for()
        text=page.locator('main').inner_text()
        assert '$50.00 offered fee' in text and 'ten unique allowed business visits' in text
        assert all(word not in text.lower() for word in ['clock-in','uniform','required hours'])
        terms=w['read']('gig',gig['id'])['item']['terms']
        assert reservations(w)=={'count':0,'total':0}
        w['accept'](gig)
        assert reservations(w)=={'count':1,'total':5000}
        for number in range(10):
            page.goto(w['origin']+'/visits/new?gig='+gig['id'])
            page.get_by_label('Business name',exact=True).fill('Synthetic permitted business '+str(number))
            instant=page.evaluate("()=>{const d=new Date('2026-10-26T12:00:00Z');return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}")
            page.get_by_label('Visit time',exact=True).fill(instant)
            page.get_by_label('Outcome',exact=True).select_option('accepted_material')
            page.get_by_label('Permission to leave materials',exact=True).select_option('permission_received')
            page.get_by_label('Samples left',exact=True).fill('1')
            page.get_by_role('button',name='Submit visit',exact=True).click()
            page.get_by_text('Visit recorded.',exact=True).wait_for()
        visits=[r for r in own(w,'visits')['items'] if r['gig_id']==gig['id']]
        assert len(visits)==10 and len({r['business_name'] for r in visits})==10
        assert own(w,'leads')['items']==[] and own(w,'activity')['items']==[]
        decision(w,gig,'submit','Ten permitted unique business visits completed without attendance tracking.')
        item=w['read']('gig',gig['id'])['item'];assert item['status']=='submitted' and item['terms']==terms
        owner=owner_gig(w,gig)
        assert owner.get_by_role('combobox',name='Review action',exact=True).input_value()=='approve'
        assert 'Ten permitted unique business visits completed' in owner.locator('main').inner_text()
        page.goto(w['origin']+'/gigs/'+gig['id']);page.get_by_text('submitted',exact=True).wait_for()
        earnings=own(w,'earnings');assert earnings['totals']['submittedCents']==5000 and earnings['totals']['paidCents']==0
        assert earnings['items']==[] and reservations(w)=={'count':1,'total':5000}


def test_native_gig_decline_has_no_obligation_or_penalty_and_future_offer_can_be_accepted():
    with reviewed_budget_workspace() as w:
        gig=offer(w);before=own(w,'profile')['item']
        policy=next(p['settings'] for p in w['read']('programs')['items'] if p['id']==w['programId'])
        decision(w,gig,'decline')
        assert w['read']('gig',gig['id'])['item']['status']=='declined'
        assert reservations(w)=={'count':0,'total':0}
        assert own(w,'profile')['item']==before and own(w,'earnings')['items']==[]
        future=offer(w);w['accept'](future)
        old=w['read']('gig',gig['id'])['item'];new=w['read']('gig',future['id'])['item']
        assert old['status']=='declined' and new['status']=='accepted' and new['terms']==old['terms']
        assert reservations(w)=={'count':1,'total':5000}
        assert own(w,'profile')['program']['newWorkAvailable'] is True
        assert next(p['settings'] for p in w['read']('programs')['items'] if p['id']==w['programId'])==policy


def test_native_gig_unsafe_report_reaches_owner_without_location_tracking_or_retaliation():
    with reviewed_budget_workspace() as w:
        gig=offer(w);w['accept'](gig);page=w['pages'][0];commands=[]
        page.add_init_script("window.__gpsRequests=0;Object.defineProperty(navigator,'geolocation',{get(){window.__gpsRequests++;throw new Error('Synthetic GPS trap');}})")
        page.on('request',lambda request:commands.append(request.post_data_json) if request.method=='POST' and request.url.endswith('/commands') else None)
        reason='Synthetic unsafe access; stopped before entering and requesting owner help.'
        decision(w,gig,'report_unsafe',reason)
        assert page.evaluate('window.__gpsRequests')==0
        command=next(c for c in commands if c['action']=='gig.report_unsafe')
        assert set(command['input'])=={'gigId','expectedRevision','reason'}
        data=w['read']('gig',gig['id']);assert data['item']['status']=='cancellation_requested'
        assert any(e['event_type']=='gig.report_unsafe' and e['reason']==reason for e in data['events'])
        assert reason in owner_gig(w,gig).locator('main').inner_text()
        assert reservations(w)=={'count':1,'total':5000}
        future=offer(w);w['accept'](future)
        assert reservations(w)=={'count':2,'total':10000}
        assert own(w,'profile')['program']['newWorkAvailable'] is True
        assert own(w,'earnings')['totals']['paidCents']==0


def test_native_gig_offline_visit_and_work_submission_retry_after_committed_lost_responses():
    with reviewed_budget_workspace() as w:
        gig=offer(w);w['accept'](gig);page=w['pages'][0]
        page.wait_for_function('()=>!!navigator.serviceWorker.controller')
        page.goto(w['origin']+'/visits/new?gig='+gig['id'])
        page.get_by_label('Business name',exact=True).fill('Synthetic one offline permitted business')
        instant=page.evaluate("()=>{const d=new Date('2026-10-26T12:00:00Z');return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}")
        page.get_by_label('Visit time',exact=True).fill(instant)
        page.locator('#device-permission').check();page.context.set_offline(True)
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        assert not [v for v in w['read']('visits')['items'] if v['gig_id']==gig['id']]
        page.get_by_role('link',name='Device drafts',exact=True).click()
        attempts={'visit.record':[],'gig.submit':[]}
        def lose_committed_response(route):
            command=route.request.post_data_json;action=command['action']
            if action not in attempts:route.continue_();return
            attempts[action].append(command)
            if len(attempts[action])==1:
                response=route.fetch();assert response.status==200
                route.abort('failed')
            else:route.continue_()
        page.route('**/api/partner/v1/commands',lose_committed_response)
        page.context.set_offline(False)
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('0 drafts submitted. 1 remain on this device.',exact=True).wait_for()
        page.reload();page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('1 draft submitted. 0 remain on this device.',exact=True).wait_for()
        page.goto(w['origin']+'/gigs/'+gig['id'])
        page.get_by_role('combobox',name='Action',exact=True).select_option('submit')
        page.get_by_label('Reason or submission details',exact=True).fill('Synthetic offline business visit submitted for owner review.')
        page.get_by_role('button',name='Save decision',exact=True).click()
        page.get_by_text('Unable to reach the partner service. Check your connection and try again.',exact=True).wait_for()
        page.get_by_role('button',name='Save decision',exact=True).click()
        page.get_by_text('Decision recorded.',exact=True).wait_for()
        assert all(len(rows)==2 and rows[0]==rows[1] for rows in attempts.values())
        visits=[v for v in own(w,'visits')['items'] if v['gig_id']==gig['id']]
        assert len(visits)==1 and visits[0]['business_name']=='Synthetic one offline permitted business'
        data=w['read']('gig',gig['id'])
        assert data['item']['status']=='submitted'
        assert len([e for e in data['events'] if e['event_type']=='gig.submit'])==1
        assert reservations(w)=={'count':1,'total':5000} and own(w,'earnings')['totals']['paidCents']==0
