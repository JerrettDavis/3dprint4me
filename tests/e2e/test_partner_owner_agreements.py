"""Owner issuance fixtures; native tests exercise actual scoped reviews and frozen rows."""
import json
from urllib.parse import urlparse,parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture,PROGRAM
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser
VERSION='73000000-1000-4000-8000-100000000001'
ISSUE='73000000-1000-4000-8000-100000000002'
PARTNER='73000000-1000-4000-8000-100000000003'

def install_agreement_fixture(page,*,available=True):
    commands,_=install_owner_fixture(page)
    item={'id':VERSION,'title':'Reviewed synthetic terms','versionNo':2,'hash':'a'*64,'templateKey':'synthetic-terms','issueEligible':True,'contractEligible':True,'policyEligible':True,'requiredScopes':['agreement_language'],
          'variables':[{'key':'partner_name','type':'private-person-name','required':True},{'key':'fee_usd','type':'money','required':True,'default':5000},{'key':'service_date','type':'date','required':True},{'key':'notes','type':'multiline','required':False}]}
    detail={'id':ISSUE,'programId':PROGRAM,'partnerId':PARTNER,'partnerName':'Synthetic partner','versionId':VERSION,'title':item['title'],'versionNo':2,'sourceHash':'a'*64,'sourceMarkdown':'# Terms\n{{partner_name}}: ${{fee_usd}}','snapshotHash':'b'*64,'snapshotMarkdown':'# Terms\nSynthetic private partner: $75.25\n<script>untrusted text</script>','bindings':{'partner_name':'Synthetic private partner','fee_usd':7525,'service_date':'2026-10-25'},'issuedAt':'2026-10-24T12:00:00Z','acknowledgedAt':None}
    def handle(route):
        if route.request.method=='POST':
            body=route.request.post_data_json
            if body['action'] not in ['legal.issue','program.configure']:route.fallback();return
            commands.append(body);result={'id':ISSUE}
        else:
            resource=parse_qs(urlparse(route.request.url).query).get('resource',[''])[0]
            if resource=='programs':result={'items':[{'id':PROGRAM,'label':'Synthetic review program','starts_on':'2026-10-01','ends_on':'2026-12-31','revision':4,'default_weekly_cap_cents':20000,'enabled':available,'settings':{},'clearance':{'allowed':available,'missing':[] if available else ['owner_activation']}}]}
            elif resource=='partners':result={'items':[{'id':PARTNER,'program_id':PROGRAM,'display_name':'Synthetic partner','status':'active'}]}
            elif resource=='legal-choices':result={'programId':PROGRAM,'items':[item]}
            elif resource=='agreements':result={'items':[{k:v for k,v in detail.items() if k not in ['sourceMarkdown','snapshotMarkdown','bindings']}]}
            elif resource=='agreement':result=detail
            else:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands


def test_owner_issues_typed_values_for_exact_source_and_reads_frozen_copy():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands=install_agreement_fixture(page);page.goto(origin+'/partners#agreements')
        form=page.locator('[data-issue-agreement]')
        form.get_by_role('combobox',name='Program',exact=True).select_option(PROGRAM)
        form.get_by_role('combobox',name='Active partner',exact=True).select_option(PARTNER)
        form.get_by_role('combobox',name='Exact reviewed source',exact=True).select_option(VERSION)
        form.get_by_label('partner name (private-person-name)',exact=True).fill('Synthetic private partner')
        form.get_by_label('fee usd (USD)',exact=True).fill('75.25')
        form.get_by_label('service date (date)',exact=True).fill('2026-10-25')
        form.get_by_label('notes (multiline)',exact=True).fill('Private objective scope.')
        form.get_by_label('I reviewed the typed values and will issue this exact saved version to this partner.',exact=True).check()
        form.get_by_role('button',name='Issue frozen agreement copy',exact=True).click()
        page.get_by_role('heading',name='Issued agreement copy',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'partnerId':PARTNER,'versionId':VERSION,'versionHash':'a'*64,'bindings':{'partner_name':'Synthetic private partner','fee_usd':7525,'service_date':'2026-10-25','notes':'Private objective scope.'}}
        assert page.locator('main script').count()==0 and '<script>untrusted text</script>' in page.locator('main').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.reload();page.get_by_role('heading',name='Issued agreement copy',exact=True).wait_for()
        assert len(commands)==1
        assert 'Synthetic private partner' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')


def test_owner_binds_only_reviewed_versions_without_activating_program():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(320,844)) as site:
        page=site.page;commands=install_agreement_fixture(page,available=False);page.goto(origin+'/partners#programs')
        page.get_by_text('Bind reviewed agreement and outreach policy',exact=True).click()
        form=page.locator('[data-program-bindings]')
        form.get_by_role('combobox',name='Reviewed agreement',exact=True).select_option(VERSION)
        form.get_by_role('combobox',name='Reviewed outreach policy',exact=True).select_option(VERSION)
        form.get_by_role('button',name='Save reviewed version bindings',exact=True).click()
        page.get_by_text('Reviewed version bindings saved. Program activation is unchanged.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'expectedRevision':4,'contractVersionId':VERSION,'policyVersionId':VERSION}
        assert 'enabled' not in commands[-1]['input'] and page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_paused_program_preserves_readable_issued_copy_but_disables_new_issue():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;commands=install_agreement_fixture(page,available=False);page.goto(origin+'/partners#agreements')
        form=page.locator('[data-issue-agreement]');form.get_by_role('combobox',name='Program',exact=True).select_option(PROGRAM)
        form.get_by_role('combobox',name='Exact reviewed source',exact=True).select_option(VERSION)
        assert form.get_by_role('button',name='Issue frozen agreement copy',exact=True).is_disabled()
        page.get_by_role('link',name='Reviewed synthetic terms - Synthetic partner',exact=True).click()
        page.get_by_role('heading',name='Issued agreement copy',exact=True).wait_for()
        page.get_by_text('Compare with the exact source at issuance',exact=True).click()
        assert '{{partner_name}}' in page.locator('main').inner_text() and commands==[]
