"""Statement scheduling/history presentation. Native fixtures prove persistence."""
import hashlib
import json
from urllib.parse import urlparse,parse_qs
import pytest
from tests.e2e.test_partner_owner import install_owner_fixture,PROGRAM
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser
from tests.e2e.test_partner_shell import install_partner_fixture
from tests.support.partner_harness import running_partner_shell

STATEMENT='50000000-1000-4000-8000-100000000001'
CSV='"record_id","amount_due_cents","paid_cents","outstanding_cents"\r\n"synthetic",5000,2000,3000\r\n'
META={'id':STATEMENT,'partnerId':'10000000-1000-4000-8000-100000000001','programId':PROGRAM,'weekStart':'2026-10-26','asOf':'2026-10-26T12:00:00.000Z','generatedAt':'2026-10-26T12:00:00.000Z','recordCount':1,'sha256':hashlib.sha256(CSV.encode()).hexdigest()}


def install_statement_fixture(page,*,tamper=False,label='Synthetic weekly <img src=x onerror=alert(1)>'):
    install_owner_fixture(page)
    commands=[];schedule={'programId':PROGRAM,'label':label,'enabled':False,'firstDueWeek':None,'revision':1}
    def handle(route):
        req=route.request;params=parse_qs(urlparse(req.url).query)
        if req.method=='POST':
            command=req.post_data_json
            if command['action']!='statement.schedule':route.fallback();return
            assert req.headers['x-csrf-token']=='owner-memory-only'
            commands.append(command);schedule.update(enabled=command['input']['enabled'],revision=schedule['revision']+1,firstDueWeek='2026-11-02')
            result=dict(schedule)
        elif params.get('resource')==['statements']:
            result={**META,'csv':CSV+('tampered' if tamper else '')} if params.get('id') else {'items':[META],'schedules':[schedule]}
        else:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_owner_schedules_weekly_statement_and_downloads_exact_verified_snapshot(width,theme,tmp_path):
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;commands=install_statement_fixture(page)
        page.goto(origin+'/partners#statements')
        page.get_by_role('heading',name='Weekly statements',exact=True).wait_for(timeout=3000)
        assert 'Synthetic weekly <img src=x onerror=alert(1)>' in page.locator('main').inner_text()
        assert page.locator('#owner-content img').count()==0
        page.get_by_label('Schedule weekly statements',exact=True).check()
        page.get_by_role('button',name='Save statement schedule',exact=True).click()
        page.get_by_text('Statement schedule saved. Existing snapshots are unchanged.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'expectedRevision':1,'enabled':True}
        assert '2026-11-02' in page.locator('main').inner_text()
        page.get_by_role('link',name='Statement for 2026-10-26',exact=True).click()
        page.get_by_role('heading',name='Weekly statement',exact=True).wait_for(timeout=3000)
        with page.expect_download() as pending:
            page.get_by_role('link',name='Download verified statement CSV',exact=True).click()
        download=pending.value;target=tmp_path/'statement.csv';download.save_as(target)
        assert target.read_bytes()==CSV.encode()
        assert download.suggested_filename=='partner-weekly-statement-'+STATEMENT+'.csv'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert not site.page_errors


def test_owner_rejects_changed_statement_bytes_before_creating_download():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_statement_fixture(page,tamper=True)
        page.goto(origin+'/partners#statements/'+STATEMENT)
        page.get_by_role('heading',name='Unable to load partner records',exact=True).wait_for(timeout=3000)
        assert page.locator('a[download]').count()==0
        assert 'integrity' in page.locator('main').inner_text().lower()


def install_partner_statement_fixture(page,*,tamper=False,expired=False):
    install_partner_fixture(page)
    def handle(route):
        parsed=urlparse(route.request.url)
        if parsed.path.endswith('/earnings'):
            result={'items':[],'totals':{k:0 for k in ['committedCents','submittedCents','earnedBonusCents','contingentBonusCents','outstandingCents','paidCents','disputedCents']}}
        elif parsed.path.endswith('/statements'):
            if parse_qs(parsed.query).get('id'):
                if expired:route.fulfill(status=401,content_type='application/json',body=json.dumps({'error':'Your session has ended. Sign in again or contact the owner.'}));return
                result={**META,'csv':CSV+('tampered' if tamper else '')}
            else:result={'items':[META]}
        else:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/partner/v1/**',handle)


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_partner_downloads_verified_weekly_statement_without_caching_private_balances(width,theme,tmp_path):
    with running_partner_shell() as origin,SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;install_partner_statement_fixture(page)
        page.goto(origin+'/earnings')
        page.get_by_role('heading',name='Weekly statements',exact=True).wait_for(timeout=3000)
        with page.expect_download() as pending:
            page.get_by_role('button',name='Download statement for 2026-10-26',exact=True).click()
        download=pending.value;target=tmp_path/'weekly.csv';download.save_as(target)
        assert target.read_bytes()==CSV.encode()
        assert download.suggested_filename=='partner-weekly-statement-'+STATEMENT+'.csv'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        assert CSV not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        cached=page.evaluate("async()=>{const urls=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())urls.push(request.url);return urls;}")
        assert all('/api/' not in url for url in cached)
        assert not site.page_errors


@pytest.mark.parametrize('expired',[False,True])
def test_partner_rejects_changed_or_expired_weekly_statement_before_download(expired):
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_partner_statement_fixture(page,tamper=not expired,expired=expired)
        page.goto(origin+'/earnings')
        page.get_by_role('button',name='Download statement for 2026-10-26',exact=True).wait_for(timeout=3000)
        downloads=[];page.on('download',lambda d:downloads.append(d))
        page.get_by_role('button',name='Download statement for 2026-10-26',exact=True).click()
        if expired:
            page.get_by_role('heading',name='Your work. Your records.',exact=True).wait_for(timeout=3000)
            assert '2026-10-26' not in page.locator('main').inner_text()
        else:
            page.get_by_text('Statement integrity check failed. Reopen the original snapshot.',exact=True).wait_for(timeout=3000)
        assert downloads==[]


def test_delayed_statement_failure_does_not_replace_a_later_partner_page():
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_partner_statement_fixture(page);held=[]
        def delay(route):
            if parse_qs(urlparse(route.request.url).query).get('id'):held.append(route)
            else:route.fallback()
        page.route('**/api/partner/v1/statements*',delay)
        page.goto(origin+'/earnings')
        page.get_by_role('button',name='Download statement for 2026-10-26',exact=True).click()
        page.get_by_role('navigation').get_by_role('link',name='Profile',exact=True).click()
        page.get_by_role('heading',name='Your profile',exact=True).wait_for()
        assert len(held)==1
        held[0].fulfill(status=503,content_type='application/json',body=json.dumps({'error':'Private internal detail'}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading',name='Your profile',exact=True).is_visible()
        assert page.locator('#message').is_hidden()
        assert 'Private internal detail' not in page.locator('body').inner_text()


def test_owner_can_page_history_and_keep_schedule_controls_available():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_statement_fixture(page);seen=[]
        def paginate(route):
            params=parse_qs(urlparse(route.request.url).query)
            if route.request.method!='GET' or params.get('resource')!=['statements'] or params.get('id'):route.fallback();return
            before=params.get('before',[None])[0];seen.append(before)
            item={**META,'weekStart':'2026-10-19'} if before else META
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[item],'nextCursor':None if before else STATEMENT,'schedules':[{'programId':PROGRAM,'label':'Synthetic paged schedule','enabled':True,'firstDueWeek':'2026-10-26','revision':2}]}))
        page.route('**/api/operator-partners*',paginate)
        page.goto(origin+'/partners#statements')
        page.get_by_role('link',name='Older statements',exact=True).click()
        page.get_by_role('link',name='Statement for 2026-10-19',exact=True).wait_for()
        assert page.get_by_role('button',name='Save statement schedule',exact=True).is_enabled()
        page.get_by_role('link',name='Newest statements',exact=True).click()
        page.get_by_role('link',name='Statement for 2026-10-26',exact=True).wait_for()
        assert seen==[None,STATEMENT,None]


def test_partner_can_page_older_private_statement_history():
    with running_partner_shell() as origin,SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_partner_statement_fixture(page);seen=[]
        def paginate(route):
            params=parse_qs(urlparse(route.request.url).query)
            if params.get('id'):route.fallback();return
            before=params.get('before',[None])[0];seen.append(before)
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{**META,'weekStart':'2026-10-19'} if before else META],'nextCursor':None if before else STATEMENT}))
        page.route('**/api/partner/v1/statements*',paginate)
        page.goto(origin+'/earnings')
        page.get_by_role('button',name='Older statements',exact=True).click()
        page.get_by_role('button',name='Download statement for 2026-10-19',exact=True).wait_for()
        page.get_by_role('button',name='Newest statements',exact=True).click()
        page.get_by_role('button',name='Download statement for 2026-10-26',exact=True).wait_for()
        assert seen==[None,STATEMENT,None]
