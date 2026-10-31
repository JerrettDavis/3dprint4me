"""Synthetic materials presentation; native persistence/replay are tested separately."""
import json
import pytest
from urllib.parse import urlparse,parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture
from tests.e2e.test_partner_shell import install_partner_fixture,PARTNER
from tests.support.operator_harness import running_operator_workspace
from tests.support.partner_harness import running_partner_shell
from tests.support.browser_harness import SiteBrowser

GIG='80000000-1000-4000-8000-100000000001'

def material_detail(*,partial=False,status='accepted'):
    return {'item':{'id':GIG,'partnerId':PARTNER['id'],'status':status,'revision':2,'feeCents':5000,'maximumBonusCents':0,'acceptedAt':'2026-10-24T12:00:00Z','authorizationWeek':'2026-10-19','terms':{'title':'Synthetic supplied materials','feeCents':5000,'maximumBonusCents':0,'tasks':['Permitted introductions'],'materials':['Owner-provided sample signs'],'area':'Tulsa permitted areas','deadline':'2026-12-01'}},'events':[],'negotiations':[],'materials':[{'id':'event-2','event_type':'returned','created_at':'2026-10-24T13:00:00Z','items':[{'label':'Sample signs <script>inert</script>','count':3}]},{'id':'event-1','event_type':'issued','created_at':'2026-10-24T12:00:00Z','items':[{'label':'Sample signs <script>inert</script>','count':5}]}],'materialsHasMore':partial}


def install_owner_material_fixture(page,*,partial=False,status='accepted',reject=False):
    install_owner_fixture(page);commands=[]
    def handle(route):
        if route.request.method=='POST' and route.request.post_data_json['action']=='material.record':
            commands.append(route.request.post_data_json)
            route.fulfill(status=409 if reject else 200,content_type='application/json',body=json.dumps({'error':'This return exceeds the recorded supplied materials.'} if reject else {'id':'synthetic-material'}))
        elif route.request.method=='GET' and parse_qs(urlparse(route.request.url).query).get('resource')==['gig']:
            route.fulfill(status=200,content_type='application/json',body=json.dumps(material_detail(partial=partial,status=status)))
        else:route.fallback()
    page.route('**/api/operator-partners*',handle);return commands


def install_partner_material_fixture(page,*,partial=False,long_label=False):
    install_partner_fixture(page)
    def handle(route):
        if urlparse(route.request.url).path=='/api/partner/v1/gig':
            data=material_detail(partial=partial)
            if long_label:data['materials'][0]['items'][0]['label']='W'*120
            route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
        else:route.fallback()
    page.route('**/api/partner/v1/**',handle)


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_owner_material_rows_keyboard_partial_history_and_error_retry(width,theme):
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;commands=install_owner_material_fixture(page,partial=True,reject=True)
        page.goto(origin+'/partners#gig/'+GIG)
        form=page.locator('[data-material-record]')
        form.get_by_role('button',name='Add material item',exact=True).focus();page.keyboard.press('Enter')
        assert page.get_by_label('Material label 2',exact=True).evaluate('(el)=>el===document.activeElement')
        page.get_by_role('button',name='Remove material item 2',exact=True).click()
        form.get_by_role('combobox',name='Material event',exact=True).select_option('returned')
        form.get_by_label('Material label 1',exact=True).fill('Sample signs')
        form.get_by_label('Material count 1',exact=True).fill('3')
        form.get_by_role('button',name='Record materials',exact=True).click()
        page.get_by_text('This return exceeds the recorded supplied materials.',exact=True).wait_for()
        with page.expect_response(lambda response: response.request.method=='POST' and urlparse(response.url).path=='/api/operator-partners') as retry:
            form.get_by_role('button',name='Record materials',exact=True).click()
        assert retry.value.status==409
        assert commands[0]==commands[1]
        assert commands[0]['input']=={'gigId':GIG,'eventType':'returned','items':[{'label':'Sample signs','count':3}]}
        assert 'Showing the newest 200 material events.' in page.locator('[data-material-history]').inner_text()
        assert page.locator('main script').count()==0 and page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('navigation').get_by_role('link',name='Finance',exact=True).click()
        page.locator('[data-material-record]').wait_for(state='detached')
        assert not site.page_errors


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_partner_sees_inert_private_material_history_without_owner_controls(width,theme):
    with running_partner_shell() as origin,SiteBrowser(viewport=(width,844),color_scheme=theme,reduced_motion='reduce') as site:
        page=site.page;install_partner_material_fixture(page,partial=True)
        page.goto(origin+'/gigs/'+GIG)
        page.get_by_role('heading',name='Supplied and returned materials',exact=True).wait_for()
        text=page.locator('[data-material-history]').inner_text()
        assert 'Sample signs <script>inert</script>: 3' in text and 'Sample signs <script>inert</script>: 5' in text
        assert 'Showing the newest 200 material events.' in text and 'not a complete inventory balance' in text
        assert page.locator('[data-material-record]').count()==0 and page.locator('main script').count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth') and not site.page_errors


def test_owner_material_row_limit_and_return_only_after_work_ends():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;install_owner_material_fixture(page,status='payable');page.goto(origin+'/partners#gig/'+GIG)
        form=page.locator('[data-material-record]');form.wait_for();assert form.get_by_role('combobox',name='Material event',exact=True).locator('option').all_text_contents()==['Items returned']
        add=form.get_by_role('button',name='Add material item',exact=True)
        for _ in range(49):add.click()
        assert form.locator('[data-material-row]').count()==50 and add.is_disabled()
        form.get_by_role('button',name='Remove material item 50',exact=True).click();assert add.is_enabled()


@pytest.mark.parametrize('width,theme',[(320,'light'),(390,'dark')])
def test_partner_maximum_unbroken_material_label_wraps_without_horizontal_overflow(width,theme):
    with running_partner_shell() as origin,SiteBrowser(viewport=(width,844),color_scheme=theme) as site:
        page=site.page;install_partner_fixture(page);data=material_detail();data['materials'][0]['items'][0]['label']='W'*120
        page.route('**/api/partner/v1/gig?*',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(data)))
        page.goto(origin+'/gigs/'+GIG);page.get_by_role('heading',name='Supplied and returned materials',exact=True).wait_for()
        assert 'W'*120 in page.locator('[data-material-history]').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
