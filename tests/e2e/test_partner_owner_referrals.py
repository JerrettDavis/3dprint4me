"""Owner review presentation; native PostgreSQL proves the actual money path."""
import json
from urllib.parse import urlparse, parse_qs
from tests.e2e.test_partner_owner import install_owner_fixture
from tests.support.operator_harness import running_operator_workspace
from tests.support.browser_harness import SiteBrowser

PARTNER='50000000-1000-4000-8000-100000000001'
GIG='50000000-1000-4000-8000-100000000002'
LEAD='50000000-1000-4000-8000-100000000003'
REF='50000000-1000-4000-8000-100000000004'
QUAL='50000000-1000-4000-8000-100000000005'
ATTR='50000000-1000-4000-8000-100000000006'
SALE='50000000-1000-4000-8000-100000000007'
STAMP='2026-10-24T08:00:00.000Z'


def install_review_fixture(page, *, withdrawn=False):
    install_owner_fixture(page)
    commands=[]
    lead={'id':LEAD,'partnerId':PARTNER,'visitId':'visit','contact':{'name':'Synthetic person','email':'private@example.test','preferredContact':'email'},
          'purpose':'Requested sign project','consentText':'Exact recorded permission <script>unsafe()</script>',
          'consentAt':STAMP,'withdrawnAt':STAMP if withdrawn else None,'deletedAt':None,
          'status':'withdrawn' if withdrawn else 'needs_review','revision':3,'followUpAllowed':False}
    rules=[{'id':'lead','trigger':'qualified_lead','amountCents':500,'maximumAwards':1,'criteria':'Unique consenting independent introduction.','qualifiesBy':'2026-12-31'},
           {'id':'sale','trigger':'verified_sale','amountCents':2000,'maximumAwards':1,'criteria':'Independent fully settled purchase.','qualifiesBy':'2026-12-31','refundTreatment':'Review refunds with evidence.'}]
    data={'items':[{'id':REF,'partnerId':PARTNER,'gigId':GIG,'code':'SyntheticCode123','policyHash':'a'*64,'bonusRules':rules}],
          'awards':[],'qualifications':[{'id':QUAL,'leadId':LEAD,'partnerId':PARTNER,'gigId':GIG,'qualifiedAt':STAMP,'followUpAllowed':False}],
          'attributions':[{'id':ATTR,'referralId':REF,'requestId':'3DP-SYNTHETIC-OLD','consentedAt':STAMP,'evidenceReference':'Private record'}],
          'sales':[{'id':SALE,'attributionId':ATTR,'requestId':'3DP-SYNTHETIC-OLD','amountCents':12345,'method':'bank_transfer','paymentReference':'SYNTHETIC-BANK-1','settledAt':STAMP}],
          'requests':[{'id':'3DP-SYNTHETIC-WEB','title':'Synthetic sign <script>unsafe()</script>','status':'quoted','code':'SyntheticCode123','consentedAt':STAMP}]}
    def handle(route):
        if route.request.method=='POST':
            command=route.request.post_data_json;commands.append(command)
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':'synthetic-result'}));return
        resource=parse_qs(urlparse(route.request.url).query).get('resource',[''])[0]
        result={'items':[lead]} if resource=='leads' else {'items':[{'id':'visit','business_name':'Synthetic Coffee','gig_id':GIG,'outcome':'interested','visited_at':STAMP},{'id':'business-only','business_name':'Synthetic no-contact visit','gig_id':GIG,'outcome':'accepted_material','details':{'area':'Tulsa','placement':'permission_received','sampleCount':2},'visited_at':STAMP}]} if resource=='visits' else data if resource=='referrals' else None
        if result is None:route.fallback()
        else:route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/operator-partners*',handle)
    return commands,data


def test_owner_lead_review_uses_revision_and_suppresses_withdrawn_contacts():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands,_=install_review_fixture(page)
        page.goto(origin+'/partners#leads')
        page.get_by_role('heading',name='Lead follow-up',exact=True).wait_for()
        assert 'Exact recorded permission <script>unsafe()</script>' in page.locator('main').inner_text()
        page.get_by_text('Review business visit records',exact=True).click()
        page.get_by_text('Synthetic no-contact visit',exact=True).wait_for()
        assert 'permission_received' in page.locator('[data-business-visits]').inner_text()
        assert page.locator('main script').count()==0
        assert 'Follow-up unavailable' in page.locator('main').inner_text()
        page.get_by_role('combobox',name='Review decision',exact=True).select_option('qualified')
        page.get_by_label('Review reason',exact=True).fill('Permission and independent project interest checked.')
        page.get_by_role('button',name='Record lead review',exact=True).click()
        page.get_by_text('Lead review recorded. No bonus was created.',exact=True).wait_for()
        assert commands[-1]['input']=={'leadId':LEAD,'expectedRevision':3,'decision':'qualified','reason':'Permission and independent project interest checked.'}
        install_review_fixture(page,withdrawn=True)
        page.reload()
        page.get_by_role('heading',name='Lead follow-up',exact=True).wait_for()
        assert 'private@example.test' not in page.locator('main').inner_text()
        assert page.get_by_role('button',name='Record lead review',exact=True).count()==0
        assert page.get_by_role('button',name='Save corrected contact',exact=True).count()==0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_contact_correction_requires_fresh_permission_and_deletion_is_explicit():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(320,844)) as site:
        page=site.page;commands,_=install_review_fixture(page)
        page.goto(origin+'/partners#leads')
        page.get_by_role('heading',name='Lead follow-up',exact=True).wait_for()
        page.get_by_text('Correct contact or purpose',exact=True).click()
        page.get_by_label('Email',exact=True).fill('corrected@example.test')
        page.get_by_role('button',name='Save corrected contact',exact=True).click()
        page.get_by_text('Renew purpose-specific permission before changing contact details, method or purpose.',exact=True).wait_for()
        assert not commands
        page.get_by_label('Renewed purpose-specific permission was explicitly given for these corrected details.',exact=True).check()
        page.get_by_role('button',name='Save corrected contact',exact=True).click()
        page.get_by_text('Contact correction recorded. Review the current permission before follow-up.',exact=True).wait_for()
        assert commands[-1]['action']=='lead.correct'
        assert commands[-1]['input']['consent'] is True
        assert commands[-1]['input']['contact']['email']=='corrected@example.test'
        page.get_by_label('I confirmed the requested suppression or deletion. Existing obligations remain unchanged.',exact=True).check()
        page.get_by_role('combobox',name='Permission action',exact=True).select_option('delete')
        page.get_by_role('button',name='Apply permission action',exact=True).click()
        page.get_by_text('Permission action recorded. Follow-up is suppressed.',exact=True).wait_for()
        assert commands[-1]['action']=='lead.delete' and commands[-1]['input']=={'leadId':LEAD,'expectedRevision':3}


def test_owner_web_attribution_uses_exact_receipt_and_explicit_checks():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844)) as site:
        page=site.page;commands,_=install_review_fixture(page)
        page.goto(origin+'/partners#referrals')
        page.get_by_role('heading',name='Referral review',exact=True).wait_for()
        form=page.locator('[data-web-attribution]')
        form.get_by_role('combobox',name='Consenting web request',exact=True).select_option('3DP-SYNTHETIC-WEB')
        assert form.get_by_label('Server permission receipt (UTC)',exact=True).input_value()==STAMP
        assert form.get_by_label('Server permission receipt (UTC)',exact=True).is_editable() is False
        form.get_by_label('Permission evidence reference',exact=True).fill('Private request permission reviewed')
        form.get_by_label('Customer opt-in for this referral code is verified.',exact=True).check()
        form.get_by_label('I verified this is an independent customer, not a participant purchase.',exact=True).check()
        form.get_by_role('button',name='Record attribution',exact=True).click()
        page.get_by_text('Attribution recorded. No sale or bonus was created.',exact=True).wait_for()
        assert commands[-1]['input']=={'referralId':REF,'requestId':'3DP-SYNTHETIC-WEB','consentedAt':STAMP,'consentVerified':True,'independentCustomerConfirmed':True,'evidenceReference':'Private request permission reviewed'}
        assert page.locator('main script').count()==0
        assert 'private@example.test' not in page.evaluate('JSON.stringify({...localStorage,...sessionStorage})')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')


def test_owner_sale_and_award_are_separate_and_submit_only_the_matching_source():
    with running_operator_workspace() as (_,origin,_), SiteBrowser(viewport=(390,844),color_scheme='dark') as site:
        page=site.page;commands,_=install_review_fixture(page)
        page.goto(origin+'/partners#referrals')
        page.get_by_role('heading',name='Referral review',exact=True).wait_for()
        form=page.locator('[data-sale-verification]')
        form.get_by_role('combobox',name='Attributed request',exact=True).select_option(ATTR)
        form.get_by_label('Settled amount (USD)',exact=True).fill('1234.56')
        form.get_by_label('Settlement reference',exact=True).fill('SYNTHETIC-BANK-2')
        form.get_by_role('combobox',name='Settlement method',exact=True).select_option('bank_transfer')
        form.get_by_label('Settled at (ISO 8601 with timezone)',exact=True).fill(STAMP)
        for label in ['I independently verified settlement outside this portal.','This customer purchase is paid in full.','I reviewed refunds and reversals.','I verified this is an independent customer, not a participant purchase.']:
            form.get_by_label(label,exact=True).check()
        form.get_by_role('button',name='Record verified sale',exact=True).click()
        page.get_by_text('Sale evidence recorded. No bonus was awarded.',exact=True).wait_for()
        assert commands[-1]['action']=='referral.verify_sale' and commands[-1]['input']['amountCents']==123456
        assert 'qualificationId' not in commands[-1]['input']
        award=page.locator('[data-award-rule="sale"]')
        award.get_by_role('combobox',name='Verified settlement evidence',exact=True).select_option(SALE)
        award.get_by_label('The frozen qualification criteria and deadline are met.',exact=True).check()
        award.get_by_label('I reviewed self-referral, duplicate and collusion checks.',exact=True).check()
        award.get_by_role('button',name='Award accepted bonus',exact=True).click()
        page.get_by_text('Earned bonus recorded as payable. This is not a payment confirmation.',exact=True).wait_for()
        assert commands[-1]['input']=={'referralId':REF,'ruleId':'sale','saleEvidenceId':SALE,'criteriaConfirmed':True,'antiFraudConfirmed':True}
        award=page.locator('[data-award-rule="lead"]')
        assert 'does not renew contact permission' in award.inner_text()
        award.get_by_role('combobox',name='Qualification evidence',exact=True).select_option(QUAL)
        award.get_by_label('The frozen qualification criteria and deadline are met.',exact=True).check()
        award.get_by_label('I reviewed self-referral, duplicate and collusion checks.',exact=True).check()
        award.get_by_role('button',name='Award accepted bonus',exact=True).click()
        page.get_by_text('Earned bonus recorded as payable. This is not a payment confirmation.',exact=True).wait_for()
        assert commands[-1]['input']=={'referralId':REF,'ruleId':'lead','qualificationId':QUAL,'criteriaConfirmed':True,'antiFraudConfirmed':True}


def test_owner_private_lead_response_after_navigation_cannot_reappear():
    with running_operator_workspace() as (_,origin,_), SiteBrowser() as site:
        page=site.page;install_review_fixture(page);pending=[]
        def delay(route):
            if 'resource=leads' in route.request.url:pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',delay)
        page.goto(origin+'/partners#leads')
        page.wait_for_function("document.querySelector('a[aria-current=page]')?.textContent==='Leads'")
        page.wait_for_timeout(50)
        assert len(pending)==1
        page.get_by_role('link',name='Audit',exact=True).click()
        page.get_by_role('heading',name='Partner audit',exact=True).wait_for()
        pending[0].fulfill(status=200,content_type='application/json',body=json.dumps({'items':[{'contact':{'email':'late-private@example.test'}}]}))
        page.wait_for_timeout(100)
        assert page.get_by_role('heading',name='Partner audit',exact=True).is_visible()
        assert 'late-private' not in page.locator('body').inner_text()


def test_owner_denied_review_clears_private_lead_and_paper_attribution_is_explicit():
    with running_operator_workspace() as (_,origin,_), SiteBrowser() as site:
        page=site.page;commands,_=install_review_fixture(page)
        page.goto(origin+'/partners#referrals')
        page.get_by_text('Record separately verified paper permission',exact=True).click()
        form=page.locator('[data-paper-attribution]')
        form.get_by_label('Customer request ID',exact=True).fill('3DP-SYNTHETIC-PAPER')
        form.get_by_label('Permission recorded at (ISO 8601 with timezone)',exact=True).fill(STAMP)
        form.get_by_label('Permission evidence reference',exact=True).fill('Private paper permission record')
        form.get_by_label('Customer opt-in for this referral code is verified.',exact=True).check()
        form.get_by_label('I verified this is an independent customer, not a participant purchase.',exact=True).check()
        form.get_by_role('button',name='Record attribution',exact=True).click()
        page.get_by_text('Attribution recorded. No sale or bonus was created.',exact=True).wait_for()
        assert commands[-1]['input']['requestId']=='3DP-SYNTHETIC-PAPER'
        assert commands[-1]['input']['consentedAt']==STAMP
        assert 'receipt' not in commands[-1]['input']
        page.get_by_role('link',name='Leads',exact=True).click()
        page.get_by_role('heading',name='Lead follow-up',exact=True).wait_for()
        def deny(route):
            if route.request.method=='POST':route.fulfill(status=403,content_type='text/plain',body='denied')
            else:route.fallback()
        page.route('**/api/operator-partners*',deny)
        page.get_by_label('Review reason',exact=True).fill('Private review')
        page.get_by_role('button',name='Record lead review',exact=True).click()
        page.get_by_role('heading',name='Owner access required',exact=True).wait_for()
        assert 'private@example.test' not in page.locator('body').inner_text()
        assert page.locator('main input, main textarea').count()==0


def test_owner_new_submission_hides_previous_confirmation_until_its_own_response():
    with running_operator_workspace() as (_,origin,_), SiteBrowser() as site:
        page=site.page;install_review_fixture(page)
        page.goto(origin+'/partners#leads')
        page.get_by_label('Review reason',exact=True).fill('Initial review')
        page.get_by_role('button',name='Record lead review',exact=True).click()
        notice=page.get_by_text('Lead review recorded. No bonus was created.',exact=True)
        notice.wait_for()
        pending=[]
        def delay(route):
            if route.request.method=='POST':pending.append(route)
            else:route.fallback()
        page.route('**/api/operator-partners*',delay)
        page.get_by_label('Review reason',exact=True).fill('Second review must have its own confirmation')
        page.get_by_role('button',name='Record lead review',exact=True).click()
        assert notice.is_hidden()
        page.wait_for_function("document.querySelector('[data-lead-review] button').disabled")
        assert pending
        pending[0].fulfill(status=409,content_type='application/json',body=json.dumps({'error':'This lead has changed.'}))
        page.get_by_text('This lead has changed.',exact=True).wait_for()
        assert notice.count()==0
