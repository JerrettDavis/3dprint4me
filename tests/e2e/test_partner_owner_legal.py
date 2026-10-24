"""Owner editorial fixtures; actual immutable storage is exercised natively."""
import json
from urllib.parse import urlparse,parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture,PROGRAM
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser

DOC='70000000-1000-4000-8000-100000000001'
VERSION='70000000-1000-4000-8000-100000000002'
OLD='70000000-1000-4000-8000-100000000003'
NEW='70000000-1000-4000-8000-100000000004'
COMMENT='70000000-1000-4000-8000-100000000005'
SOURCE='# Services terms\n## [IMS-04] Fee\n${{fee_usd}}\n'

def install_legal_fixture(page,*,conflict=False):
    install_owner_fixture(page);commands=[];changed=[False]
    def handle(route):
        if route.request.method=='POST':
            command=route.request.post_data_json;commands.append(command)
            if conflict and command['action']=='legal.save':
                changed[0]=True;route.fulfill(status=409,content_type='application/json',body=json.dumps({'error':'A newer revision exists. Compare it before saving.'}));return
            result={'versionId':VERSION,'id':COMMENT}
        else:
            query=parse_qs(urlparse(route.request.url).query);resource=query.get('resource',[''])[0];version=query.get('id',[VERSION])[0]
            if resource=='legal':result={'items':[{'id':DOC,'template_key':'independent-marketing-services','title':'Services terms','revision':7,'status':'draft','latest_version_id':NEW if changed[0] else VERSION,'version_no':2,'content_sha256':'a'*64,'issuable':False}]}
            elif resource=='legal-version':
                result={'version':{'id':version,'document_id':DOC,'template_key':'independent-marketing-services','version_no':1 if version==OLD else 3 if version==NEW else 2,'title':'Services terms','markdown':SOURCE+'\nServer counsel revision' if version==NEW else SOURCE,'variables_schema':{'fee_usd':{'type':'money','required':True,'default':5000}},'required_scopes':['agreement_language','classification','accounting'],'issuable':False,'content_sha256':'a'*64,'document_revision':7,'document_status':'draft','active_version_id':None},
                        'history':[{'id':VERSION,'version_no':2,'content_sha256':'a'*64,'change_reason':'Synthetic revision'},{'id':OLD,'version_no':1,'content_sha256':'b'*64,'change_reason':'Initial'}],
                        'documentComments':[{'id':COMMENT,'version_id':OLD,'version_no':1,'clause_anchor':'IMS-04','body':'Earlier clause concern <script>unsafe()</script>','reviewer_id':'Synthetic counsel','resolves_comment_id':None}],
                        'comments':[],'reviews':[],'packages':[],'feedback':[],'clearance':{'approved':False,'missing':['agreement_language','classification','accounting']}}
            elif resource=='legal-diff':result={'changed':True,'clauses':[{'anchor':'IMS-04','changed':True,'before':'Earlier fee text','after':'Current fee text'}]}
            else:route.fallback();return
        route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands


def test_owner_editor_saves_typed_immutable_revision_without_approval():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands=install_legal_fixture(page)
        page.goto(origin+'/partners#legal/version/'+VERSION)
        page.get_by_role('heading',name='Services terms',exact=True).wait_for()
        form=page.locator('[data-legal-edit]')
        form.get_by_role('textbox',name='Markdown source',exact=True).fill(SOURCE+'\nOwner revision.')
        form.get_by_label('Change reason',exact=True).fill('Clarify objective terms.')
        form.get_by_text('Typed variables and required reviews',exact=True).click()
        form.get_by_label('Default value (USD for money)',exact=True).fill('75.25')
        assert not commands
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('New draft revision saved. Existing reviews and issued copies were not changed.',exact=True).wait_for()
        body=commands[-1]['input']
        assert body['expectedRevision']==7 and body['issuable'] is False
        assert body['variablesSchema']=={'fee_usd':{'type':'money','required':True,'default':7525}}
        assert set(body['requiredScopes'])=={'classification','agreement_language','accounting'}
        assert body['markdown']==SOURCE+'\nOwner revision.'
        assert page.get_by_role('button',name='Publish reviewed revision',exact=True).is_disabled()
        assert page.locator('main script').count()==0
        assert 'Earlier clause concern <script>unsafe()</script>' in page.locator('main').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_stale_save_retains_unsaved_text_and_compares_without_submitting_it():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(320,844)) as site:
        page=site.page;commands=install_legal_fixture(page,conflict=True)
        page.goto(origin+'/partners#legal/version/'+VERSION)
        form=page.locator('[data-legal-edit]');source=form.get_by_role('textbox',name='Markdown source',exact=True)
        source.fill(SOURCE+'\nUnsaved owner proposal <img src=x onerror=unsafe()>')
        form.get_by_label('Change reason',exact=True).fill('Owner proposal')
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('A newer revision exists. Compare it before saving.',exact=True).wait_for()
        assert 'Unsaved owner proposal' in source.input_value()
        form.get_by_role('button',name='Compare unsaved text with latest revision',exact=True).click()
        page.get_by_text('Server counsel revision',exact=False).wait_for()
        assert 'Unsaved owner proposal' in page.locator('[data-unsaved-comparison]').inner_text()
        assert len(commands)==1
        assert page.locator('main img, main script').count()==0
        assert 'Unsaved owner proposal' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_resolves_historical_comment_and_compares_readonly_old_version():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;commands=install_legal_fixture(page)
        page.goto(origin+'/partners#legal/version/'+VERSION)
        form=page.locator('[data-resolve-comment]')
        form.get_by_label('Resolution',exact=True).fill('Clarified in this revision after counsel discussion.')
        form.get_by_role('button',name='Record comment resolution',exact=True).click()
        page.get_by_text('Comment resolution recorded. This does not grant professional approval.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'commentId':COMMENT,'resolution':'Clarified in this revision after counsel discussion.','resolvedByVersionId':VERSION}
        page.goto(origin+'/partners#legal/version/'+OLD)
        page.get_by_role('heading',name='Services terms',exact=True).wait_for()
        assert page.locator('[data-legal-edit]').count()==0
        form=page.locator('[data-version-compare]')
        form.get_by_role('combobox',name='Compare with revision',exact=True).select_option(VERSION)
        form.get_by_role('button',name='Compare saved revisions',exact=True).click()
        page.get_by_text('Earlier fee text',exact=True).wait_for()
        page.get_by_text('Current fee text',exact=True).wait_for()


def test_owner_new_template_uses_declared_private_variable_and_mandatory_scopes():
    with running_operator_workspace() as (_,origin,_),SiteBrowser(viewport=(390,844)) as site:
        page=site.page;commands=install_legal_fixture(page);page.goto(origin+'/partners#legal')
        page.get_by_role('heading',name='Legal templates',exact=True).wait_for()
        page.get_by_text('Create a new template',exact=True).click()
        form=page.locator('[data-legal-edit]')
        form.get_by_label('Stable template key',exact=True).fill('independent-marketing-services')
        form.get_by_label('Document title',exact=True).fill('Private discussion draft')
        form.get_by_role('textbox',name='Markdown source',exact=True).fill('# DRAFT\n## [NEW-01] Party\n{{person_name}}')
        form.get_by_label('Change reason',exact=True).fill('Create unapproved discussion text.')
        form.get_by_text('Typed variables and required reviews',exact=True).click()
        for label in ['Agreement language','Classification','Accounting']:
            assert form.get_by_label(label,exact=True).is_disabled()
            assert form.get_by_label(label,exact=True).is_checked()
        form.get_by_role('button',name='Add typed variable',exact=True).click()
        row=form.locator('[data-variable-index]')
        row.get_by_label('Variable name',exact=True).fill('person_name')
        row.get_by_role('combobox',name='Variable type',exact=True).select_option('private-person-name')
        row.get_by_label('Require a value when this variable is used',exact=True).check()
        assert row.get_by_label('Default value (USD for money)',exact=True).is_disabled()
        form.get_by_role('button',name='Save new immutable revision',exact=True).click()
        page.get_by_text('New draft revision saved. Existing reviews and issued copies were not changed.',exact=True).wait_for()
        assert commands[-1]['input']['variablesSchema']=={'person_name':{'type':'private-person-name','required':True}}
        assert commands[-1]['input']['expectedRevision']==0
        assert set(commands[-1]['input']['requiredScopes'])=={'classification','agreement_language','accounting'}


def test_owner_review_request_and_retirement_never_fabricate_approval():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;commands=install_legal_fixture(page);page.goto(origin+'/partners#legal/version/'+VERSION)
        page.get_by_role('button',name='Mark revision in review',exact=True).click()
        page.get_by_text('Revision marked in review. No professional approval was created.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'versionId':VERSION,'expectedRevision':7}
        assert commands[-1]['action']=='legal.request_review'
        page.get_by_text('Retire this template',exact=True).click()
        page.get_by_label('Retirement reason',exact=True).fill('Superseded discussion template.')
        page.get_by_role('button',name='Retire template',exact=True).click()
        page.get_by_text('Template retired. Historical versions and issued copies remain intact.',exact=True).wait_for()
        assert commands[-1]['input']=={'programId':PROGRAM,'documentId':DOC,'reason':'Superseded discussion template.','expectedRevision':7}
        assert commands[-1]['action']=='legal.retire'


def test_owner_late_unsaved_comparison_does_not_replace_a_newer_edit_or_route():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;install_legal_fixture(page);page.goto(origin+'/partners#legal/version/'+VERSION)
        form=page.locator('[data-legal-edit]');source=form.get_by_role('textbox',name='Markdown source',exact=True)
        source.fill('First private proposal')
        pending=[]
        def delay(route):
            if route.request.method=='GET' and urlparse(route.request.url).query=='resource=legal':pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',delay)
        form.get_by_role('button',name='Compare unsaved text with latest revision',exact=True).click()
        page.wait_for_timeout(50);assert pending
        source.fill('Newer private proposal')
        pending.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{'id':DOC,'latest_version_id':VERSION}]}))
        page.wait_for_function("!document.querySelector('[data-compare-unsaved]').disabled")
        assert page.locator('[data-unsaved-comparison]').inner_text()==''
        assert source.input_value()=='Newer private proposal'
        form.get_by_role('button',name='Compare unsaved text with latest revision',exact=True).click()
        page.wait_for_timeout(50);assert pending
        page.get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        pending.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{'id':DOC,'latest_version_id':VERSION}]}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading',name='Partner audit',exact=True).is_visible()
        assert 'private proposal' not in page.locator('body').inner_text()


def test_owner_compare_access_denial_removes_unsaved_private_source():
    with running_operator_workspace() as (_,origin,_),SiteBrowser() as site:
        page=site.page;install_legal_fixture(page);page.goto(origin+'/partners#legal/version/'+VERSION)
        form=page.locator('[data-legal-edit]')
        form.get_by_role('textbox',name='Markdown source',exact=True).fill('Private unsaved owner document')
        def deny(route):
            if route.request.method=='GET' and urlparse(route.request.url).query=='resource=legal':route.fulfill(status=403,content_type='text/plain',body='denied')
            else:route.fallback()
        page.route('**/api/operator-partners*',deny)
        form.get_by_role('button',name='Compare unsaved text with latest revision',exact=True).click()
        page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert page.locator('main textarea').count()==0
        assert 'Private unsaved' not in page.locator('body').inner_text()
