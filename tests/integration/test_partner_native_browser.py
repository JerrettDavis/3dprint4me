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
import tempfile
from pathlib import Path
import uuid
from contextlib import contextmanager
from tests.support.server import ROOT, free_port, request
from tests.support.browser_harness import SiteBrowser


@contextmanager
def native_partner_workspace(*,enable_reviewed_launch=False,clock=None,work_seed=False,program_flag_control=False,observe_outbound=False):
    port, owner_port = free_port(), free_port()
    owner_origin = f'http://127.0.0.1:{owner_port}'
    shell_origin = f'http://127.0.0.1:{port}'
    container = '3dprint4me-partner-browser-' + uuid.uuid4().hex[:8]
    clock_root=tempfile.TemporaryDirectory(prefix='3dprint4me-partner-clock-') if clock or program_flag_control or observe_outbound else None
    clock_path=Path(clock_root.name)/'clock.json' if clock_root else None
    def set_clock(value):
        from datetime import datetime
        instant=datetime.fromisoformat(value.replace('Z','+00:00'))
        assert instant.tzinfo is not None and 2026<=instant.year<=2027
        temporary=clock_path.with_suffix('.next');temporary.write_text(json.dumps(value),encoding='utf-8');temporary.replace(clock_path)
    flag_path=Path(clock_root.name)/'program-flag.json' if program_flag_control else None
    def set_program_enabled(value):
        assert type(value) is bool
        temporary=flag_path.with_suffix('.next');temporary.write_text(json.dumps(value),encoding='utf-8');temporary.replace(flag_path)
    outbound_path=Path(clock_root.name)/'outbound-count.txt' if observe_outbound else None
    if clock:set_clock(clock)
    if program_flag_control:set_program_enabled(enable_reviewed_launch)
    native = subprocess.Popen(['node', 'tests/support/partner-native-server.mjs'], cwd=ROOT,
                              env={**os.environ, 'PARTNER_NATIVE_BROWSER_TEST': '1', 'PARTNER_TEST_CLOCK_FILE':str(clock_path) if clock else '', 'PARTNER_TEST_PROGRAM_FLAG_FILE':str(flag_path) if flag_path else '', 'PARTNER_TEST_WORK_SEED':'1' if work_seed else '0', 'PARTNER_TEST_OUTBOUND_FILE':str(outbound_path) if outbound_path else '', 'PARTNER_TEST_SHELL_ORIGIN': shell_origin, 'PARTNER_TEST_OWNER_ORIGIN':owner_origin, 'PARTNER_TEST_CONTAINER_NAME': container, 'PARTNER_TEST_REVIEWED_LAUNCH':'1' if enable_reviewed_launch else '0'},
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
        fixture['setClock']=set_clock if clock else None
        fixture['setProgramEnabled']=set_program_enabled if program_flag_control else None
        fixture['outboundAttempts']=(lambda:int(outbound_path.read_text(encoding='utf-8'))) if observe_outbound else None
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
        if clock_root:clock_root.cleanup()


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
            partner_page.goto(origin+'/profile')
            partner_page.get_by_label('Display name',exact=True).wait_for()
            page.goto(owner+'/partners#partners')
            access=page.locator('[data-partner-access="'+fixture['partnerId']+'"]')
            access.get_by_role('combobox',name='Access change',exact=True).select_option('suspended')
            access.get_by_label('I understand that this ends access and invalidates unused codes without changing amounts owed.',exact=True).check()
            access.get_by_role('button',name='Apply access change',exact=True).click()
            page.get_by_text('Portal access suspended. Existing obligations are unchanged.',exact=True).wait_for()
            partner_page.get_by_role('button',name='Save profile',exact=True).click()
            partner_page.get_by_role('heading',name='Your work. Your records.').wait_for()
            assert partner_page.get_by_label('Display name',exact=True).count()==0
            access.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
            access.get_by_role('button',name='Issue recovery code',exact=True).click()
            code=access.get_by_label('One-time recovery code',exact=True)
            code.wait_for()
            token=code.input_value()
            assert code.get_attribute('type')=='password' and token not in page.url
            partner_page.goto(origin+'/join')
            partner_page.get_by_label('Invitation or recovery code',exact=True).fill(token)
            partner_page.get_by_label('Choose a passphrase',exact=True).fill('Synthetic restored partner passphrase')
            partner_page.get_by_role('button',name='Set passphrase and continue',exact=True).click()
            partner_page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
            partner_page.goto(origin+'/earnings')
            partner_page.get_by_role('heading',name='Your earnings',exact=True).wait_for()
            assert '$10.00' in partner_page.locator('main').inner_text()
            result=page.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=ledger',{credentials:'include'})).json()",api)
            assert any(row['amountDueCents']==1000 and row['outstandingCents']==1000 for row in result['items'])
        assert not site.page_errors


def test_native_owner_referral_conversion_requires_settlement_and_awards_once():
    with native_partner_workspace() as (origin,fixture), SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        api=fixture['apiOrigin'];owner=fixture['ownerOrigin'];page=site.page
        body={'projectTitle':'Native opted-in sign project','service':'consult','description':'Independent project review.',
              'contact':{'name':'Synthetic customer','email':'native-sale@example.test'},'consent':True,
              'referral':{'code':fixture['referralCode'],'consent':True,'consentVersion':'referral-v1'}}
        status,_,raw=request(api+'/api/request',method='POST',payload={'request':body})
        assert status==201
        request_id=json.loads(raw)['id']
        status,_,_=request(api+'/api/request',method='PATCH',payload={'id':request_id,'request':body,'uploadedFiles':[]})
        assert status==200
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        page.goto(owner+'/partners#referrals')
        page.get_by_role('heading',name='Referral review',exact=True).wait_for()
        assert 'New work unavailable' in page.locator('#partner-clearance').inner_text()
        form=page.locator('[data-web-attribution]')
        form.get_by_role('combobox',name='Consenting web request',exact=True).select_option(request_id)
        assert form.get_by_label('Server permission receipt (UTC)',exact=True).input_value()
        form.get_by_label('Permission evidence reference',exact=True).fill('Native private web request permission checked')
        form.get_by_label('Customer opt-in for this referral code is verified.',exact=True).check()
        form.get_by_label('I verified this is an independent customer, not a participant purchase.',exact=True).check()
        form.get_by_role('button',name='Record attribution',exact=True).click()
        page.get_by_text('Attribution recorded. No sale or bonus was created.',exact=True).wait_for()
        read=lambda:page.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=referrals',{credentials:'include'})).json()",api)
        data=read()
        assert len(data['attributions'])==1 and len(data['awards'])==0 and len(data['sales'])==0
        attribution_id=data['attributions'][0]['id']
        def complete_sale(reference):
            form=page.locator('[data-sale-verification]')
            form.get_by_role('combobox',name='Attributed request',exact=True).select_option(attribution_id)
            form.get_by_label('Settled amount (USD)',exact=True).fill('125.00')
            form.get_by_label('Settlement reference',exact=True).fill(reference)
            form.get_by_role('combobox',name='Settlement method',exact=True).select_option('bank_transfer')
            from datetime import datetime,timezone
            form.get_by_label('Settled at (ISO 8601 with timezone)',exact=True).fill(datetime.now(timezone.utc).isoformat())
            for label in ['I independently verified settlement outside this portal.','This customer purchase is paid in full.','I reviewed refunds and reversals.','I verified this is an independent customer, not a participant purchase.']:
                form.get_by_label(label,exact=True).check()
            form.get_by_role('button',name='Record verified sale',exact=True).click()
        complete_sale('https://checkout.example/return?paid=1')
        page.get_by_text('Record an actual settlement reference, method and consistent payment time.',exact=True).wait_for()
        assert len(read()['sales'])==0 and len(read()['awards'])==0
        complete_sale('NATIVE-SYNTHETIC-BANK-1')
        page.get_by_text('Sale evidence recorded. No bonus was awarded.',exact=True).wait_for()
        data=read();sale_id=data['sales'][0]['id']
        assert data['awards']==[]
        def award():
            form=page.locator('[data-award-rule="sale"]')
            form.get_by_role('combobox',name='Verified settlement evidence',exact=True).select_option(sale_id)
            form.get_by_label('The frozen qualification criteria and deadline are met.',exact=True).check()
            form.get_by_label('I reviewed self-referral, duplicate and collusion checks.',exact=True).check()
            form.get_by_role('button',name='Award accepted bonus',exact=True).click()
            page.get_by_text('Earned bonus recorded as payable. This is not a payment confirmation.',exact=True).wait_for()
        award();award()
        data=read()
        assert len(data['awards'])==1 and data['awards'][0]['amountCents']==500
        complete_sale('NATIVE-SYNTHETIC-BANK-1')
        page.get_by_text('This settlement evidence is already recorded.',exact=True).wait_for()
        counts=subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-Atc',
            "SELECT json_build_object('awards',(SELECT count(*) FROM partner_referral_events),'payables',(SELECT count(*) FROM partner_payables),'sale_evidence',(SELECT count(*) FROM partner_sale_evidence),'committed',(SELECT committed_cents FROM partner_program_weeks))::text"],check=True,capture_output=True,text=True,timeout=15)
        assert json.loads(counts.stdout)=={'awards':1,'payables':1,'sale_evidence':1,'committed':2500}
        with site.browser.new_context(viewport={'width':390,'height':844}) as partner_context:
            other=partner_context.new_page();other.goto(origin)
            other.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
            other.get_by_label('Passphrase',exact=True).fill(fixture['password'])
            other.get_by_role('button',name='Sign in',exact=True).click()
            other.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
            other.goto(origin+'/referrals')
            other.get_by_text(fixture['referralCode'],exact=True).first.wait_for()
            assert '$5.00' in other.locator('main').inner_text()
            assert 'native-sale@example.test' not in other.locator('main').inner_text()
            assert 'NATIVE-SYNTHETIC-BANK-1' not in other.locator('main').inner_text()
            own=other.evaluate("async api=>(await fetch(api+'/api/partner/v1/referrals',{credentials:'include'})).json()",api)
            assert all(key not in own for key in ['attributions','sales','qualifications','requests'])
        assert not site.page_errors


def test_native_owner_lead_review_correction_and_withdrawal_update_live_permission():
    with native_partner_workspace() as (origin,fixture), SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site:
        page=site.page;api=fixture['apiOrigin'];page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_label('Business name',exact=True).fill('Native owner review business')
        page.get_by_label('This person explicitly agreed to project follow-up.',exact=True).check()
        page.get_by_label('Project follow-up purpose',exact=True).fill('Requested project sign discussion')
        page.get_by_label('Contact email',exact=True).fill('owner-review@example.test')
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        with site.browser.new_context(viewport={'width':390,'height':844}) as owner_context:
            owner_context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
            owner=owner_context.new_page();owner.goto(fixture['ownerOrigin']+'/partners#leads')
            owner.get_by_role('heading',name='Lead follow-up',exact=True).wait_for()
            owner.get_by_label('Review reason',exact=True).fill('Specific project interest and permission checked.')
            owner.get_by_role('button',name='Record lead review',exact=True).click()
            owner.get_by_text('Lead review recorded. No bonus was created.',exact=True).wait_for()
            assert 'Follow-up permitted for the recorded purpose' in owner.locator('main').inner_text()
            owner.get_by_text('Correct contact or purpose',exact=True).click()
            owner.get_by_label('Email',exact=True).fill('owner-renewed@example.test')
            owner.get_by_role('textbox',name='Project purpose',exact=True).fill('Renewed permission for the replacement sign project')
            owner.get_by_label('Renewed purpose-specific permission was explicitly given for these corrected details.',exact=True).check()
            owner.get_by_role('button',name='Save corrected contact',exact=True).click()
            owner.get_by_text('Contact correction recorded. Review the current permission before follow-up.',exact=True).wait_for()
            assert 'Follow-up unavailable' in owner.locator('main').inner_text()
            assert 'owner-review@example.test' not in owner.locator('main').inner_text()
            owner.get_by_label('I confirmed the requested suppression or deletion. Existing obligations remain unchanged.',exact=True).check()
            owner.get_by_role('button',name='Apply permission action',exact=True).click()
            owner.get_by_text('Permission action recorded. Follow-up is suppressed.',exact=True).wait_for()
            assert 'owner-renewed@example.test' not in owner.locator('main').inner_text()
            live=page.evaluate("async api=>(await (await fetch(api+'/api/partner/v1/leads',{credentials:'include'})).json()).items[0]",api)
            assert live['status']=='withdrawn' and live['followUpAllowed'] is False and live['revision']==4
            assert live['withdrawnAt']
            assert owner.get_by_role('button',name='Record lead review',exact=True).count()==0
            owner.get_by_label('I confirmed the requested suppression or deletion. Existing obligations remain unchanged.',exact=True).check()
            owner.get_by_role('button',name='Apply permission action',exact=True).click()
            owner.get_by_text('Permission action recorded. Follow-up is suppressed.',exact=True).wait_for()
            live=page.evaluate("async api=>(await (await fetch(api+'/api/partner/v1/leads',{credentials:'include'})).json()).items[0]",api)
            assert live['contact']=={} and live['deletedAt'] and live['followUpAllowed'] is False
            data=owner.evaluate("async api=>(await (await fetch(api+'/api/operator-partners?resource=referrals',{credentials:'include'})).json())",api)
            assert len(data['qualifications'])==1 and data['qualifications'][0]['followUpAllowed'] is False
            assert data['awards']==[]
        assert not site.page_errors


def test_native_owner_finance_preserves_payment_evidence_and_durable_csv_after_lost_response():
    from datetime import datetime,timezone
    import csv
    import io
    with native_partner_workspace() as (origin,fixture), SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site:
        page=site.page;api=fixture['apiOrigin'];owner=fixture['ownerOrigin']
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        with site.browser.new_context(viewport={'width':390,'height':844}) as partner_context:
            partner=partner_context.new_page();partner.goto(origin)
            partner.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
            partner.get_by_label('Passphrase',exact=True).fill(fixture['password'])
            partner.get_by_role('button',name='Sign in',exact=True).click()
            partner.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
            partner.goto(origin+'/gigs/'+fixture['acceptedGigId'])
            partner.get_by_role('combobox',name='Action',exact=True).select_option('submit')
            partner.get_by_label('Reason or submission details',exact=True).fill('Synthetic completed work for finance verification.')
            partner.get_by_role('button',name='Save decision',exact=True).click()
            partner.get_by_text('Decision recorded.',exact=True).wait_for()
            page.goto(owner+'/partners#gig/'+fixture['acceptedGigId'])
            for action in ['approve','make_payable']:
                page.get_by_role('combobox',name='Review action',exact=True).select_option(action)
                page.get_by_label('Review reason',exact=True).fill('Synthetic objective work reviewed.')
                page.get_by_role('button',name='Record gig review',exact=True).click()
                page.get_by_text('Gig review recorded.',exact=True).wait_for()
            page.goto(owner+'/partners#finance')
            page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
            read=lambda resource:page.evaluate("async ({api,resource})=>(await fetch(api+'/api/operator-partners?resource='+resource,{credentials:'include'})).json()",{'api':api,'resource':resource})
            assert read('ledger')['totals']['outstandingCents']==1000
            attempts=[];lost=[False]
            def lose_first_payment(route):
                if route.request.method=='POST' and route.request.post_data_json['action']=='payment.record':
                    attempts.append(route.request.post_data_json);response=route.fetch();assert response.status==200
                    if not lost[0]:lost[0]=True;route.abort()
                    else:route.fulfill(response=response)
                else:route.fallback()
            page.route('**/api/operator-partners*',lose_first_payment)
            def payment(amount,reference):
                form=page.locator('[data-payment]')
                form.get_by_label('Settled payment (USD)',exact=True).fill(amount)
                form.get_by_label('Payment reference',exact=True).fill(reference)
                form.get_by_label('Settled at (ISO 8601 with timezone)',exact=True).fill(datetime.now(timezone.utc).isoformat())
                form.get_by_label('I independently verified that this payment actually settled.',exact=True).check()
                form.get_by_role('button',name='Record verified payment',exact=True).click()
            payment('4.00','NATIVE-PAYMENT-1')
            page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
            assert read('ledger')['totals']['paidCents']==400
            page.get_by_role('button',name='Record verified payment',exact=True).click()
            page.get_by_text('Verified payment recorded. Review the updated outstanding amount.',exact=True).wait_for()
            assert attempts[0]==attempts[1]
            payment('6.00','NATIVE-PAYMENT-2')
            page.get_by_text('Verified payment recorded. Review the updated outstanding amount.',exact=True).wait_for()
            data=read('ledger');assert data['totals']['paidCents']==1000 and data['totals']['outstandingCents']==0
            original=next(e for e in data['paymentEvents'] if e['payment_reference']=='NATIVE-PAYMENT-2')
            form=page.locator('[data-reversal="'+original['id']+'"]')
            form.locator('..').get_by_text('Record a confirmed returned transfer',exact=True).click()
            form.get_by_label('Nonsettlement reference',exact=True).fill('NATIVE-RETURN-2')
            form.get_by_label('Reversed at (ISO 8601 with timezone)',exact=True).fill(datetime.now(timezone.utc).isoformat())
            form.get_by_label('Reversal reason',exact=True).fill('Synthetic bank confirmation of returned transfer.')
            form.get_by_label('I verified nonsettlement or return of this original payment.',exact=True).check()
            form.get_by_role('button',name='Record payment reversal',exact=True).click()
            page.get_by_text('Reversal recorded. The original event remains in the ledger.',exact=True).wait_for()
            assert read('ledger')['totals']['outstandingCents']==600
            page.get_by_text('Record an evidenced obligation adjustment',exact=True).click()
            form=page.locator('[data-adjustment]')
            form.get_by_label('Adjustment (USD, positive or negative)',exact=True).fill('2.00')
            form.get_by_label('Adjustment reason',exact=True).fill('Additional externally documented obligation.')
            form.get_by_label('Resolution reference',exact=True).fill('NATIVE-RESOLUTION-1')
            for label in ['The partner acknowledged this resolution.','I verified the external resolution evidence.']:form.get_by_label(label,exact=True).check()
            form.get_by_role('button',name='Record obligation adjustment',exact=True).click()
            page.get_by_text('Adjustment recorded. Accepted terms and prior evidence are unchanged.',exact=True).wait_for()
            assert read('ledger')['totals']['outstandingCents']==800
            payment('8.00','NATIVE-PAYMENT-3')
            page.get_by_text('Verified payment recorded. Review the updated outstanding amount.',exact=True).wait_for()
            data=read('ledger');assert data['totals']['paidCents']==1200 and len(data['paymentEvents'])==4
            # A separate accepted obligation can be resolved after a safety report while new work is off.
            referral_gig=read('referrals')['items'][0]['gigId']
            partner.goto(origin+'/gigs/'+referral_gig)
            partner.get_by_role('combobox',name='Action',exact=True).select_option('report_unsafe')
            partner.get_by_label('Reason or submission details',exact=True).fill('Synthetic unsafe access; partial work needs resolution.')
            partner.get_by_role('button',name='Save decision',exact=True).click()
            partner.get_by_text('Decision recorded.',exact=True).wait_for()
            page.reload();page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
            page.get_by_text('Reconcile accepted work',exact=True).click()
            form=page.locator('[data-reconciliation="'+referral_gig+'"]')
            form.get_by_label('Agreed obligation (USD)',exact=True).fill('5.00')
            form.get_by_label('Resolution reason',exact=True).fill('Synthetic acknowledged safety resolution.')
            form.get_by_label('Resolution reference',exact=True).fill('NATIVE-SAFETY-RESOLUTION')
            for label in ['The partner acknowledged this resolution.','I verified the external resolution evidence.']:form.get_by_label(label,exact=True).check()
            form.get_by_role('button',name='Record resolved obligation',exact=True).click()
            page.get_by_text('Resolution recorded. This does not confirm a payment.',exact=True).wait_for()
            assert read('ledger')['totals']['outstandingCents']==500
            export_attempts=[];lost_export=[False]
            def lose_first_export(route):
                if route.request.method=='POST' and route.request.post_data_json['action']=='finance.export':
                    export_attempts.append(route.request.post_data_json);response=route.fetch();assert response.status==200
                    if not lost_export[0]:lost_export[0]=True;route.abort()
                    else:route.fulfill(response=response)
                else:route.fallback()
            page.route('**/api/operator-partners*',lose_first_export)
            form=page.locator('[data-finance-export]')
            form.get_by_role('combobox',name='Accounting basis',exact=True).select_option('cash')
            form.get_by_role('button',name='Create incremental CSV batch',exact=True).click()
            page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
            assert len(read('exports')['items'])==1
            form.get_by_role('button',name='Create incremental CSV batch',exact=True).click()
            page.get_by_role('heading',name='Accounting export',exact=True).wait_for()
            assert export_attempts[0]==export_attempts[1]
            with page.expect_download() as event:page.get_by_role('link',name='Download verified CSV',exact=True).click()
            cash=event.value.path().read_text()
            rows=list(csv.DictReader(io.StringIO(cash)));assert len(rows)==4 and sum(int(row['amount_cents']) for row in rows)==1200
            assert any(row['record_kind']=='reversed' and row['amount_cents']=='-600' for row in rows)
            assert all(row['tax_reporting_class']=='review_required' for row in rows)
            first_url=page.url;page.reload();page.get_by_role('link',name='Download verified CSV',exact=True).wait_for()
            with page.expect_download() as event:page.get_by_role('link',name='Download verified CSV',exact=True).click()
            assert event.value.path().read_text()==cash and page.url==first_url
            for basis,expected_count,total in [('accrual',4,1700),('cash',0,0)]:
                page.get_by_role('link',name='Return to finance and batch history',exact=True).click()
                page.get_by_role('heading',name='Partner finance',exact=True).wait_for()
                form=page.locator('[data-finance-export]');form.get_by_role('combobox',name='Accounting basis',exact=True).select_option(basis)
                form.get_by_role('button',name='Create incremental CSV batch',exact=True).click()
                page.get_by_role('heading',name='Accounting export',exact=True).wait_for()
                with page.expect_download() as event:page.get_by_role('link',name='Download verified CSV',exact=True).click()
                rows=list(csv.DictReader(io.StringIO(event.value.path().read_text())))
                assert len(rows)==expected_count and sum(int(row['amount_cents']) for row in rows)==total
            partner.goto(origin+'/earnings');partner.get_by_role('heading',name='Your earnings',exact=True).wait_for()
            totals=partner.evaluate("async api=>(await (await fetch(api+'/api/partner/v1/earnings',{credentials:'include'})).json()).totals",api)
            assert totals['paidCents']==1200 and totals['outstandingCents']==500
            state=subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-Atc',
                "SELECT json_build_object('payments',(SELECT count(*) FROM partner_payment_events),'batches',(SELECT count(*) FROM partner_export_batches WHERE kind='accounting'),'adjustments',(SELECT count(*) FROM partner_payable_adjustments),'committed',(SELECT committed_cents FROM partner_program_weeks),'fees',(SELECT sum(accepted_fee_cents) FROM partner_gigs WHERE accepted_at IS NOT NULL))::text"],check=True,capture_output=True,text=True,timeout=15)
            assert json.loads(state.stdout)=={'payments':4,'batches':3,'adjustments':2,'committed':2500,'fees':2000}
        assert not site.page_errors


def test_native_owner_legal_editor_preserves_versions_comments_and_conflicting_draft():
    with native_partner_workspace() as (_,fixture), SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        page=site.page;api=fixture['apiOrigin'];owner=fixture['ownerOrigin']
        cookie={'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}
        site.context.add_cookies([cookie]);page.goto(owner+'/partners#legal')
        page.get_by_role('heading',name='Legal templates',exact=True).wait_for()
        page.get_by_role('button',name='Load bundled discussion drafts',exact=True).click()
        page.get_by_text('Discussion drafts loaded. Professional review is still required.',exact=True).wait_for()
        page.locator('[data-template="independent-marketing-services"] a').click()
        page.locator('[data-legal-edit]').wait_for()
        read=lambda resource,ident=None:page.evaluate("async ({api,resource,id})=>(await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource,...(id?{id}:{})}),{credentials:'include'})).json()",{'api':api,'resource':resource,'id':ident})
        item=next(d for d in read('legal')['items'] if d['template_key']=='independent-marketing-services')
        old_id=item['latest_version_id'];old=read('legal-version',old_id)['version']
        form=page.locator('[data-add-comment]')
        form.get_by_role('combobox',name='Clause anchor',exact=True).select_option('preamble')
        form.get_by_label('Reviewer or source attribution',exact=True).fill('Synthetic counsel discussion')
        form.get_by_label('Clause concern',exact=True).fill('Synthetic clarification needed before professional review.')
        form.get_by_role('button',name='Add clause concern',exact=True).click()
        page.get_by_text('Clause concern recorded. Review clearance may need to be renewed.',exact=True).wait_for()
        form=page.locator('[data-legal-edit]')
        updated=old['markdown']+'\n## [IMS-99] Browser editorial note\nSynthetic clarification for professional review.\n'
        form.get_by_role('textbox',name='Markdown source',exact=True).fill(updated)
        form.get_by_label('Change reason',exact=True).fill('Add the requested synthetic clarification.')
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('New draft revision saved. Existing reviews and issued copies were not changed.',exact=True).wait_for()
        current_id=next(d for d in read('legal')['items'] if d['id']==item['id'])['latest_version_id']
        assert current_id!=old_id
        earlier=read('legal-version',old_id)['version']
        assert earlier['markdown']==old['markdown'] and earlier['content_sha256']==old['content_sha256']
        assert page.locator('[data-resolve-comment]').count()==1
        form=page.locator('[data-resolve-comment]')
        form.get_by_label('Resolution',exact=True).fill('Synthetic clarification recorded in this new revision.')
        form.get_by_role('button',name='Record comment resolution',exact=True).click()
        page.get_by_text('Comment resolution recorded. This does not grant professional approval.',exact=True).wait_for()
        page.get_by_role('button',name='Mark revision in review',exact=True).click()
        page.get_by_text('Revision marked in review. No professional approval was created.',exact=True).wait_for()
        details=read('legal-version',current_id)
        assert len(details['history'])==2 and details['version']['document_status']=='in_review'
        assert details['clearance']['approved'] is False and details['reviews']==[]
        assert page.get_by_role('button',name='Publish reviewed revision',exact=True).is_disabled()
        form=page.locator('[data-version-compare]')
        form.get_by_role('combobox',name='Compare with revision',exact=True).select_option(old_id)
        form.get_by_role('button',name='Compare saved revisions',exact=True).click()
        page.locator('[data-saved-comparison]').get_by_role('heading',name='IMS-99',exact=True).wait_for()
        def post(target,action,payload):
            return target.evaluate("async ({api,action,input})=>{const session=await (await fetch(api+'/api/operator-partners?resource=session',{credentials:'include'})).json();const response=await fetch(api+'/api/operator-partners',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({action,input,key:crypto.randomUUID()})});return {status:response.status,body:await response.json()};}",{'api':api,'action':action,'input':payload})
        denied=post(page,'legal.publish',{'programId':read('programs')['items'][0]['id'],'versionId':current_id,'expectedRevision':details['version']['document_revision']})
        assert denied['status']==409
        # A second bound owner window creates a newer revision while this editor stays open.
        with site.browser.new_context(viewport={'width':390,'height':844}) as other_context:
            other_context.add_cookies([cookie]);other=other_context.new_page();other.goto(owner+'/partners#legal')
            other.get_by_role('heading',name='Legal templates',exact=True).wait_for()
            v=details['version']
            saved=post(other,'legal.save',{'programId':read('programs')['items'][0]['id'],'templateKey':v['template_key'],'title':v['title'],
                'markdown':v['markdown']+'\nSecond owner window clarification.','variablesSchema':v['variables_schema'],'issuable':False,
                'requiredScopes':v['required_scopes'],'expectedRevision':v['document_revision'],'changeReason':'Synthetic concurrent revision.'})
            assert saved['status']==200
        form=page.locator('[data-legal-edit]');unsaved=updated+'\nUnsaved owner proposal retained after conflict.'
        form.get_by_role('textbox',name='Markdown source',exact=True).fill(unsaved)
        form.get_by_label('Change reason',exact=True).fill('Synthetic stale editor attempt.')
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('A newer revision exists. Compare it before saving.',exact=True).wait_for()
        assert form.get_by_role('textbox',name='Markdown source',exact=True).input_value()==unsaved
        form.get_by_role('button',name='Compare unsaved text with latest revision',exact=True).click()
        page.locator('[data-unsaved-comparison]').get_by_text('Second owner window clarification.',exact=False).wait_for()
        assert 'Unsaved owner proposal retained' in page.locator('[data-unsaved-comparison]').inner_text()
        assert len(read('legal-version',saved['body']['versionId'])['history'])==3
        assert read('legal-version',old_id)['version']['content_sha256']==old['content_sha256']
        assert 'Unsaved owner proposal' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert not site.page_errors


def test_native_owner_professional_package_decisions_and_returned_feedback():
    import base64
    import hashlib
    import io
    import zipfile
    from datetime import datetime, timedelta, timezone
    from xml.etree import ElementTree as ET
    with native_partner_workspace() as (_,fixture),SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        page=site.page;api=fixture['apiOrigin'];owner=fixture['ownerOrigin']
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        read=lambda resource,ident=None:page.evaluate("async ({api,resource,id})=>(await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource,...(id?{id}:{})}),{credentials:'include'})).json()",{'api':api,'resource':resource,'id':ident})
        page.goto(owner+'/partners#legal');page.get_by_role('button',name='Load bundled discussion drafts',exact=True).click()
        page.get_by_text('Discussion drafts loaded. Professional review is still required.',exact=True).wait_for()
        page.locator('[data-template="independent-marketing-services"] a').click();page.locator('[data-legal-edit]').wait_for()
        original=next(v for v in read('legal')['items'] if v['template_key']=='independent-marketing-services')
        source=read('legal-version',original['latest_version_id'])['version']
        form=page.locator('[data-legal-edit]');form.get_by_role('textbox',name='Markdown source',exact=True).fill('# Synthetic services terms\n## [IMS-04] Scope\nSynthetic voluntary introductions in a disposable browser test.\n')
        form.get_by_label('Mark this text ready for reviewed issuance (does not grant approval)',exact=True).check()
        form.get_by_label('Change reason',exact=True).fill('Synthetic professional review journey only.')
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('New draft revision saved. Existing reviews and issued copies were not changed.',exact=True).wait_for()
        version_id=page.url.rsplit('/',1)[-1];source=read('legal-version',version_id)['version']
        page.get_by_text('Create professional review package',exact=True).click();form=page.locator('[data-review-package-create]')
        form.locator('[name=versionIds]').check()
        for name,role,scopes in [('Synthetic native counsel','attorney',['Classification','Agreement language']),('Synthetic native accountant','cpa',['Accounting'])]:
            form.get_by_role('button',name='Add named reviewer',exact=True).click();row=form.locator('[data-reviewer]').last
            row.get_by_label('Reviewer name',exact=True).fill(name);row.get_by_role('combobox',name='Professional role',exact=True).select_option(role)
            for scope in scopes:row.get_by_label(scope,exact=True).check()
        expires=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
        form.get_by_label('Grant expires at (ISO 8601 with timezone)',exact=True).fill(expires)
        form.get_by_label('Private factual brief and review questions',exact=True).fill('Synthetic facts. No actual professional decision or engagement.')
        form.get_by_label('I checked redaction, private facts and permission to share this package.',exact=True).check()
        attempts=[]
        def lose_package(route):
            if route.request.method=='POST' and route.request.post_data_json['action']=='legal.export_package':
                attempts.append(route.request.post_data_json);response=route.fetch();assert response.status==200
                if len(attempts)==1:route.abort()
                else:route.fulfill(response=response)
            else:route.fallback()
        page.route('**/api/operator-partners*',lose_package)
        form.get_by_role('button',name='Create private signed package',exact=True).click()
        page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        assert len(read('legal-version',version_id)['packages'])==1
        form.get_by_role('button',name='Create private signed package',exact=True).click()
        page.get_by_role('heading',name='Professional review package',exact=True).wait_for();assert attempts[0]==attempts[1]
        package_id=page.url.rsplit('/',1)[-1];package=read('review-package',package_id)
        with page.expect_download() as event:page.get_by_role('link',name='Download signed ZIP (unencrypted)',exact=True).click()
        archive=event.value.path().read_bytes();assert hashlib.sha256(archive).hexdigest()==package['sha256']
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            manifest=json.loads(z.read('manifest.json'));assert manifest==package['manifest']
            docx=z.read(next(n for n in z.namelist() if n.endswith('.docx')))
        assert manifest['documents'][0]['sourceHash']==source['content_sha256']
        assert read('legal-version',version_id)['reviews']==[]
        secret='Synthetic offline handoff passphrase 2026!'
        encrypted_form=page.locator('[data-encrypt-review]')
        encrypted_form.get_by_label('Handoff passphrase (20 to 1024 UTF-8 bytes)',exact=True).fill(secret)
        encrypted_form.get_by_label('Repeat handoff passphrase',exact=True).fill(secret)
        encrypted_form.get_by_label('I saved the passphrase separately and will share it through the agreed trusted channel.',exact=True).check()
        encrypted_form.get_by_role('button',name='Encrypt package on this device',exact=True).click()
        page.get_by_role('link',name='Download encrypted review file',exact=True).wait_for()
        with page.expect_download() as encrypted_event:page.get_by_role('link',name='Download encrypted review file',exact=True).click()
        encrypted_archive=encrypted_event.value.path().read_bytes()
        assert secret.encode() not in encrypted_archive and source['markdown'].encode() not in encrypted_archive
        assert encrypted_form.get_by_label('Handoff passphrase (20 to 1024 UTF-8 bytes)',exact=True).input_value()==''
        # Return a real, bounded DOCX with one tracked insertion. File authors remain untrusted.
        w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';ET.register_namespace('w',w)
        buf=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(docx)) as src,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                payload=src.read(info.filename)
                if info.filename=='word/document.xml':
                    tree=ET.fromstring(payload);body=tree.find('{'+w+'}body');paragraph=ET.SubElement(body,'{'+w+'}p')
                    ins=ET.SubElement(paragraph,'{'+w+'}ins',{'{'+w+'}author':'Untrusted synthetic file author','{'+w+'}id':'99'})
                    run=ET.SubElement(ins,'{'+w+'}r');ET.SubElement(run,'{'+w+'}t').text='Synthetic returned suggestion <script>not executable</script>'
                    payload=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
                dst.writestr(info.filename,payload)
        returned=buf.getvalue()
        return_secret='Synthetic separate return passphrase 2026!'
        with site.browser.new_context(viewport={'width':390,'height':844},color_scheme='dark',accept_downloads=True) as reader_context:
            reader_context.set_offline(True);offline=reader_context.new_page();outbound=[]
            offline.on('request',lambda request:outbound.append(request.url))
            offline.goto((ROOT/'operator'/'review-reader.html').as_uri())
            def unlock(password,fingerprint):
                form=offline.locator('#unlock')
                form.get_by_label('Encrypted review file',exact=True).set_input_files({'name':'private.3dpreview','mimeType':'application/json','buffer':encrypted_archive})
                form.get_by_label('Review passphrase',exact=True).fill(password)
                form.get_by_label('Independently trusted signing fingerprint',exact=True).fill(fingerprint)
                form.get_by_role('button',name='Unlock and verify locally',exact=True).click()
            unlock(secret+'wrong',manifest['publicKeyFingerprint'])
            offline.get_by_text('Unable to unlock. Check the passphrase and obtain a fresh copy if the file changed.',exact=True).wait_for()
            assert offline.locator('#result a').count()==0
            unlock(secret,'b'*64)
            offline.get_by_text('The archive does not match the independently trusted signing fingerprint.',exact=True).wait_for()
            assert offline.locator('#result a').count()==0
            unlock(secret,manifest['publicKeyFingerprint'])
            offline.get_by_role('heading',name='Verified professional review package',exact=True).wait_for()
            assert offline.locator('#result a').count()==len(manifest['files'])
            with offline.expect_download() as md_event:offline.locator('#result a[download$=".md"]').first.click()
            assert md_event.value.path().read_bytes() in [zbytes for zbytes in [source['markdown'].encode()] if zbytes]
            form=offline.locator('#return-feedback')
            form.get_by_label('Returned DOCX (up to 512 KiB)',exact=True).set_input_files({'name':'returned.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':returned})
            form.get_by_label('Return passphrase (20 to 1024 UTF-8 bytes)',exact=True).fill(return_secret)
            form.get_by_label('Repeat return passphrase',exact=True).fill(return_secret)
            form.get_by_role('checkbox').check();form.get_by_role('button',name='Encrypt returned DOCX locally',exact=True).click()
            offline.get_by_role('link',name='Download encrypted DOCX return',exact=True).wait_for()
            with offline.expect_download() as event:offline.get_by_role('link',name='Download encrypted DOCX return',exact=True).click()
            returned_envelope=event.value.path().read_bytes()
            assert return_secret.encode() not in returned_envelope and returned not in returned_envelope
            form.get_by_label('Return passphrase (20 to 1024 UTF-8 bytes)',exact=True).fill('Changed private return passphrase 2026!')
            assert offline.get_by_role('link',name='Download encrypted DOCX return',exact=True).is_hidden()
            assert not [url for url in outbound if url.startswith(('http:','https:'))]
            offline.get_by_role('button',name='Lock and clear private view',exact=True).click()
            assert offline.locator('#result a').count()==0 and offline.locator('#return-feedback').is_hidden()
            assert offline.locator('[name=passphrase]').first.input_value()==''
        form=page.locator('[data-import-feedback]')
        form.get_by_role('combobox',name='Returned source version',exact=True).select_option(version_id)
        form.get_by_role('combobox',name='Returning named reviewer',exact=True).select_option('0')
        form.get_by_label('Returned DOCX (up to 512 KiB)',exact=True).set_input_files({'name':'synthetic-counsel-return.3dpreview','mimeType':'application/json','buffer':returned_envelope})
        form.get_by_label('Return passphrase (encrypted returns only)',exact=True).fill(return_secret)
        form.get_by_label('I confirmed the returning reviewer identity through the agreed private channel.',exact=True).check()
        form.get_by_role('button',name='Import untrusted feedback',exact=True).click()
        page.get_by_role('heading',name='Returned professional feedback',exact=True).wait_for()
        page.get_by_text('Synthetic returned suggestion <script>not executable</script>',exact=True).wait_for()
        assert page.locator('main script').count()==0
        attachment=read('review-feedback',page.url.rsplit('/',1)[-1]);assert base64.b64decode(attachment['data'])==returned
        assert read('legal-version',version_id)['version']['content_sha256']==source['content_sha256']
        assert read('legal-version',version_id)['reviews']==[]
        page.get_by_role('link',name='Return to the source review package',exact=True).click()
        page.get_by_role('heading',name='Professional review package',exact=True).wait_for()
        def decision(grant,choice,reference):
            form=page.locator('[data-record-review]')
            form.get_by_role('combobox',name='Reviewed source version',exact=True).select_option(version_id)
            form.get_by_role('combobox',name='Named reviewer and scope',exact=True).select_option(str(grant))
            form.get_by_role('combobox',name='Professional decision',exact=True).select_option(choice)
            form.get_by_label('Evidence reference',exact=True).fill(reference)
            form.get_by_label('Reviewed at (ISO 8601 with timezone)',exact=True).fill(datetime.now(timezone.utc).isoformat())
            form.get_by_label('I verified the reviewer identity and this decision through the agreed private channel.',exact=True).check()
            form.get_by_role('button',name='Record professional decision',exact=True).click()
            page.get_by_text('Professional decision recorded for the exact source hash. This does not publish or issue a document.',exact=True).wait_for()
        decision(0,'conditional','SYNTHETIC-CONDITIONAL')
        assert read('legal-version',version_id)['clearanceByProgram'][manifest['programId']]['approved'] is False
        for grant in range(3):decision(grant,'approved','SYNTHETIC-NOT-ACTUAL-APPROVAL-'+str(grant))
        detail=read('legal-version',version_id);assert detail['clearanceByProgram'][manifest['programId']]['approved'] is True and len(detail['reviews'])==4
        assert detail['version']['document_status']=='draft'
        page.goto(owner+'/partners#legal/version/'+version_id);page.get_by_role('button',name='Publish reviewed revision',exact=True).click()
        page.get_by_text('Reviewed revision published. Existing issued copies are unchanged.',exact=True).wait_for()
        assert read('legal-version',version_id)['version']['document_status']=='published'
        assert read('programs')['items'][0]['clearance']['allowed'] is False
        assert read('legal-version',original['latest_version_id'])['version']['content_sha256']==original['content_sha256']
        state=subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-Atc',"SELECT json_build_object('packages',(SELECT count(*) FROM partner_review_packages),'attachments',(SELECT count(*) FROM partner_review_attachments),'reviews',(SELECT count(*) FROM partner_legal_reviews))::text"],check=True,capture_output=True,text=True,timeout=15)
        assert json.loads(state.stdout)=={'packages':1,'attachments':1,'reviews':4}
        assert not site.page_errors


def test_native_owner_scoped_bindings_typed_issue_ack_and_immutable_history():
    from datetime import datetime,timedelta,timezone
    with native_partner_workspace(enable_reviewed_launch=True) as (origin,fixture),SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        page=site.page;api=fixture['apiOrigin'];owner=fixture['ownerOrigin']
        site.context.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':api.replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
        page.goto(owner+'/partners#programs');page.get_by_role('heading',name='Partner programs',exact=True).wait_for()
        read=lambda resource,ident=None:page.evaluate("async ({api,resource,id})=>(await fetch(api+'/api/operator-partners?'+new URLSearchParams({resource,...(id?{id}:{})}),{credentials:'include'})).json()",{'api':api,'resource':resource,'id':ident})
        def post(action,input):
            response=page.evaluate("async ({api,action,input})=>{const s=await(await fetch(api+'/api/operator-partners?resource=session',{credentials:'include'})).json();const r=await fetch(api+'/api/operator-partners',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrfToken},body:JSON.stringify({action,input,key:crypto.randomUUID()})});return {status:r.status,body:await r.json()};}",{'api':api,'action':action,'input':input})
            assert response['status']==200,response
            return response['body']
        program=read('programs')['items'][0];program_id=program['id']
        markdown='# Synthetic terms\n## [TEST-01] Scope\n{{partner_name}}\nFee ${{fee_usd}}\nDate {{service_date}}\nCount {{count}}\nContact {{email}}\n{{notes}}\n'
        schema={'partner_name':{'type':'private-person-name','required':True},'fee_usd':{'type':'money','required':True,'default':5000},'service_date':{'type':'date','required':True},'count':{'type':'integer','required':True},'email':{'type':'email','required':True},'notes':{'type':'multiline','required':False},'unused_person':{'type':'private-person-name','required':True}}
        version=post('legal.save',{'programId':program_id,'templateKey':'native-issuance-terms','title':'Synthetic exact typed terms','markdown':markdown,'variablesSchema':schema,'issuable':True,'requiredScopes':['classification','agreement_language','solicitation_policy','accounting'],'expectedRevision':0,'changeReason':'Synthetic isolated typed issuance journey.'})
        package=post('legal.export_package',{'programId':program_id,'versionIds':[version['versionId']],'reviewers':[{'name':'Synthetic counsel','role':'attorney','scopes':['classification','agreement_language','solicitation_policy']},{'name':'Synthetic accountant','role':'cpa','scopes':['accounting']}],'expiresAt':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(),'redactionConfirmed':True})
        for scope in ['classification','agreement_language','solicitation_policy','accounting']:
            post('legal.record_review',{'programId':program_id,'packageId':package['id'],'versionId':version['versionId'],'versionHash':version['hash'],'scope':scope,'decision':'approved','reviewerName':'Synthetic accountant' if scope=='accounting' else 'Synthetic counsel','reviewerRole':'cpa' if scope=='accounting' else 'attorney','evidenceReference':'SYNTHETIC-NOT-ACTUAL-REVIEW-'+scope,'reviewedAt':datetime.now(timezone.utc).isoformat()})
        post('legal.publish',{'programId':program_id,'versionId':version['versionId'],'expectedRevision':1})
        page.reload();page.get_by_text('Bind reviewed agreement and outreach policy',exact=True).click()
        form=page.locator('[data-program-bindings]')
        for label in ['Reviewed agreement','Reviewed outreach policy']:form.get_by_role('combobox',name=label,exact=True).select_option(version['versionId'])
        form.get_by_role('button',name='Save reviewed version bindings',exact=True).click()
        page.get_by_text('Reviewed version bindings saved. Program activation is unchanged.',exact=True).wait_for()
        assert read('programs')['items'][0]['enabled'] is False
        page.get_by_label('Enable new work after all clearance checks pass',exact=True).check()
        page.get_by_role('button',name='Save program controls',exact=True).click()
        page.get_by_text('Program controls saved.',exact=True).wait_for()
        assert read('programs')['items'][0]['clearance']['allowed'] is True
        page.get_by_role('link',name='Issued agreements',exact=True).click()
        form=page.locator('[data-issue-agreement]')
        form.get_by_role('combobox',name='Program',exact=True).select_option(program_id)
        form.get_by_role('combobox',name='Active partner',exact=True).select_option(fixture['partnerId'])
        form.get_by_role('combobox',name='Exact reviewed source',exact=True).select_option(version['versionId'])
        form.get_by_label('partner name (private-person-name)',exact=True).fill('Synthetic typed partner')
        form.get_by_label('fee usd (USD)',exact=True).fill('12.34')
        form.get_by_label('service date (date)',exact=True).fill('2026-10-25')
        form.get_by_label('count (integer)',exact=True).fill('3')
        form.get_by_label('email (email)',exact=True).fill('synthetic@example.test')
        form.get_by_label('notes (multiline)',exact=True).fill('Private objective scope.\n*Literal* note.')
        assert form.locator('[name="binding:unused_person"]').count()==0
        form.get_by_label('I reviewed the typed values and will issue this exact saved version to this partner.',exact=True).check()
        attempts=[]
        def lose_issue(route):
            if route.request.method=='POST' and route.request.post_data_json['action']=='legal.issue':
                attempts.append(route.request.post_data_json);response=route.fetch();assert response.status==200
                if len(attempts)==1:route.abort()
                else:route.fulfill(response=response)
            else:route.fallback()
        page.route('**/api/operator-partners*',lose_issue)
        form.get_by_role('button',name='Issue frozen agreement copy',exact=True).click()
        page.get_by_text('Unable to reach partner administration. Check your connection and try again.',exact=True).wait_for()
        assert len(read('agreements')['items'])==1
        form.get_by_role('button',name='Issue frozen agreement copy',exact=True).click()
        page.get_by_role('heading',name='Issued agreement copy',exact=True).wait_for()
        assert attempts[0]==attempts[1]
        issue_id=page.url.rsplit('/',1)[-1];issued=read('agreement',issue_id)
        assert issued['bindings']=={'partner_name':'Synthetic typed partner','fee_usd':1234,'service_date':'2026-10-25','count':3,'email':'synthetic@example.test','notes':'Private objective scope.\n*Literal* note.'}
        assert '12.34' in issued['snapshotMarkdown'] and '{{' not in issued['snapshotMarkdown']
        with site.browser.new_context(viewport={'width':390,'height':844},color_scheme='dark') as partner_context:
            partner=partner_context.new_page();partner.goto(origin)
            partner.get_by_label('Account code',exact=True).fill(fixture['partnerId']);partner.get_by_label('Passphrase',exact=True).fill(fixture['password'])
            partner.get_by_role('button',name='Sign in',exact=True).click();partner.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
            partner.goto(origin+'/gigs/'+fixture['gigId'])
            partner.get_by_role('combobox',name='Action',exact=True).select_option('accept');partner.get_by_role('button',name='Save decision',exact=True).click()
            partner.get_by_text('Read and acknowledge the current reviewed agreement before accepting new work.',exact=True).wait_for()
            partner.goto(origin+'/agreements');partner.get_by_role('heading',name='Your agreements',exact=True).wait_for()
            assert '12.34' in partner.locator('main').inner_text()
            partner.get_by_label('I have read this exact issued version.',exact=True).check();partner.get_by_role('button',name='Record read acknowledgment',exact=True).click()
            partner.get_by_text('Read acknowledgment recorded.',exact=True).wait_for()
            partner.goto(origin+'/gigs/'+fixture['gigId']);partner.get_by_role('combobox',name='Action',exact=True).select_option('accept')
            partner.get_by_role('button',name='Save decision',exact=True).click();partner.get_by_text('Offer accepted. Receipt',exact=False).wait_for()
        acknowledged=read('agreement',issue_id);assert acknowledged['acknowledgedAt'] and acknowledged['snapshotHash']==issued['snapshotHash']
        detail=read('legal-version',version['versionId'])['version']
        post('legal.save',{'programId':program_id,'templateKey':detail['template_key'],'title':detail['title'],'markdown':detail['markdown']+'\nNew unreviewed amendment.','variablesSchema':detail['variables_schema'],'issuable':False,'requiredScopes':detail['required_scopes'],'expectedRevision':detail['document_revision'],'changeReason':'Synthetic amendment must not rewrite an issued copy.'})
        assert read('programs')['items'][0]['clearance']['allowed'] is False
        page.reload();page.get_by_role('heading',name='Issued agreement copy',exact=True).wait_for()
        final=read('agreement',issue_id);assert final['snapshotMarkdown']==issued['snapshotMarkdown'] and final['snapshotHash']==issued['snapshotHash'] and final['sourceMarkdown']==issued['sourceMarkdown']
        assert len(read('agreements')['items'])==1 and 'Synthetic typed partner' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        state=subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-Atc',"SELECT agreement_issue_id::text FROM partner_gigs WHERE id='"+fixture['gigId']+"'"],check=True,capture_output=True,text=True,timeout=15)
        assert state.stdout.strip()==issue_id and not site.page_errors


def test_native_prepared_visit_survives_offline_cold_reopen_and_manual_replay():
    with native_partner_workspace() as (origin,fixture),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;page.goto(origin)
        page.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        page.wait_for_function('()=>!!navigator.serviceWorker.controller')
        page.goto(origin+'/visits/new?gig='+fixture['acceptedGigId'])
        page.get_by_role('button',name='Prepare this gig for offline business drafts',exact=True).click()
        page.get_by_text('Offline visit form prepared on this device. Current gig status still requires a connection.',exact=True).wait_for()
        site.context.set_offline(True)
        page.close();page=site.context.new_page()
        page.goto(origin+'/drafts')
        page.get_by_label('Account code for device drafts',exact=True).fill(fixture['partnerId'])
        page.get_by_role('button',name='Open device drafts',exact=True).click()
        page.get_by_role('button',name='Record another business visit',exact=True).click()
        page.get_by_label('Business name',exact=True).fill('Native cold offline business')
        page.locator('#device-permission').check()
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        page.reload()
        page.get_by_label('Account code for device drafts',exact=True).fill(fixture['partnerId'])
        page.get_by_role('button',name='Open device drafts',exact=True).click()
        page.get_by_text('Native cold offline business',exact=True).wait_for()
        assert page.get_by_role('button',name='Send pending business drafts',exact=True).is_disabled()
        site.context.set_offline(False)
        page.goto(origin+'/drafts')
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('1 draft submitted. 0 remain on this device.',exact=True).wait_for()
        page.reload()
        assert page.get_by_role('button',name='Remove device draft',exact=True).count()==0
        rows=page.evaluate("async api=>(await(await fetch(api+'/api/partner/v1/visits',{credentials:'include'})).json()).items",fixture['apiOrigin'])
        assert len(rows)==1 and rows[0]['business_name']=='Native cold offline business'
        assert page.evaluate("async()=>{const c=await caches.open('partner-shell-v3');return(await c.keys()).every(r=>!r.url.includes('/api/'));}")


def test_native_late_login_cookie_after_other_tab_logout_is_revoked():
    from tests.support.server import json_request
    with native_partner_workspace() as (origin,fixture),SiteBrowser() as site:
        first=site.page;first.goto(origin)
        first.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        first.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        first.get_by_role('button',name='Sign in',exact=True).click()
        first.get_by_role('heading',name='Hello, Synthetic Partner 1.').wait_for()
        second=site.context.new_page()
        session_url=fixture['apiOrigin']+'/api/partner/v1/session'
        second.route(session_url,lambda route:route.fulfill(status=401,content_type='application/json',body='{"error":"Synthetic local signed-out view"}'))
        second.goto(origin)
        second.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for()
        second.unroute(session_url)
        held=[]
        def hold_login(route):
            code,headers,body=json_request(route.request.url,method='POST',headers={'Origin':origin},payload=route.request.post_data_json)
            assert code==200 and 'set-cookie' in {k.lower() for k in headers}
            held.append((route,code,headers,body))
        second.route('**/api/partner/v1/login',hold_login)
        second.get_by_label('Account code',exact=True).fill(fixture['partnerId'])
        second.get_by_label('Passphrase',exact=True).fill(fixture['password'])
        second.get_by_role('button',name='Sign in',exact=True).click()
        second.wait_for_timeout(50);assert held
        first.get_by_role('button',name='Sign out',exact=True).click()
        first.get_by_text('Signed out.',exact=True).wait_for()
        second.get_by_text('Signed out in another tab.',exact=True).wait_for()
        route,code,headers,body=held.pop()
        with second.expect_response(lambda response:response.url==fixture['apiOrigin']+'/api/partner/v1/logout' and response.request.method=='POST',timeout=5000) as cleanup:
            route.fulfill(status=code,headers=headers,body=json.dumps(body))
        assert cleanup.value.status==200
        second.reload()
        second.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for(timeout=5000)
        assert second.get_by_role('heading',name='Hello, Synthetic Partner 1.').count()==0


def activity_partner_sign_in(page,origin,fixture,other=False):
    page.goto(origin)
    page.get_by_label('Account code',exact=True).fill(fixture['otherPartnerId'] if other else fixture['partnerId'])
    page.get_by_label('Passphrase',exact=True).fill(fixture['password'])
    page.get_by_role('button',name='Sign in',exact=True).click()
    page.get_by_role('heading',name='Hello, Synthetic Partner '+('2' if other else '1')+'.',exact=True).wait_for()


def test_native_optional_activity_partner_can_track_and_delete_own_elapsed_record():
    """optional-activity.feature: Partner can choose to track an activity session."""
    with native_partner_workspace() as (origin,fixture),SiteBrowser(viewport=(390,844),color_scheme='dark',reduced_motion='reduce') as site:
        page=site.page;activity_partner_sign_in(page,origin,fixture)
        page.goto(origin+'/activity');page.get_by_role('heading',name='Optional activity',exact=True).wait_for()
        assert 'Not required for accepting gigs or payment' in page.locator('main').inner_text()
        commands=[]
        def lose_first_committed_start(route):
            command=route.request.post_data_json;commands.append(command)
            if len(commands)==1:
                response=route.fetch();assert response.status==200;route.abort('failed')
            else:route.continue_()
        page.route('**/api/partner/v1/commands',lose_first_committed_start)
        page.get_by_role('button',name='Start optional record',exact=True).click()
        page.get_by_text('Unable to reach the partner service. Check your connection and try again.',exact=True).wait_for()
        page.get_by_role('button',name='Start optional record',exact=True).click()
        page.get_by_text('Optional activity updated.',exact=True).wait_for()
        assert commands[0]==commands[1]
        read=lambda:page.evaluate("async api=>(await(await fetch(api+'/api/partner/v1/activity',{credentials:'include',cache:'no-store'})).json()).items",fixture['apiOrigin'])
        rows=read();assert len(rows)==1 and rows[0]['optional'] is True
        record_id=rows[0]['id']
        # Advance only the disposable fixture's stored running segment, avoiding flaky waits.
        subprocess.run(['docker','exec',fixture['_container'],'psql','-U','postgres','-v','ON_ERROR_STOP=1','-c',"UPDATE partner_activity_sessions SET running_since=now()-interval '7 seconds' WHERE id='"+record_id+"'"],check=True,capture_output=True,timeout=15)
        page.get_by_role('button',name='Pause',exact=True).click();page.get_by_role('button',name='Resume',exact=True).wait_for()
        paused=read()[0];assert paused['elapsedSeconds']>=7 and paused['runningSince'] is None
        assert str(paused['elapsedSeconds'])+' saved seconds' in page.locator('main').inner_text()
        page.reload();page.get_by_role('button',name='Resume',exact=True).wait_for()
        page.get_by_role('button',name='Resume',exact=True).click();page.get_by_role('button',name='Pause',exact=True).wait_for()
        page.get_by_role('button',name='Stop',exact=True).click();page.get_by_text('Stopped',exact=False).wait_for()
        stopped=read()[0];assert stopped['endedAt'] and stopped['runningSince'] is None and stopped['elapsedSeconds']>=paused['elapsedSeconds']
        with site.browser.new_context() as other:
            second=other.new_page();activity_partner_sign_in(second,origin,fixture,other=True)
            denied=second.evaluate("""async ({api,id,revision})=>{const session=await(await fetch(api+'/api/partner/v1/session',{credentials:'include'})).json();const response=await fetch(api+'/api/partner/v1/commands',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify({action:'activity.delete',key:crypto.randomUUID(),input:{activityId:id,expectedRevision:revision}})});return {status:response.status,items:(await(await fetch(api+'/api/partner/v1/activity',{credentials:'include'})).json()).items};}""",{'api':fixture['apiOrigin'],'id':record_id,'revision':stopped['revision']})
            assert denied=={'status':404,'items':[]}
        with site.browser.new_context() as owner:
            owner.add_cookies([{'name':'__Host-3dp-session','value':fixture['ownerToken'],'url':fixture['apiOrigin'].replace('http:','https:'),'httpOnly':True,'secure':True,'sameSite':'Strict'}])
            operator=owner.new_page();operator.goto(fixture['ownerOrigin']+'/partners')
            status=operator.evaluate("async api=>(await fetch(api+'/api/operator-partners?resource=activity',{credentials:'include'})).status",fixture['apiOrigin'])
            assert status in [400,403,404]
        page.get_by_role('button',name='Delete record',exact=True).click();page.get_by_text('Activity record deleted.',exact=True).wait_for()
        page.reload();page.get_by_text('No optional activity records.',exact=True).wait_for()
        assert read()==[]
        assert not page.evaluate("Object.keys(localStorage).some(k=>k.includes('activity'))") and not site.page_errors


def test_native_optional_activity_work_submission_never_requires_a_timer():
    """optional-activity.feature: Partner can complete work without tracking time."""
    with native_partner_workspace() as (origin,fixture),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;activity_partner_sign_in(page,origin,fixture)
        page.goto(origin+'/gigs/'+fixture['acceptedGigId'])
        page.get_by_role('combobox',name='Action',exact=True).select_option('submit')
        page.get_by_label('Reason or submission details',exact=True).fill('Synthetic agreed visit completed without optional tracking.')
        page.get_by_role('button',name='Save decision',exact=True).click();page.get_by_text('Decision recorded.',exact=True).wait_for()
        result=page.evaluate("""async ({api,id})=>({gig:(await(await fetch(api+'/api/partner/v1/gig?id='+id,{credentials:'include'})).json()).item,activity:(await(await fetch(api+'/api/partner/v1/activity',{credentials:'include'})).json()).items})""",{'api':fixture['apiOrigin'],'id':fixture['acceptedGigId']})
        assert result['gig']['status']=='submitted' and result['activity']==[] and not site.page_errors


def test_native_optional_activity_gig_and_visit_screens_never_request_geolocation():
    """optional-activity.feature: No passive GPS surveillance."""
    with native_partner_workspace() as (origin,fixture),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        site.context.add_init_script("window.__geoCalls=[];for(const key of ['getCurrentPosition','watchPosition'])Object.defineProperty(navigator.geolocation,key,{value:()=>{window.__geoCalls.push(key);throw Error('Unexpected geolocation');}});")
        page=site.page;activity_partner_sign_in(page,origin,fixture)
        page.get_by_role('navigation').get_by_role('link',name='Gigs',exact=True).click()
        page.get_by_role('heading',name='Your gigs',exact=True).wait_for()
        page.locator('a[href="/gigs/'+fixture['acceptedGigId']+'"]').click()
        page.get_by_role('link',name='Record a business visit',exact=True).click()
        page.get_by_label('Business name',exact=True).fill('Synthetic map-free visit')
        assert page.evaluate('window.__geoCalls')==[] and not site.page_errors
