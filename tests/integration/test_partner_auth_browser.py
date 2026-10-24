"""Direct native mappings for all partner-auth.feature scenarios; no real accounts."""
import json
import subprocess
from urllib.parse import urlsplit
from tests.support.partner_budget import reviewed_budget_workspace,finish_gig


def program_accounts(w):return [r for r in w['read']('partners')['items'] if r['program_id']==w['programId']]


def counts(w):
    sql="SELECT json_build_object('accounts',(SELECT count(*) FROM partner_accounts WHERE program_id='"+w['programId']+"'),'sessions',(SELECT count(*) FROM partner_sessions s JOIN partner_accounts a ON a.id=s.partner_id WHERE a.program_id='"+w['programId']+"'))"
    result=subprocess.run(['docker','exec',w['fixture']['_container'],'psql','-U','postgres','-Atc',sql],check=True,capture_output=True,text=True,timeout=15)
    return json.loads(result.stdout)


def redeem(page,origin,token):
    page.goto(origin+'/join');page.get_by_label('Invitation or recovery code',exact=True).fill(token)
    page.get_by_label('Choose a passphrase',exact=True).fill('Synthetic private enrollment passphrase')
    page.get_by_role('button',name='Set passphrase and continue',exact=True).click()


def test_native_auth_initial_enrollment_without_github_has_private_host_cookie():
    with reviewed_budget_workspace() as w:
        assert counts(w)=={'accounts':2,'sessions':2}
        for n,page in enumerate(w['pages']):
            page.goto(w['origin']);page.get_by_role('heading',name='Hello, Budget Partner '+str(n+1)+'.',exact=True).wait_for()
            cookie=next(c for c in page.context.cookies() if c['name']=='__Host-3dp-partner')
            assert cookie['httpOnly'] and cookie['secure'] and cookie['sameSite']=='Strict' and cookie['path']=='/' and cookie['domain']=='127.0.0.1'
            assert '__Host-3dp-partner' not in page.evaluate('document.cookie')
            assert all(urlsplit(url).hostname=='127.0.0.1' for url in w['requests'][n])
            assert 'Budget Partner '+str(2-n) not in page.locator('main').inner_text()
            assert page.get_by_role('link',name='Sign in with GitHub',exact=True).count()==0
        assert all(a['status']=='active' for a in program_accounts(w))


def test_native_auth_invitation_replay_from_another_browser_is_denied():
    with reviewed_budget_workspace() as w:
        before=counts(w)
        with w['site'].browser.new_context(viewport={'width':390,'height':844}) as other:
            page=other.new_page();redeem(page,w['origin'],w['invites'][0]['token'])
            page.get_by_text('Sign-in could not be completed. Check your details or contact the owner.',exact=True).wait_for()
            assert not any(c['name']=='__Host-3dp-partner' for c in other.cookies())
            assert page.get_by_role('heading',name='Set up your private access',exact=True).count()==1
        assert counts(w)==before=={'accounts':2,'sessions':2}


def test_native_auth_revocation_interrupts_live_profile_mutation():
    with reviewed_budget_workspace() as w:
        page=w['pages'][0];page.goto(w['origin']+'/profile');page.get_by_label('Display name',exact=True).fill('Must not persist after revocation')
        w['post']('partner.revoke',{'partnerId':w['accounts'][0]['id'],'status':'suspended'})
        with page.expect_response(lambda response:response.url.endswith('/api/partner/v1/commands') and response.request.method=='POST') as response:
            page.get_by_role('button',name='Save profile',exact=True).click()
        assert response.value.status==401
        page.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        assert page.get_by_role('navigation').is_hidden()
        assert 'Contact the owner for help' in page.locator('main').inner_text()
        account=next(a for a in program_accounts(w) if a['id']==w['accounts'][0]['id'])
        assert account['status']=='suspended' and account['display_name']=='Budget Partner 1'
        assert 'Must not persist after revocation' not in page.locator('main').inner_text()


def test_native_auth_other_earnings_and_existing_owner_work_api_deny_partner_credentials():
    with reviewed_budget_workspace(work_seed=True) as w:
        api=w['fixture']['apiOrigin'];private_id=w['fixture']['privateWorkId'];assert private_id
        owner=w['owner'];owner_origin=w['fixture']['ownerOrigin']
        positive=owner.evaluate("async ({api,id})=>{const r=await fetch(api+'/api/operator-work?id='+id,{credentials:'include'});return {status:r.status,body:await r.json()};}",{'api':api,'id':private_id})
        assert positive['status']==200 and positive['body']['item']['id']==private_id
        assert 'private-customer@example.test' in json.dumps(positive['body'])
        gig=w['offer'](6000,partner=1);w['accept'](gig,partner=1);payable=finish_gig(w,gig,partner=1)
        own=w['pages'][1].evaluate("async api=>(await(await fetch(api+'/api/partner/v1/earnings',{credentials:'include'})).json()).items",api)
        assert any(r['id']==payable['id'] and r['amountDueCents']==6000 for r in own)
        page=w['pages'][0]
        earnings=page.evaluate("async ({api,id})=>{const own=await fetch(api+'/api/partner/v1/earnings',{credentials:'include'});const other=await fetch(api+'/api/partner/v1/earnings?id='+id,{credentials:'include'});return {own:own.status,ownItems:(await own.json()).items,other:other.status,body:await other.json()};}",{'api':api,'id':payable['id']})
        assert earnings['own']==200 and earnings['ownItems']==[] and earnings['other']==404
        assert set(earnings['body'])=={'error'} and payable['id'] not in json.dumps(earnings['body'])
        assert 'Budget Partner 2' not in json.dumps(earnings['body'])
        cookie=next(c['value'] for c in page.context.cookies() if c['name']=='__Host-3dp-partner')
        # Trusted-origin HTTP client bypasses only browser CORS, not the real cookie authorizer.
        for cookie_name in ['__Host-3dp-partner','__Host-3dp-session']:
            denied=page.request.get(api+'/api/operator-work?id='+private_id,headers={'Origin':owner_origin,'Cookie':cookie_name+'='+cookie})
            assert denied.status==401 and denied.json()['code']=='sign_in_required'
            assert 'private-customer@example.test' not in denied.text() and 'Synthetic owner-only project' not in denied.text()
        owner_after=owner.evaluate("async ({api,id})=>(await fetch(api+'/api/operator-work?id='+id,{credentials:'include'})).status",{'api':api,'id':private_id})
        assert owner_after==200


def test_native_auth_disabled_environment_blocks_redemption_without_consuming_invite():
    with reviewed_budget_workspace(program_flag_control=True) as w:
        account=w['post']('partner.create',{'programId':w['programId'],'displayName':'Unactivated synthetic partner'})
        invite=w['post']('partner.invite',{'partnerId':account['id'],'purpose':'enroll'})
        w['fixture']['setProgramEnabled'](False)
        program=next(p for p in w['read']('programs')['items'] if p['id']==w['programId'])
        assert program['enabled'] is True and program['clearance']['missing']==['program_environment']
        with w['site'].browser.new_context(viewport={'width':390,'height':844}) as other:
            page=other.new_page();redeem(page,w['origin'],invite['token'])
            page.get_by_text('Partner enrollment is currently unavailable.',exact=True).wait_for()
            assert not any(c['name']=='__Host-3dp-partner' for c in other.cookies())
            current=next(a for a in program_accounts(w) if a['id']==account['id']);assert current['status']=='invited'
            # The same genuine code succeeds after reenabling: denial was the flag, not bad setup.
            w['fixture']['setProgramEnabled'](True);redeem(page,w['origin'],invite['token'])
            page.get_by_role('heading',name='Hello, Unactivated synthetic partner.',exact=True).wait_for()
        assert counts(w)=={'accounts':3,'sessions':3}
