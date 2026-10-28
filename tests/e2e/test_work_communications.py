import json
import pytest
from tests.support.browser_harness import SiteBrowser, ROOT
from tests.support.operator_harness import running_operator_workspace
from tests.support.print_seed import seed_print_request,seed_zip_pack
from tests.support.server import json_request

@pytest.mark.parametrize('width,scheme',[(1440,'light'),(390,'dark')])
def test_job_sheet_comments_emails_private_models_and_reestimation(width,scheme):
    with running_operator_workspace({'RESEND_API_KEY':''}) as (storefront,operator,store_path):
        seeded=seed_print_request(storefront,store_path,title='Conversation and revised model')
        state=json.loads(store_path.read_text())
        work=next(row for row in state['workItems'] if row['requestId']==seeded['requestId'])
        with SiteBrowser(viewport=(width,1000),color_scheme=scheme) as site:
            page=site.page
            page.goto(operator+'/work/'+work['id'],wait_until='networkidle')
            composer=page.locator('.conversation-composer')
            composer.locator('textarea').fill('Private <script>example</script>\nReview dimensions.')
            page.get_by_role('button',name='Add private comment',exact=True).click()
            page.locator('.conversation-comment').wait_for()
            assert '<script>example</script>' in page.locator('.conversation-comment').inner_text()
            composer.locator('textarea').fill('Client update: revised dimensions are ready.')
            page.get_by_role('button',name='Send email to client',exact=True).click()
            page.get_by_text('Email is not configured · message saved',exact=False).first.wait_for()
            model=page.locator('.model-sheet')
            model.locator('input[type=file]').set_input_files(str(ROOT/'tests/fixtures/print-estimation/cube-20mm-binary.stl'))
            page.get_by_role('button',name='Upload & analyze model',exact=True).click()
            try:
                page.wait_for_function("document.querySelectorAll('.model-sheet select[name=assetId] option').length===3",timeout=20000)
            except Exception:
                pytest.fail(model.inner_text())
            model=page.locator('.model-sheet')
            model.locator('select[name=material]').select_option('petg')
            model.locator('input[name=quantity]').fill('3')
            page.get_by_role('button',name='Update estimate',exact=True).click()
            page.wait_for_function("document.querySelector('.print-latest')?.textContent.includes('qty 3')",timeout=15000)
            assert 'PETG' in page.locator('.print-latest').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.evaluate("Object.values(localStorage).every(v=>!v.includes('Client update:'))")
            site.assert_no_page_errors()
        stored=json.loads(store_path.read_text())
        assert len(stored['communications'])==2
        assert stored['communications'][0]['state']=='private'
        assert stored['communications'][1]['state']=='unconfigured'
        print_state=json.loads((store_path.parent/'print-estimation-dev.json').read_text())
        assert len([a for a in print_state['assets'] if a['requestId']==seeded['requestId']])==2

def test_communication_origin_auth_and_message_field_validation():
    with running_operator_workspace() as (storefront,operator,store_path):
        seeded=seed_print_request(storefront,store_path,title='API validation')
        state=json.loads(store_path.read_text());work=next(row for row in state['workItems'] if row['requestId']==seeded['requestId'])
        url=storefront+'/api/operator-work?resource=communications'
        command={'action':'create','workId':work['id'],'command':{'commandId':'command_12345678','kind':'comment','body':'Safe note'}}
        assert json_request(url,method='POST',payload=command)[0]==403
        assert json_request(url,method='POST',payload={**command,'recipient':'other@example.test'},headers={'Origin':operator})[0]==400
        assert json_request(url,method='POST',payload=command,headers={'Origin':operator})[0]==200

def test_zip_revision_keeps_part_exclusions_and_quantities_after_refresh():
    with running_operator_workspace() as (storefront,operator,store_path):
        seeded=seed_print_request(storefront,store_path,title='Selected ZIP revision')
        pack=seed_zip_pack(store_path,seeded['requestId'])
        state=json.loads(store_path.read_text());work=next(row for row in state['workItems'] if row['requestId']==seeded['requestId'])
        with SiteBrowser(viewport=(390,1000),color_scheme='dark') as site:
            page=site.page;page.goto(operator+'/work/'+work['id'],wait_until='networkidle')
            form=page.locator('.model-form');form.locator('select[name=assetId]').select_option(pack['zipId'])
            quantities=form.locator('[data-part-id]');quantities.nth(0).fill('2');quantities.nth(1).fill('0')
            form.get_by_role('button',name='Update estimate',exact=True).click()
            page.wait_for_function("document.querySelector('.print-latest')?.textContent.includes('pack.zip')")
            assert form.locator('[data-part-id]').nth(0).input_value()=='2'
            assert form.locator('[data-part-id]').nth(1).input_value()=='0'
            form.locator('select[name=material]').select_option('petg')
            form.get_by_role('button',name='Update estimate',exact=True).click()
            page.wait_for_function("document.querySelector('.print-latest')?.textContent.includes('PETG')")
            assert form.locator('[data-part-id]').nth(1).input_value()=='0'
            site.assert_no_page_errors()

def test_detached_message_completion_preserves_a_newer_draft():
    with running_operator_workspace({'RESEND_API_KEY':''}) as (storefront,operator,store_path):
        first=seed_print_request(storefront,store_path,title='First draft project')
        seed_print_request(storefront,store_path,title='Second draft project')
        state=json.loads(store_path.read_text());work=next(row for row in state['workItems'] if row['requestId']==first['requestId'])
        with SiteBrowser(viewport=(1440,1000),service_workers='block') as site:
            page=site.page;held=[]
            def intercept(route):
                if route.request.method=='POST':
                    held.append((route,route.fetch()))
                else:
                    route.continue_()
            page.route('**/api/operator-work*',intercept)
            page.goto(operator+'/work/'+work['id'],wait_until='networkidle')
            page.locator('#client-message').fill('First sent message')
            page.get_by_role('button',name='Send email to client',exact=True).click()
            for _ in range(50):
                if held: break
                page.wait_for_timeout(50)
            assert len(held)==1
            page.locator('.work-row').filter(has_text='Second draft project').click()
            page.get_by_role('heading',name='Second draft project',exact=True).wait_for()
            page.locator('.work-row').filter(has_text='First draft project').click()
            page.get_by_role('heading',name='First draft project',exact=True).wait_for()
            page.locator('#client-message').fill('New draft after navigation')
            route,response=held.pop();route.fulfill(response=response)
            page.wait_for_timeout(100)
            page.locator('.work-row').filter(has_text='Second draft project').click()
            page.get_by_role('heading',name='Second draft project',exact=True).wait_for()
            page.locator('.work-row').filter(has_text='First draft project').click()
            page.get_by_role('heading',name='First draft project',exact=True).wait_for()
            assert page.locator('#client-message').input_value()=='New draft after navigation'
            site.assert_no_page_errors(allow_console_warnings=['Service Worker registration blocked by Playwright'])
