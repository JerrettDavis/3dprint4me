"""Exact native private-package and immutable-review transition evidence."""
import hashlib
import io
import json
import zipfile
from tests.support.partner_budget import reviewed_budget_workspace
from tests.integration.test_partner_consent_referral_browser import command
from tests.support.server import request

SCOPES=['classification','agreement_language','solicitation_policy','accounting']


def package_for(w,version):
    return w['post']('legal.export_package',{'programId':w['programId'],'versionIds':[version['versionId']],'reviewers':[{'name':'Synthetic counsel','role':'attorney','scopes':SCOPES[:3]},{'name':'Synthetic accountant','role':'cpa','scopes':['accounting']}],'expiresAt':'2026-10-27T12:00:00Z','redactionConfirmed':True})


def review(w,version,package):
    for scope in SCOPES:
        w['post']('legal.record_review',{'programId':w['programId'],'packageId':package['id'],'versionId':version['versionId'],'versionHash':version['hash'],'scope':scope,'decision':'approved','reviewerName':'Synthetic accountant' if scope=='accounting' else 'Synthetic counsel','reviewerRole':'cpa' if scope=='accounting' else 'attorney','evidenceReference':'SYNTHETIC-NOT-PROFESSIONAL-APPROVAL-B-'+scope,'reviewedAt':'2026-10-26T12:00:00Z'})


def save(w,key,markdown,scopes=SCOPES):
    return w['post']('legal.save',{'programId':w['programId'],'templateKey':key,'title':'Synthetic private review source','markdown':markdown,'variablesSchema':{},'issuable':True,'requiredScopes':scopes,'expectedRevision':0,'changeReason':'Synthetic native acceptance evidence.'})


def issue_input(w,version):
    return {'programId':w['programId'],'versionId':version['versionId'],'versionHash':version['hash'],'partnerId':w['accounts'][0]['id'],'bindings':{}}


def test_native_review_package_excludes_unrelated_private_records_and_denies_anonymous_download():
    with reviewed_budget_workspace(work_seed=True,observe_outbound=True) as w:
        version=save(w,'native-private-package','# Synthetic terms\n## [IMS-04] Voluntary scope\nPermitted business visits only.')
        package=package_for(w,version)
        # Positive native private record exists; it must not enter the review archive.
        private=w['owner'].evaluate("async ({api,id})=>(await(await fetch(api+'/api/operator-work?id='+id,{credentials:'include'})).json())",{'api':w['fixture']['apiOrigin'],'id':w['fixture']['privateWorkId']})
        assert 'private-customer@example.test' in json.dumps(private)
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#legal/package/'+package['id'])
        owner.get_by_role('heading',name='Professional review package',exact=True).wait_for()
        with owner.expect_download() as pending:
            owner.get_by_role('link',name='Download signed ZIP (unencrypted)',exact=True).click()
        archive=pending.value.path().read_bytes();assert hashlib.sha256(archive).hexdigest()==package['sha256']
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            manifest=json.loads(z.read('manifest.json'))
            assert manifest['redactionConfirmed'] is True and manifest['versions']==[version['versionId']]
            assert any(n.endswith('.md') for n in z.namelist()) and any(n.endswith('.docx') for n in z.namelist())
            assert 'changes-from-prior-round.json' in z.namelist() and 'review-checklist.csv' in z.namelist()
            for item in manifest['files']:
                assert hashlib.sha256(z.read(item['name'])).hexdigest()==item['sha256']
            assert b'IMS-04' in z.read(next(n for n in z.namelist() if n.endswith('.md') and n.startswith('native-')))
            for name in z.namelist():
                payloads=[z.read(name)]
                if name.endswith('.docx'):
                    with zipfile.ZipFile(io.BytesIO(payloads[0])) as docx:payloads.extend(docx.read(n) for n in docx.namelist())
                for content in payloads:
                    assert b'private-customer@example.test' not in content
                    assert b'Synthetic confidential project marker.' not in content
                    assert all(account['displayName'].encode() not in content for account in w['accounts'])
        status,headers,body=request(w['fixture']['apiOrigin']+package['downloadPath'])
        assert status==401 and 'data' not in json.loads(body)
        assert archive not in body and package['sha256'].encode() not in body
        assert w['fixture']['outboundAttempts']()==0


def test_native_unreviewed_issuance_returns_exact_missing_classification_and_language_gates():
    with reviewed_budget_workspace() as w:
        version=save(w,'native-missing-gates','# Synthetic unreviewed terms\nNo executable approval.',scopes=['classification','agreement_language'])
        before=w['read']('agreements')['items']
        result=command(w,'legal.issue',issue_input(w,version),page=w['owner'],owner=True)
        assert result['status']==409
        assert set(result['body']['missingGates'])=={'classification','agreement_language'}
        assert w['read']('agreements')['items']==before
        assert w['read']('legal-version',version['versionId'])['reviews']==[]


def test_native_version_b_requires_independent_reviews_new_issue_and_new_ack_without_changing_a():
    with reviewed_budget_workspace(observe_outbound=True) as w:
        a=next(i for i in w['read']('agreements')['items'] if i['partnerId']==w['accounts'][0]['id'])
        original=w['read']('agreement',a['id']);assert original['acknowledgedAt']
        source=w['read']('legal-version',a['versionId'])['version']
        b=w['post']('legal.save',{'programId':w['programId'],'templateKey':source['template_key'],'title':source['title'],'markdown':source['markdown']+'\n## [IMS-04] Amended scope\nNew independently reviewed voluntary terms.','variablesSchema':source['variables_schema'],'issuable':True,'requiredScopes':source['required_scopes'],'expectedRevision':source['document_revision'],'changeReason':'Synthetic independent version B review transition.'})
        assert b['hash']!=source['content_sha256']
        denied=command(w,'legal.issue',issue_input(w,b),page=w['owner'],owner=True)
        assert denied['status']==409 and set(denied['body']['missingGates'])=={'published_agreement','published_policy'}
        denied=command(w,'legal.publish',{'programId':w['programId'],'versionId':b['versionId'],'expectedRevision':b['revision']},page=w['owner'],owner=True)
        assert denied['status']==409 and set(denied['body']['missingGates'])==set(SCOPES)
        assert w['read']('legal-version',b['versionId'])['reviews']==[]
        assert w['read']('agreement',a['id'])==original
        package=package_for(w,b);review(w,b,package)
        # The page initially has valid review evidence. A later review change must
        # surface the server's exact missing gate when publication is attempted.
        owner=w['owner'];owner.goto(w['fixture']['ownerOrigin']+'/partners#legal/version/'+b['versionId'])
        owner.get_by_role('combobox',name='Review context program',exact=True).select_option(w['programId'])
        owner.get_by_role('button',name='Publish reviewed revision',exact=True).wait_for()
        w['post']('legal.record_review',{'programId':w['programId'],'packageId':package['id'],'versionId':b['versionId'],'versionHash':b['hash'],'scope':'agreement_language','decision':'changes_requested','reviewerName':'Synthetic counsel','reviewerRole':'attorney','evidenceReference':'SYNTHETIC-LATE-REVIEW-CHANGE','reviewedAt':'2026-10-26T12:00:00Z'})
        owner.get_by_role('button',name='Publish reviewed revision',exact=True).click()
        owner.get_by_text('Only the latest issue-ready text with all required reviews can be published. Missing requirements: Agreement language review.',exact=True).wait_for()
        assert owner.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert w['read']('agreement',a['id'])==original
        review(w,b,package)
        w['post']('legal.publish',{'programId':w['programId'],'versionId':b['versionId'],'expectedRevision':b['revision']})
        program=next(p for p in w['read']('programs')['items'] if p['id']==w['programId'])
        w['post']('program.configure',{'programId':w['programId'],'expectedRevision':program['revision'],'enabled':True,'weeklyCapCents':20000,'contractVersionId':b['versionId'],'policyVersionId':b['versionId']})
        issued=w['post']('legal.issue',issue_input(w,b));assert issued['id']!=a['id']
        fresh=w['read']('agreement',issued['id']);assert fresh['acknowledgedAt'] is None and fresh['sourceHash']==b['hash']
        page=w['pages'][0];page.goto(w['origin']+'/agreements')
        page.get_by_label('I have read this exact issued version.',exact=True).check()
        page.get_by_role('button',name='Record read acknowledgment',exact=True).click()
        page.get_by_text('Read acknowledgment recorded.',exact=True).wait_for()
        final=w['read']('agreement',issued['id']);assert final['acknowledgedAt'] and final['snapshotHash']==fresh['snapshotHash']
        assert w['read']('agreement',a['id'])==original
        assert len([i for i in w['read']('agreements')['items'] if i['partnerId']==w['accounts'][0]['id']])==2
        assert w['fixture']['outboundAttempts']()==0
