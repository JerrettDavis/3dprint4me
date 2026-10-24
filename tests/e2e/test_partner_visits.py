import json
from tests.support.browser_harness import SiteBrowser
from tests.support.partner_harness import running_partner_shell
from tests.e2e.test_partner_shell import install_partner_fixture

GIG='30000000-1000-4000-8000-100000000001'

def visit_fixture(page):
    commands=install_partner_fixture(page)
    item=dict(id=GIG,status='accepted',revision=2,acceptedAt='2026-10-23T12:00:00Z',feeCents=1000,maximumBonusCents=0,terms=dict(title='Synthetic permitted visits',area='Tulsa',deadline='2026-12-01',tasks=['Permitted visits'],materials=[]))
    page.route('**/api/partner/v1/gig?*',lambda route:route.fulfill(content_type='application/json',body=json.dumps(dict(item=item,events=[]))))
    for resource in ['visits','leads']:
        page.route('**/api/partner/v1/'+resource,lambda route:route.fulfill(content_type='application/json',body='{"items":[]}'))
    return commands

def test_visit_disabling_permission_clears_and_omits_contact():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844),reduced_motion='reduce') as site:
        page=site.page;page.set_default_timeout(10000);commands=visit_fixture(page)
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic Coffee')
        permission=page.get_by_label('This person explicitly agreed to project follow-up.',exact=True)
        assert not permission.is_checked()
        assert page.get_by_label('Contact email',exact=True).is_hidden()
        permission.check();page.get_by_label('Contact email',exact=True).fill('private@example.test')
        permission.uncheck()
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        payload=commands[-1]['input'];assert payload['consent'] is False
        assert 'contact' not in payload and 'consentPurpose' not in payload
        assert 'private@example.test' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        site.assert_no_page_errors()

def test_business_draft_survives_navigation_and_requires_explicit_send_and_logout_purges():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844)) as site:
        page=site.page;page.set_default_timeout(10000);commands=visit_fixture(page)
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic device draft')
        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
        site.context.set_offline(True)
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_text('Saved on this device. Not submitted yet.',exact=True).wait_for()
        assert len(commands)==0
        page.get_by_role('link',name='Device drafts',exact=True).click()
        page.get_by_text('Synthetic device draft',exact=True).wait_for()
        assert len(commands)==0
        site.context.set_offline(False)
        page.get_by_role('button',name='Send pending business drafts',exact=True).click()
        page.get_by_text('1 draft submitted. 0 remain on this device.',exact=True).wait_for()
        assert commands[-1]['input']['consent'] is False
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic discard at sign-out')
        page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.',exact=True).check()
        page.get_by_role('button',name='Save business draft on this device',exact=True).click()
        page.get_by_role('button',name='Sign out',exact=True).click()
        page.get_by_role('heading',name='Your work. Your records.').wait_for()
        assert 'Synthetic discard' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        site.assert_no_page_errors()


def test_specific_permission_sends_contact_only_online_and_never_to_drafts():
    with running_partner_shell() as origin, SiteBrowser(viewport=(320,844),color_scheme='dark') as site:
        page=site.page;commands=visit_fixture(page)
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic consenting business')
        page.get_by_label('This person explicitly agreed to project follow-up.',exact=True).check()
        page.get_by_label('Project follow-up purpose',exact=True).fill('Printed sign project requested by this person')
        page.get_by_label('Contact email',exact=True).fill('consenting@example.test')
        assert page.get_by_role('button',name='Save business draft on this device').is_disabled()
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        payload=commands[-1]['input'];assert payload['consent'] is True
        assert payload['contact']['email']=='consenting@example.test'
        assert payload['consentPurpose']=='Printed sign project requested by this person'
        assert 'consenting@example.test' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        site.assert_no_page_errors()


def test_ambiguous_live_submission_retries_exact_record_without_editing():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844)) as site:
        page=site.page;visit_fixture(page);requests=[]
        def respond(route):
            requests.append(route.request.post_data_json)
            if len(requests)==1:route.abort('failed')
            else:route.fulfill(content_type='application/json',body='{"id":"synthetic-receipt"}')
        page.route('**/api/partner/v1/commands',respond)
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic ambiguous visit')
        page.get_by_role('button',name='Submit visit',exact=True).click()
        page.get_by_role('button',name='Retry same submission',exact=True).wait_for()
        assert page.get_by_label('Business name',exact=True).is_disabled()
        page.get_by_role('button',name='Retry same submission',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        assert len(requests)==2 and requests[0]==requests[1]
        assert not site.page_errors


def test_pending_visit_freezes_fields_and_preserves_key_despite_late_input_events():
    with running_partner_shell() as origin, SiteBrowser(viewport=(390,844)) as site:
        page=site.page;page.set_default_timeout(10000);visit_fixture(page);held=[];sent=[]
        def respond(route):
            sent.append(route.request.post_data_json)
            if len(sent)==1:held.append(route)
            else:route.fulfill(content_type='application/json',body='{"id":"synthetic-receipt"}')
        page.route('**/api/partner/v1/commands',respond)
        page.goto(origin+'/visits/new?gig='+GIG)
        page.get_by_label('Business name',exact=True).fill('Synthetic pending visit')
        page.get_by_role('button',name='Submit visit',exact=True).click()
        assert page.get_by_label('Business name',exact=True).is_disabled()
        page.evaluate("document.querySelector('[name=businessName]').dispatchEvent(new Event('input',{bubbles:true}))")
        held[0].abort('failed')
        page.get_by_role('button',name='Retry same submission',exact=True).click()
        page.get_by_text('Visit recorded.',exact=True).wait_for()
        assert sent[0]==sent[1]
        assert not site.page_errors
