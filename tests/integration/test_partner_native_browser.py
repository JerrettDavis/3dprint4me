"""Real Chromium cookies/CORS and two-partner reads against disposable PostgreSQL.

This is the first native browser slice, not all nine packet feature scenarios.
"""
import json
import os
import queue
import subprocess
import threading
import time
import signal
import uuid
from contextlib import contextmanager
from tests.support.server import ROOT, free_port, request
from tests.support.browser_harness import SiteBrowser


@contextmanager
def native_partner_workspace():
    port, owner_port = free_port(), free_port()
    owner_origin = f'http://127.0.0.1:{owner_port}'
    shell_origin = f'http://127.0.0.1:{port}'
    container = '3dprint4me-partner-browser-' + uuid.uuid4().hex[:8]
    native = subprocess.Popen(['node', 'tests/support/partner-native-server.mjs'], cwd=ROOT,
                              env={**os.environ, 'PARTNER_NATIVE_BROWSER_TEST': '1', 'PARTNER_TEST_SHELL_ORIGIN': shell_origin, 'PARTNER_TEST_OWNER_ORIGIN':owner_origin, 'PARTNER_TEST_CONTAINER_NAME': container},
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=os.name != 'nt')
    lines = queue.Queue()
    threading.Thread(target=lambda: lines.put(native.stdout.readline()), daemon=True).start()
    shell = owner_shell = None
    try:
        first = lines.get(timeout=150)
        fixture = json.loads(first)
        shell = subprocess.Popen(['node', 'scripts/partner-server.mjs'], cwd=ROOT,
                                 env={**os.environ, 'PARTNER_PORT': str(port), 'PARTNER_API_ORIGIN': fixture['apiOrigin']},
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                if request(shell_origin)[0] == 200:
                    break
            except OSError:
                time.sleep(.08)
        else:
            raise TimeoutError('Partner static shell unavailable')
        owner_shell = subprocess.Popen(['node','scripts/operator-server.mjs'],cwd=ROOT,
            env={**os.environ,'OPERATOR_PORT':str(owner_port),'OPERATOR_API_BASE':fixture['apiOrigin']},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            try:
                if request(owner_origin+'/api/config')[0]==200:break
            except OSError:time.sleep(.08)
        else:raise TimeoutError('Owner shell unavailable')
        fixture['ownerOrigin']=owner_origin
        fixture['_process'] = native
        fixture['_container'] = container
        yield shell_origin, fixture
    finally:
        if owner_shell:
            owner_shell.terminate()
            try:owner_shell.wait(timeout=5)
            except subprocess.TimeoutExpired:
                owner_shell.kill();owner_shell.wait(timeout=5)
        if shell:
            shell.terminate()
            try:
                shell.wait(timeout=5)
            except subprocess.TimeoutExpired:
                shell.kill()
                shell.wait(timeout=5)
        if native.poll() is None:
            try:
                native.stdin.write('stop\n')
                native.stdin.flush()
                native.wait(timeout=15)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired):
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(native.pid), '/T', '/F'], capture_output=True, timeout=10)
                else:
                    os.killpg(native.pid, signal.SIGKILL)
                native.wait(timeout=5)
        # Verify exact name and label before fallback cleanup; never stop unrelated containers.
        inspected = subprocess.run(['docker', 'inspect', container], capture_output=True, text=True, timeout=15)
        if inspected.returncode == 0:
            details = json.loads(inspected.stdout)[0]
            assert details['Name'] == '/' + container
            assert details['Config']['Labels']['3dprint4me.purpose'] == 'partner-browser'
            subprocess.run(['docker', 'rm', '--force', container], check=True, capture_output=True, timeout=15)
        elif not any(message in inspected.stderr.lower() for message in ['no such object', 'no such container']):
            raise RuntimeError('Could not verify disposable partner container cleanup')


def test_native_partner_browser_cookie_csrf_idor_and_logout():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390, 844), reduced_motion='reduce') as site:
        page = site.page
        page.goto(origin)
        page.get_by_label('Account code', exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase', exact=True).fill(fixture['password'])
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_role('heading', name='Hello, Synthetic Partner 1.').wait_for()
        cookies = site.context.cookies()
        cookie = next(c for c in cookies if c['name'] == '__Host-3dp-partner')
        assert cookie['httpOnly'] and cookie['secure'] and cookie['sameSite'] == 'Strict' and cookie['path'] == '/'
        assert '__Host-3dp-partner' not in page.evaluate('document.cookie')
        page.reload()
        page.get_by_role('heading', name='Hello, Synthetic Partner 1.').wait_for()
        result = page.evaluate('''async ({api,other})=>{
          const response=await fetch(api+'/api/partner/v1/gig?id='+other,{credentials:'include',cache:'no-store'});
          return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
        }''', {'api': fixture['apiOrigin'], 'other': fixture['otherGigId']})
        assert result['status'] == 404 and result['cache'] == 'no-store'
        assert 'Synthetic Partner 2' not in json.dumps(result['body'])
        page.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
        page.get_by_label('Display name', exact=True).fill('Synthetic browser saved')
        page.get_by_role('button', name='Save profile', exact=True).click()
        page.get_by_text('Profile saved.', exact=True).wait_for()
        page.reload()
        assert page.get_by_label('Display name', exact=True).input_value() == 'Synthetic browser saved'
        with site.browser.new_context(viewport={'width':390,'height':844}, reduced_motion='reduce') as other:
            second = other.new_page()
            errors = []
            second.on('pageerror', lambda error: errors.append(str(error)))
            second.goto(origin)
            second.get_by_label('Account code', exact=True).fill(fixture['otherPartnerId'])
            second.get_by_label('Passphrase', exact=True).fill(fixture['password'])
            second.get_by_role('button', name='Sign in', exact=True).click()
            second.get_by_role('heading', name='Hello, Synthetic Partner 2.').wait_for()
            second_cookie = next(c for c in other.cookies() if c['name'] == '__Host-3dp-partner')
            assert second_cookie['value'] != cookie['value']
            denied = second.evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?id='+id,{credentials:'include'})).status", {'api': fixture['apiOrigin'], 'id': fixture['gigId']})
            assert denied == 404
            second.get_by_role('navigation').get_by_role('link', name='Profile', exact=True).click()
            assert second.get_by_label('Display name', exact=True).input_value() == 'Synthetic Partner 2'
            assert not errors
        page.get_by_role('button', name='Sign out', exact=True).click()
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        assert not any(c['name'] == '__Host-3dp-partner' for c in site.context.cookies())
        page.reload()
        page.get_by_role('heading', name='Your work. Your records.').wait_for()
        assert not site.page_errors


def test_native_partner_fixture_removes_its_container_after_child_crash():
    with native_partner_workspace() as (_, fixture):
        container = fixture['_container']
        inspected = subprocess.run(['docker', 'inspect', container], check=True, capture_output=True, text=True, timeout=15)
        assert json.loads(inspected.stdout)[0]['Config']['Labels']['3dprint4me.purpose'] == 'partner-browser'
        fixture['_process'].kill()
        fixture['_process'].wait(timeout=5)
    remaining = subprocess.run(['docker', 'ps', '--all', '--filter', 'name=^/' + container + '$', '--format', '{{.Names}}'], check=True, capture_output=True, text=True, timeout=15)
    assert not remaining.stdout.strip()


def test_native_business_visits_and_specific_contact_permission_persist_privately():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site:
        page=site.page;page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native business without contact')
        page.get_by_label('Outcome',exact=True).select_option('accepted_material')
        page.get_by_label('Permission to leave materials',exact=True).select_option('permission_received')
        page.get_by_label('Samples left',exact=True).fill('2')
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        page.reload();page.get_by_text('Native business without contact',exact=True).wait_for()
        assert 'No personal follow-up contacts recorded.' in page.locator('main').inner_text()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native business with permission')
        page.get_by_label('This person explicitly agreed to project follow-up.',exact=True).check()
        page.get_by_label('Project follow-up purpose',exact=True).fill('Consented printed sign discussion')
        page.get_by_label('Contact email',exact=True).fill('native-consent@example.test')
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        page.reload();page.get_by_text('native-consent@example.test',exact=True).wait_for()
        result=page.evaluate("async api=>(await (await fetch(api+'/api/partner/v1/leads',{credentials:'include'})).json())",fixture['apiOrigin'])
        assert len(result['items'])==1
        lead=result['items'][0];assert lead['purpose']=='Consented printed sign discussion'
        assert lead['status']=='needs_review' and lead['followUpAllowed'] is False
        assert 'withdraw this permission' in lead['consentText']
        assert 'native-consent@example.test' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        page.get_by_text('Correct contact details',exact=True).click()
        page.get_by_label('Contact email',exact=True).fill('native-corrected@example.test')
        page.get_by_label('Project follow-up purpose',exact=True).fill('Renewed permission for a printed sign replacement')
        page.get_by_label('This person renewed permission for these contact details and purpose.',exact=True).check()
        page.get_by_role('button',name='Save corrected contact',exact=True).click()
        page.get_by_text('Corrected contact saved for owner review.',exact=True).wait_for()
        page.reload();page.get_by_text('native-corrected@example.test',exact=True).wait_for()
        assert 'native-consent@example.test' not in page.locator('main').inner_text()
        page.get_by_role('button',name='Withdraw follow-up permission',exact=True).click()
        page.get_by_text('Follow-up permission withdrawn.',exact=True).wait_for()
        page.reload()
        suppressed=page.evaluate("async api=>(await (await fetch(api+'/api/partner/v1/leads',{credentials:'include'})).json()).items[0]",fixture['apiOrigin'])
        assert suppressed['status']=='withdrawn' and suppressed['followUpAllowed'] is False
        page.get_by_label('I understand this removes the contact details from active records.',exact=True).check()
        page.get_by_role('button',name='Delete contact details',exact=True).click()
        page.get_by_text('Contact details deleted.',exact=True).wait_for()
        page.reload();assert 'native-corrected@example.test' not in page.locator('main').inner_text()
        blocked=page.evaluate("""async ({api,gig})=>{
          const session=await (await fetch(api+'/api/partner/v1/session',{credentials:'include'})).json();
          const response=await fetch(api+'/api/partner/v1/commands',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({action:'visit.record',key:crypto.randomUUID(),input:{gigId:gig,expectedGigRevision:2,clientId:crypto.randomUUID(),businessName:'Native prohibited contact',approximateArea:'Tulsa',visitedAt:new Date().toISOString(),outcome:'unavailable',placement:'none',sampleCount:0,consent:false,contact:{email:'unpermitted@example.test',preferredContact:'email'}}})});
          const visits=await (await fetch(api+'/api/partner/v1/visits',{credentials:'include'})).json();
          return {status:response.status,count:visits.items.length};
        }""",{'api':fixture['apiOrigin'],'gig':fixture['acceptedGigId']})
        assert blocked=={'status':422,'count':2}
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native explicit device draft')
        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
        site.context.set_offline(True)
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        page.get_by_role('link',name='Device drafts',exact=True).click()
        page.get_by_text('Native explicit device draft',exact=True).wait_for()
        site.context.set_offline(False)
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('1 draft submitted. 0 remain on this device.',exact=True).wait_for()
        page.get_by_role('link',name='Recorded visits',exact=True).click()
        page.get_by_text('Native explicit device draft',exact=True).wait_for()


        assert not site.page_errors


def test_native_browser_replays_100_device_drafts_after_lost_committed_response():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site:
        page=site.page;page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native replay 0')
        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
        site.context.set_offline(True)
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        page.evaluate("""async ({account,gig})=>{
          const {createVisitDraftStore}=await import('/assets/drafts.js');
          const store=createVisitDraftStore({storage:localStorage,accountId:account});
          for(let n=1;n<100;n++)store.save({gigId:gig,expectedGigRevision:2,businessName:'Native replay '+n,approximateArea:'Tulsa',outcome:'unavailable',placement:'none',sampleCount:0,visitedAt:new Date().toISOString()});
        }""",{'account':fixture['partnerId'],'gig':fixture['acceptedGigId']})
        page.get_by_role('link',name='Device drafts',exact=True).click()
        assert page.get_by_role('button',name='Remove device draft',exact=True).count()==100
        requests=[]
        def lose_one_committed_response(route):
            requests.append(route.request.post_data_json)
            if len(requests)==51:
                response=route.fetch()
                assert response.status==200
                route.abort('failed')
            else:route.continue_()
        page.route('**/api/partner/v1/commands',lose_one_committed_response)
        site.context.set_offline(False)
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('50 drafts submitted. 50 remain on this device.',exact=True).wait_for(timeout=60000)
        page.reload()
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('50 drafts submitted. 0 remain on this device.',exact=True).wait_for(timeout=60000)
        assert len(requests)==101 and requests[50]==requests[51]
        records=page.evaluate("async api=>{const visits=await(await fetch(api+'/api/partner/v1/visits',{credentials:'include'})).json();const leads=await(await fetch(api+'/api/partner/v1/leads',{credentials:'include'})).json();return {visits:visits.items.length,leads:leads.items.length};}",fixture['apiOrigin'])
        assert records=={'visits':100,'leads':0}
        assert not site.page_errors


def test_native_expired_visit_session_hides_the_private_form():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;page.set_default_timeout(10000);page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native expired-session visit')
        page.get_by_label('This person explicitly agreed to project follow-up.',exact=True).check()
        page.get_by_label('Project follow-up purpose',exact=True).fill('Consented project request')
        page.get_by_label('Contact email',exact=True).fill('expired-private@example.test')
        site.context.clear_cookies()
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_role('heading',name='Your work. Your records.').wait_for()
        assert page.get_by_role('navigation').is_hidden()
        assert page.locator('[name=contactEmail]').count()==0
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native draft retained after expiry')
        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_role('link',name='Device drafts',exact=True).click()
        site.context.clear_cookies()
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_role('heading',name='Your work. Your records.').wait_for()
        assert 'Native draft retained after expiry' not in page.locator('main').inner_text()
        assert 'Native draft retained after expiry' in page.evaluate('JSON.stringify({...localStorage})')
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/drafts')
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('1 draft submitted. 0 remain on this device.',exact=True).wait_for()

        assert 'expired-private@example.test' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert not site.page_errors


def test_native_partner_counterproposal_persists_without_accepting_or_changing_fee():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390,844), color_scheme='dark', reduced_motion='reduce') as site:
        page = site.page
        page.goto(origin)
        page.get_by_label('Account code', exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase', exact=True).fill(fixture['password'])
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.get_by_role('heading', name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin + '/gigs/' + fixture['gigId'])
        page.get_by_label('Proposed fee (USD)', exact=True).fill('12.34')
        page.get_by_label('Message to the owner', exact=True).fill('Synthetic fee discussion <script>alert(1)</script>')
        page.get_by_role('button', name='Send counterproposal', exact=True).click()
        page.get_by_text('Counterproposal recorded. The offered fee is unchanged until the owner sends a revised offer.', exact=True).wait_for()
        page.reload()
        page.get_by_text('You proposed $12.34', exact=True).wait_for()
        assert '$10.00 offered fee' in page.locator('main').inner_text()
        assert page.locator('main script').count() == 0
        data = page.evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?id='+id,{credentials:'include'})).json()", {'api':fixture['apiOrigin'],'id':fixture['gigId']})
        assert data['item']['status'] == 'offered' and data['item']['acceptedAt'] is None
        assert data['item']['feeCents'] == 1000 and data['item']['revision'] == 2
        assert len(data['negotiations']) == 1 and data['negotiations'][0]['proposed_fee_cents'] == 1234
        denied = page.evaluate("async ({api,id})=>(await fetch(api+'/api/partner/v1/gig?id='+id,{credentials:'include'})).status", {'api':fixture['apiOrigin'],'id':fixture['otherGigId']})
        assert denied == 404
        page.goto(origin + '/gigs/' + fixture['acceptedGigId'])
        page.get_by_role('heading', name='Synthetic business visits', exact=True).wait_for()
        assert page.get_by_role('button', name='Send counterproposal', exact=True).count() == 0
        assert not site.page_errors


def test_native_customer_referral_request_records_permission_without_creating_a_bonus():
    with native_partner_workspace() as (origin, fixture), SiteBrowser(viewport=(390,844), reduced_motion='reduce') as site:
        referral={'code':fixture['referralCode'],'consent':True,'consentVersion':'referral-v1'}
        body={'projectTitle':'Synthetic referral request','service':'consult','description':'Independent project review.',
              'contact':{'name':'Synthetic customer','email':'customer@example.test'},'consent':True,'referral':referral}
        status, _, raw=request(fixture['apiOrigin']+'/api/request',method='POST',payload={'request':body})
        assert status==201
        request_id=json.loads(raw)['id']
        status, _, _=request(fixture['apiOrigin']+'/api/request',method='PATCH',payload={'id':request_id,'request':body,'uploadedFiles':[]})
        assert status==200
        assert request_id.startswith('3DP-') and all(c.isalnum() or c=='-' for c in request_id)
        result=subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-Atc',
            "SELECT json_build_object('payload',payload,'status',status,'awards',(SELECT count(*) FROM partner_referral_events),'attributions',(SELECT count(*) FROM partner_referral_attributions))::text FROM service_requests WHERE id='"+request_id+"'"],check=True,capture_output=True,text=True,timeout=15)
        saved=json.loads(result.stdout)
        assert saved['payload']['referral']==referral and saved['status']=='submitted'
        assert saved['awards']==0 and saved['attributions']==0
        assert saved['payload']['submittedAt']
        status, _, _=request(fixture['apiOrigin']+'/api/request',method='POST',payload={'request':{**body,'referral':{**referral,'consent':False}}})
        assert status==400
        page=site.page
        page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.get_by_role('navigation').get_by_role('link',name='Referrals',exact=True).click()
        page.get_by_text(fixture['referralCode'],exact=True).wait_for()
        assert 'No earned referral awards recorded.' in page.locator('main').inner_text()
        assert 'customer@example.test' not in page.locator('main').inner_text()
        page.get_by_role('button',name='Sign out',exact=True).click()
        page.get_by_label('Account code',exact=True).fill(fixture['otherPartnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 2.').wait_for()
        page.get_by_role('navigation').get_by_role('link',name='Referrals',exact=True).click()
        page.get_by_role('heading',name='No referral codes yet').wait_for()
        assert fixture['referralCode'] not in page.locator('main').inner_text()
        assert not site.page_errors


def test_native_owner_console_uses_github_binding_and_preserves_obligations_while_paused():
    with native_partner_workspace() as (origin,fixture), SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        owner=fixture['ownerOrigin'];api=fixture['apiOrigin'];page=site.page
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        page.goto(owner+'/partners')
        page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        assert 'New work unavailable' in page.locator('#partner-clearance').inner_text()
        page.get_by_label('Default weekly authorization (USD)',exact=True).fill('175.25')
        page.get_by_role('button',name='Save program controls',exact=True).click()
        page.get_by_text('Program controls saved.',exact=True).wait_for()
        page.reload()
        assert page.get_by_label('Default weekly authorization (USD)',exact=True).input_value()=='175.25'
        with site.browser.new_context(viewport={'width':390,'height':844}) as other:
            other.add_cookies([{'name':'__Host-3dp-session','value':fixture['operatorToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
            denied=other.new_page();denied.goto(owner+'/partners')
            denied.get_by_role('heading',name='Owner access required',exact=True).wait_for()
            assert denied.locator('main form').count()==0
        # An existing accepted obligation can be submitted/reviewed despite disabled new work.
        with site.browser.new_context(viewport={'width':390,'height':844}) as partner_context:
            partner_page=partner_context.new_page();partner_page.goto(origin)
            partner_page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
            partner_page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
            partner_page.get_by_role('button',name='Sign in',exact=True).click()
            partner_page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
            partner_page.goto(origin+'/gigs/'+fixture['acceptedGigId'])
            partner_page.get_by_role('combobox',name='Action',exact=True).select_option('submit')
            partner_page.get_by_label('Reason or submission details',exact=True).fill('Synthetic completed permitted introductions.')
            partner_page.get_by_role('button',name='Save decision',exact=True).click()
            partner_page.get_by_text('Decision recorded.',exact=True).wait_for()
            page.goto(owner+'/partners#gig/'+fixture['acceptedGigId'])
            page.get_by_role('combobox',name='Review action',exact=True).select_option('approve')
            page.get_by_label('Review reason',exact=True).fill('Objective deliverables verified.')
            page.get_by_role('button',name='Record gig review',exact=True).click()
            page.get_by_text('Gig review recorded.',exact=True).wait_for()
            page.get_by_role('combobox',name='Review action',exact=True).select_option('make_payable')
            page.get_by_role('button',name='Record gig review',exact=True).click()
            page.get_by_text('Gig review recorded.',exact=True).wait_for()
            result=page.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=ledger',{credentials:'include'})).json()",api)
            assert any(row['amountDueCents']==1000 and row['outstandingCents']==1000 for row in result['items'])
            partner_page.goto(origin+'/earnings')
            partner_page.get_by_role('heading',name='Your earnings',exact=True).wait_for()
            assert '$10.00' in partner_page.locator('main').inner_text()
            assert 'Verified paid' in partner_page.locator('main').inner_text()
        assert not site.page_errors
