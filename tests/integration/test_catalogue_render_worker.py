"""Opt-in real Blender worker proof: CATALOGUE_RENDER_INTEGRATION=1 python -m pytest this_file -q."""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest
from playwright.sync_api import expect
from tests.e2e.test_product_catalogue import catalogue_browser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import request

def test_finished_preview_uses_immutable_byte_hash_in_public_filename(tmp_path):
    from PIL import Image
    import hashlib
    work = tmp_path / 'render-fixture'
    work.mkdir()
    (work / 'recipes.json').write_text(json.dumps({'renders': [{'id': 'sample', 'output': 'catalogue/sample-hero.webp'}]}))
    (work / 'mesh-receipt.json').write_text(json.dumps({'jobId': 'render-fixture'}))
    Image.new('RGB', (20, 20), 'blue').save(work / 'sample.png')
    subprocess.run([sys.executable, 'scripts/finish-catalogue-job.py'], cwd=Path(__file__).resolve().parents[2],
                   env={**os.environ, 'PRODUCT_RENDER_WORK_DIR': str(work), 'PRODUCT_RENDER_PRIVATE_ROOT': str(tmp_path)}, check=True)
    receipt = json.loads((work / 'result.json').read_text())
    digest = hashlib.sha256((work / 'preview-0.webp').read_bytes()).hexdigest()
    assert receipt['images'][0]['src'] == f'/assets/images/products/catalogue/sample-hero-{digest[:16]}.webp?v={digest[:16]}'


@pytest.mark.skipif(os.environ.get('CATALOGUE_RENDER_INTEGRATION') != '1', reason='Requires local Blender 5.2 and Pillow')
def test_owner_builds_and_reviews_private_studio_previews(catalogue_browser):
    with tempfile.TemporaryDirectory(prefix='catalogue-private-') as private:
        with running_operator_workspace({'CATALOGUE_WORKER_ENABLED': '1', 'CATALOGUE_PRIVATE_PATH': private, 'PYTHON_BIN': sys.executable}) as (storefront, operator, store_path):
            script = '''import {createLocalWorkRepository} from './lib/work-management/adapters/local-work-repository.js';
const store=createLocalWorkRepository({path:process.argv[1]});
const result=await store.completeRequestWithWork('catalogue-render-source', {service:'print',projectTitle:'Private sample sign',description:'Sample request.',contact:{name:'Private Customer',email:'private@example.test'},customization:{generatorId:'name-plate',generatorVersion:2,params:{name:'CUSTOMER PRIVATE',style:'raised',plate:'rect'}}},[]);
console.log(result.workItem.id);'''
            seeded = subprocess.run(['node', '--input-type=module', '-e', script, str(store_path)], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, check=True)
            with catalogue_browser.new_context(viewport={'width': 1280, 'height': 900}) as context:
                page = context.new_page()
                page.goto(operator + '/work/' + seeded.stdout.strip())
                page.get_by_role('button', name='Create gallery product', exact=True).click()
                dialog = page.get_by_role('dialog', name='Product catalogue')
                dialog.get_by_label('Product ID', exact=True).fill('private-render-proof')
                dialog.get_by_role('button', name='Create private draft', exact=True).click()
                dialog.get_by_label('Product title', exact=True).fill('Desk name sign')
                dialog.get_by_label('Collection', exact=True).fill('Names & signs')
                dialog.get_by_label('Short description', exact=True).fill('A personal desk sign.')
                dialog.get_by_label('Permission and rights evidence', exact=True).fill('House design with generic example text.')
                dialog.get_by_role('button', name='Save private draft', exact=True).click()
                expect(dialog.get_by_role('status')).to_contain_text('Private draft saved')
                dialog.get_by_role('button', name='Build previews', exact=True).click()
                expect(dialog.get_by_role('status')).to_contain_text('queued')
                for _ in range(60):
                    dialog.get_by_role('button', name='Refresh product', exact=True).click()
                    if dialog.locator('.catalogue-owner-previews img').count() == 2:
                        break
                    page.wait_for_timeout(2000)
                expect(dialog.locator('.catalogue-owner-previews img')).to_have_count(2)
                assert dialog.locator('.catalogue-owner-previews img').first.evaluate('(image) => image.naturalWidth') == 960
                dialog.get_by_role('button', name='Approve reviewed previews', exact=True).click()
                expect(dialog.get_by_role('status')).to_contain_text('has not been published')
                with page.expect_popup() as opened:
                    dialog.get_by_role('link', name='Inspect these settings in the design tool', exact=True).click()
                inspection = opened.value
                expect(inspection.locator("body[data-build-state='ready']")).to_be_attached(timeout=60000)
                expect(inspection.get_by_label('Name', exact=True)).to_have_value('Alex')
                assert '#catalogue-preview=' in inspection.url and 'CUSTOMER' not in inspection.url
                inspection.close()
                Path('screenshots').mkdir(exist_ok=True)
                page.screenshot(path='screenshots/catalogue-admin-reviewed.png')
            state = json.loads(Path(str(store_path) + '.invoices.json.catalogue.json').read_text())
            product = state['records'][0]['draft']
            assert product['status'] == 'approved'
            assert 'CUSTOMER PRIVATE' not in json.dumps(state)
            assert request(storefront + product['render']['images'][0]['src'])[0] == 404
            assert request(storefront + '/api/operator-work?resource=catalogue&id=private-render-proof&preview=0', headers={'Origin': 'https://untrusted.example'})[0] == 403
