"""Real shop → pinned local model → recoverable print request, with no remote generator calls."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
import pytest
from playwright.sync_api import expect, sync_playwright
from tests.support.server import running_server
from tests.support.browser_harness import SYSTEM_CHROMIUM_PATH
from tests.support.operator_harness import running_operator_workspace
from tests.support.catalogue_preview import owner_catalogue_fixture, install_owner_catalogue_fixture


@pytest.fixture(scope='module')
def catalogue_browser():
    with sync_playwright() as p:
        options = {'headless': True, 'args': ['--no-sandbox']}
        if SYSTEM_CHROMIUM_PATH.is_file():
            options['executable_path'] = str(SYSTEM_CHROMIUM_PATH)
        browser = p.chromium.launch(**options)
        yield browser
        browser.close()


@pytest.fixture(scope='module')
def catalogue_url():
    with running_server() as url:
        yield url


def test_shop_filters_and_deep_links_preserve_a_saved_draft(catalogue_browser, catalogue_url):
    with catalogue_browser.new_context(viewport={'width': 390, 'height': 844}) as context:
        page = context.new_page()
        page.goto(catalogue_url + '/shop/')
        page.get_by_label('Find a design', exact=True).fill('keychain')
        page.get_by_label('Shop by collection').select_option('Names & signs')
        expect(page.locator('.catalogue-card:visible')).to_have_count(1)
        page.reload()
        expect(page.locator('.catalogue-card:visible')).to_have_count(1)
        page.locator('.catalogue-card:visible a').click()
        expect(page.locator('h1')).to_contain_text(re.compile('keychain', re.I))
        product_title = page.locator('h1').inner_text()
        expect(page.locator('.catalogue-product img')).to_have_count(2)
        request_box = page.get_by_role('link', name='Request this design', exact=True).bounding_box()
        assert request_box['y'] + request_box['height'] < 844, 'the primary request action should be visible in the first mobile screen'
        draft_key = '3dp-customize:name-plate:v2'
        saved = json.dumps({'name': 'PRIVATE DRAFT'})
        page.evaluate('([key, value]) => sessionStorage.setItem(key, value)', [draft_key, saved])
        page.get_by_role('link', name='Request this design', exact=True).click()
        expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
        expect(page.locator('input[name="name"]')).to_have_value('Alex')
        assert page.evaluate('(key) => sessionStorage.getItem(key)', draft_key) == saved
        expect(page.locator('#cz-form')).to_be_hidden()
        page.get_by_role('button', name='Change settings', exact=True).click()
        page.get_by_label('Name', exact=True).fill('GALLERY')
        page.get_by_label('Name', exact=True).press('Tab')
        expect(page.locator('#cz-form:not([data-settling])')).to_be_attached(timeout=60000)
        expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
        assert page.evaluate('(key) => sessionStorage.getItem(key)', draft_key) == saved
        page.reload()
        expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
        expect(page.locator('input[name="name"]')).to_have_value('GALLERY')
        page.get_by_role('button', name='Request this design', exact=True).click()
        page.wait_for_url('**/order.html?service=print&from=customize')
        expect(page.locator('#customize-notice')).to_contain_text('Loaded from the customizer', timeout=15000)
        expect(page.locator('#project-title')).to_have_value(f'Custom {product_title}')
        page.locator('#next-button').click()
        expect(page.locator('#file-list')).to_contain_text('name-plate')
        assert page.url.startswith(catalogue_url)


def test_home_product_category_opens_a_pictured_collection(catalogue_browser, catalogue_url):
    with catalogue_browser.new_context() as context:
        page = context.new_page()
        page.goto(catalogue_url + '/')
        page.locator('a.cat-tile[href="/shop/?generator=pumpkin"]').click()
        expect(page.locator('.catalogue-card:visible')).to_have_count(3)
        expect(page.locator('.catalogue-card:visible')).to_contain_text(['pumpkin', 'pumpkin', 'pumpkin'])

@pytest.mark.parametrize('width,scheme', [(1440, 'light'), (390, 'dark')])
def test_owner_publication_controls_show_pending_then_verified_withdrawal(catalogue_browser, width, scheme):
    with running_operator_workspace() as (_, operator, _):
        with catalogue_browser.new_context(viewport={'width': width, 'height': 844}, color_scheme=scheme, service_workers='block') as context:
            page = context.new_page()
            product = {'id': 'office-sign', 'revision': 5, 'generatorId': 'name-plate', 'generatorVersion': 2,
                       'title': 'Office sign', 'category': 'Signs', 'summary': 'A house design.', 'permissionNote': 'House design.',
                       'params': {}, 'status': 'approved', 'render': None, 'published': None}
            actions = []
            headers = {'access-control-allow-origin': operator, 'access-control-allow-credentials': 'true',
                       'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
            def catalogue_route(route):
                if 'resource=catalogue' not in route.request.url:
                    return route.fallback()
                if route.request.method == 'POST':
                    command = route.request.post_data_json
                    actions.append(command['action'])
                    product.update(status='publishing', revision=product['revision'] + 1,
                                   publication={'phase': 'queued', 'operation': command['action']})
                    return route.fulfill(headers=headers, json={'configured': True, 'product': product})
                if 'id=office-sign' in route.request.url:
                    return route.fulfill(headers=headers, json={'configured': True, 'renderConfigured': True, 'publishConfigured': True, 'product': product, 'fields': []})
                route.fulfill(headers=headers, json={'configured': True, 'renderConfigured': True, 'publishConfigured': True, 'products': [product]})
            page.route('**/api/operator-work?**', catalogue_route)
            page.goto(operator)
            page.get_by_role('button', name='Product catalogue', exact=True).click()
            dialog = page.get_by_role('dialog', name='Product catalogue')
            expect(dialog.get_by_role('status')).to_contain_text('1 private catalogue products', timeout=5000)
            dialog.get_by_role('button', name='Office sign', exact=True).click()
            dialog.get_by_role('button', name='Publish reviewed product', exact=True).click()
            expect(dialog.get_by_text('Waiting for the public release to be verified.', exact=True)).to_be_visible()
            expect(dialog.get_by_role('button', name='Save private draft', exact=True)).to_be_disabled()
            product.update(status='published', revision=7, published={'revision': 1, 'snapshot': {'status': 'published'}}, publication={'phase': 'live'})
            dialog.get_by_role('button', name='Refresh product', exact=True).click()
            expect(dialog.get_by_text('Verified public revision 1.', exact=True)).to_be_visible()
            dialog.get_by_role('button', name='Withdraw public product', exact=True).click()
            expect(dialog.get_by_text('Waiting for the public release to be verified.', exact=True)).to_be_visible()
            assert actions == ['publish', 'withdraw']

def test_missing_private_preview_keeps_owner_rebuild_controls(catalogue_browser):
    with running_operator_workspace() as (_, operator, _):
        with catalogue_browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block') as context:
            page = context.new_page()
            fixture = owner_catalogue_fixture()
            install_owner_catalogue_fixture(page, operator, fixture)
            page.route('**/*preview=*', lambda route: route.fulfill(status=409, headers={'access-control-allow-origin': operator, 'access-control-allow-credentials': 'true'}, json={'error': 'This private preview needs to be built again.'}))
            page.goto(operator)
            page.get_by_role('button', name='Product catalogue', exact=True).click()
            dialog = page.get_by_role('dialog', name='Product catalogue')
            dialog.get_by_role('button', name=fixture['product']['title'], exact=True).click()
            expect(dialog.get_by_text('Private previews are unavailable. Build fresh previews to review this product.', exact=True)).to_be_visible()
            expect(dialog.get_by_role('button', name='Publish reviewed product', exact=True)).to_be_disabled()
            dialog.get_by_role('button', name='Build previews', exact=True).click()
            expect(dialog.get_by_role('status')).to_contain_text('Preview job queued')


def test_invalid_product_does_not_build_a_different_default(catalogue_browser, catalogue_url):
    with catalogue_browser.new_context() as context:
        page = context.new_page()
        page.goto(catalogue_url + '/customize/g/name-plate/?product=missing&revision=1')
        expect(page.locator('#cz-status')).to_contain_text('unavailable')
        expect(page.get_by_role('button', name='Continue to request', exact=True)).to_be_disabled()
        expect(page.get_by_role('link', name='Return to the shop', exact=True)).to_be_visible()
        assert page.locator("body[data-build-state='ready']").count() == 0


def test_selected_product_edits_and_downloads_offline_without_remote_requests(catalogue_browser, catalogue_url):
    with catalogue_browser.new_context() as context:
        page = context.new_page()
        remote = []
        page.on('request', lambda request: remote.append(request.url) if not request.url.startswith((catalogue_url, 'blob:', 'data:')) else None)
        page.goto(catalogue_url + '/customize/g/name-plate/?product=name-plate-office&revision=1')
        expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
        context.set_offline(True)
        page.get_by_label('Name', exact=True).fill('OFFLINE')
        page.get_by_label('Name', exact=True).press('Tab')
        expect(page.locator('#cz-form:not([data-settling])')).to_be_attached(timeout=60000)
        expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
        page.get_by_role('button', name='Download my model', exact=True).click()
        with page.expect_download() as info:
            page.get_by_role('button', name='No, just give me my file', exact=True).click()
        import zipfile
        with zipfile.ZipFile(info.value.path()) as archive:
            provenance = json.loads(archive.read('Metadata/customizer.json'))
        assert provenance['name'] == 'OFFLINE'
        assert provenance['size'] == 'office'
        assert remote == []


def test_owner_promotes_private_customization_and_saves_a_reusable_safe_draft(catalogue_browser):
    with running_operator_workspace() as (storefront, operator, store_path):
        script = '''import {createLocalWorkRepository} from './lib/work-management/adapters/local-work-repository.js';
const store=createLocalWorkRepository({path:process.argv[1]});
const result=await store.completeRequestWithWork('catalogue-source-request', {service:'print',projectTitle:'Private sample nameplate',description:'A sample customer request.',contact:{name:'Private Person',email:'private@example.test'},customization:{generatorId:'name-plate',generatorVersion:2,params:{name:'CUSTOMER PRIVATE',style:'raised',plate:'rect'}}},[]);
console.log(result.workItem.id);'''
        created = subprocess.run(['node', '--input-type=module', '-e', script, str(store_path)], cwd=Path(__file__).resolve().parents[2], check=True, capture_output=True, text=True)
        work_id = created.stdout.strip()
        with catalogue_browser.new_context(viewport={'width': 390, 'height': 844}) as context:
            page = context.new_page()
            page.goto(operator + '/work/' + work_id)
            page.get_by_role('button', name='Create gallery product', exact=True).click()
            dialog = page.get_by_role('dialog', name='Product catalogue')
            expect(dialog).to_be_visible()
            dialog.get_by_label('Product ID', exact=True).fill('office-name-sign')
            dialog.get_by_role('button', name='Create private draft', exact=True).click()
            expect(dialog.get_by_label('Product title', exact=True)).to_be_visible()
            expect(dialog.get_by_label('Primary image description', exact=True)).to_have_value('')
            expect(dialog.get_by_label('Name', exact=True)).to_have_value('Alex')
            dialog.get_by_label('Product title', exact=True).fill('Office name sign')
            dialog.get_by_label('Collection', exact=True).fill('Names & signs')
            dialog.get_by_label('Short description', exact=True).fill('A personal sign for a desk.')
            dialog.get_by_label('Permission and rights evidence', exact=True).fill('House design with generic example text.')
            dialog.get_by_role('button', name='Save private draft', exact=True).click()
            expect(dialog.get_by_role('status')).to_contain_text('Private draft saved')
            expect(dialog.get_by_role('button', name='Build previews', exact=True)).to_be_disabled()
            dialog.get_by_role('button', name='Close catalogue', exact=True).click()
            page.get_by_role('button', name='Product catalogue', exact=True).click()
            dialog.locator('[data-product-id="office-name-sign"]').get_by_role('button', name='Office name sign', exact=True).click()
            expect(dialog.get_by_label('Product title', exact=True)).to_have_value('Office name sign')
        catalogue_state = json.loads(Path(str(store_path) + '.invoices.json.catalogue.json').read_text())
        assert 'CUSTOMER PRIVATE' not in json.dumps(catalogue_state)
        assert next(r for r in catalogue_state['records'] if r['draft']['id'] == 'office-name-sign')['sourceWorkId'] == work_id
