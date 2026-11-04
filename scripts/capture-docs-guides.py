"""Capture genuine desktop/phone viewports with synthetic fixtures, never tall pages."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tests.support.browser_harness import SiteBrowser,ROOT
from tests.support.operator_harness import running_operator_workspace
from tests.support.partner_harness import running_partner_shell
from tests.support.print_seed import seed_print_request,fake_slicer_env
from tests.support.server import json_request,running_server
from tests.e2e.test_partner_owner import install_owner_fixture,install_access_fixture
from tests.e2e.test_partner_owner_legal import install_legal_fixture,VERSION
from tests.e2e.test_partner_owner_finance import install_finance_fixture
from tests.e2e.test_partner_shell import install_partner_fixture,install_offer_fixture,GIG_ID,PARTNER
from tests.e2e.test_partner_visits import visit_fixture,GIG
from tests.e2e.test_partner_statements import install_partner_statement_fixture
from tests.e2e.test_partner_review_reader import offline_review_fixture,unlock_fixture

OUT=ROOT/'docs-site/src/assets/guides'
VIEWS=[('desktop',(1440,810)),('mobile',(390,520))]

def save(site,name,device,focus=None):
    page=site.page
    page.evaluate('document.activeElement?.blur()')
    if focus:
        page.locator(focus).first.evaluate("n=>n.scrollIntoView({block:'start'})")
    page.screenshot(path=str(OUT/f'{name}-{device}.png'),full_page=False,animations='disabled',
                    mask=[page.locator('input[type=password],[data-secret],.owner-access-code')])
    assert not site.page_errors,site.page_errors
    print(name,device,'captured',flush=True)

def work():
    env=fake_slicer_env()
    with running_operator_workspace({**env,'RESEND_API_KEY':''}) as (store,origin,path):
        seeded=seed_print_request(store,path,title='Synthetic alignment bracket',slice_env=env)
        state=json.loads(path.read_text(encoding='utf-8'))
        item=next(x for x in state['workItems'] if x['requestId']==seeded['requestId'])
        for i,kind,text in [(1,'comment','Synthetic inspection: verify hole spacing.'),(2,'email','Synthetic client update: please review dimensions.')]:
            status,_,_=json_request(store+'/api/operator-work?resource=communications',method='POST',headers={'Origin':origin},payload={'action':'create','workId':item['id'],'command':{'commandId':f'docs_capture_message_{i}','kind':kind,'body':text}})
            assert status==200
        for device,size in VIEWS:
            with SiteBrowser(viewport=size,color_scheme='light',reduced_motion='reduce') as site:
                page=site.page;page.goto(origin,wait_until='networkidle')
                page.locator('#workspace:not([hidden])').wait_for();save(site,'work-queue',device)
                page.goto(origin+'/work/'+item['id'],wait_until='networkidle')
                page.locator('#detail-content:not([hidden])').wait_for()
                save(site,'work-detail',device,'#detail-content')
                for name,selector in [('conversation','.conversation-sheet'),('models','.model-sheet'),('print-estimate','.print-sheet')]:
                    page.locator(selector).wait_for();save(site,name,device,selector)

def owner():
    with running_operator_workspace() as (_,origin,_):
        for name in ['owner-qa','owner-access','owner-retry','owner-campaigns','owner-accounts','owner-legal','owner-finance']:
            for device,size in VIEWS:
                with SiteBrowser(viewport=size,color_scheme='light',reduced_motion='reduce') as site:
                    page=site.page
                    qa=name in ['owner-qa','owner-access','owner-retry']
                    if name=='owner-accounts':install_access_fixture(page)
                    elif name=='owner-legal':install_legal_fixture(page)
                    elif name=='owner-finance':install_finance_fixture(page)
                    else:install_owner_fixture(page,realm='qa' if qa else 'live',allowed=name!='owner-access')
                    if name=='owner-retry':
                        def fail_post(route):
                            if route.request.method=='POST':route.fulfill(status=503,content_type='application/json',body='{"error":"Synthetic temporary outage"}')
                            else:route.fallback()
                        page.route('**/api/operator-partner-qa*',fail_post)
                    route='/partners/qa' if qa else '/partners#'+('legal/version/'+VERSION if name=='owner-legal' else name.removeprefix('owner-'))
                    if name=='owner-accounts':route='/partners#partners'
                    page.goto(origin+route,wait_until='networkidle');page.locator('main h1').wait_for()
                    if name=='owner-retry':
                        page.get_by_role('button',name='Create synthetic QA run',exact=True).click()
                        page.get_by_text('Partner administration is temporarily unavailable.',exact=False).wait_for()
                    focus='.qa-banner' if qa else 'main h1'
                    save(site,name,device,focus)

def partner():
    with running_partner_shell() as origin:
        for name in ['partner-profile','partner-gig','partner-agreement','partner-visit','partner-drafts','partner-statements']:
            for device,size in VIEWS:
                with SiteBrowser(viewport=size,color_scheme='light',reduced_motion='reduce') as site:
                    page=site.page
                    if name=='partner-statements':install_partner_statement_fixture(page)
                    elif name in ['partner-visit','partner-drafts']:visit_fixture(page)
                    elif name=='partner-gig':
                        item,negotiation=install_offer_fixture(page)
                        item.update(status='accepted',revision=2,feeCents=5000,acceptedAt='2026-10-26T12:00:00Z',authorizationWeek='2026-10-26');negotiation.clear()
                    else:install_partner_fixture(page)
                    if name=='partner-agreement':
                        from tests.e2e.test_partner_shell import ISSUE
                        sample={**ISSUE,'snapshot_markdown':'# QA SAMPLE - NO LEGAL EFFECT\n\nRepresentative workflow specimen only. Review the exact task and fee before accepting an offer. Read acknowledgment is not a signature or professional approval.'}
                        page.route('**/api/partner/v1/agreements',lambda route:route.fulfill(content_type='application/json',body=json.dumps({'items':[sample]})))
                    route={'partner-profile':'/profile','partner-statements':'/earnings','partner-gig':'/gigs/'+GIG_ID,'partner-agreement':'/agreements'}.get(name,'/visits/new?gig='+GIG)
                    page.goto(origin+route,wait_until='networkidle');page.locator('main h1').wait_for()
                    if name in ['partner-visit','partner-drafts']:
                        page.get_by_label('Business name',exact=True).fill('Synthetic Coffee')
                    if name=='partner-drafts':
                        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
                        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
                        page.get_by_role('link',name='Device drafts',exact=True).click()
                        page.get_by_role('heading',name='Device drafts',exact=True).wait_for()
                    save(site,name,device,'main h1')

def reader_and_customizer():
    fixture=offline_review_fixture()
    for device,size in VIEWS:
        with SiteBrowser(viewport=size,color_scheme='light',reduced_motion='reduce') as site:
            site.context.set_offline(True);site.page.goto((ROOT/'operator/review-reader.html').as_uri())
            unlock_fixture(site.page,fixture);save(site,'review-reader',device,'main h1')
    with running_server() as origin:
        for device,size in VIEWS:
            with SiteBrowser(viewport=size,color_scheme='light',reduced_motion='reduce') as site:
                site.goto(origin+'/customize/g/route-shield/',ready_selector="body[data-build-state='ready']")
                save(site,'customizer',device)

if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    actions={'work':work,'owner':owner,'partner':partner,'reader_and_customizer':reader_and_customizer}
    for name in sys.argv[1:] or actions:actions[name]()
