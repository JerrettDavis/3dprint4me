"""Gridfinity's actual WASM builds, isolated vase exports and private hand-off."""
import json
from pathlib import Path
from zipfile import ZipFile

import pytest
from playwright.sync_api import expect

from tests.e2e.test_customize import base_url, browser, page, wait_ready, wait_settled
from tests.support.operator_harness import running_operator_workspace


def download(page):
    page.get_by_role('button', name='Download my model', exact=True).click()
    with page.expect_download() as pending:
        page.get_by_role('button', name='No, just give me my file', exact=True).click()
    result = pending.value
    with ZipFile(result.path()) as archive:
        settings = json.loads(archive.read('Metadata/project_settings.config'))
    return result.suggested_filename, settings


@pytest.mark.parametrize('generator_id', ['gridfinity-base', 'gridfinity-bin'])
def test_gridfinity_offline_edit_download_and_draft(page, base_url, generator_id):
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(f'{base_url}/customize/g/{generator_id}/')
    wait_ready(page)
    page.locator('#cz-columns').fill('3')
    page.locator('#cz-columns').blur()
    wait_settled(page)
    page.reload()
    wait_ready(page)
    expect(page.locator('#cz-columns')).to_have_value('3')
    page.context.set_offline(True)
    page.locator('#cz-rows').fill('1')
    page.locator('#cz-rows').blur()
    wait_settled(page)
    filename, settings = download(page)
    assert '3x1' in filename
    assert settings['spiral_mode'] == '0'
    assert all(url.startswith(base_url + '/') or url.startswith('blob:') for url in requests)
    assert not errors


def test_vase_shell_and_adapter_downloads_have_separate_settings(page, base_url):
    page.goto(base_url + '/customize/g/gridfinity-bin/')
    wait_ready(page)
    page.locator('#cz-style').select_option('vase')
    wait_settled(page)
    filename, settings = download(page)
    assert filename.endswith('vase-shell.3mf')
    assert settings['spiral_mode'] == '1'
    assert settings['top_shell_layers'] == '0'
    assert settings['bottom_shell_layers'] == '6'
    page.locator('#cz-vase_part').select_option('adapter')
    wait_settled(page)
    filename, settings = download(page)
    assert filename.endswith('vase-adapter.3mf')
    assert settings['spiral_mode'] == '0'


@pytest.mark.parametrize('scheme', ['light', 'dark'])
@pytest.mark.parametrize('generator_id', ['gridfinity-base', 'gridfinity-bin'])
def test_gridfinity_mobile_layout_and_screenshot(browser, base_url, scheme, generator_id):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme=scheme, reduced_motion='reduce')
    try:
        page = context.new_page()
        page.goto(f'{base_url}/customize/g/{generator_id}/')
        wait_ready(page)
        expect(page.locator('#cz-stage canvas')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        output = Path(__file__).resolve().parents[2] / 'screenshots'
        output.mkdir(exist_ok=True)
        page.screenshot(path=str(output / f'{generator_id}-{scheme}-mobile.png'), full_page=True)
    finally:
        context.close()


def test_bin_committed_blank_and_out_of_range_dimensions_recover(page, base_url):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url + '/customize/g/gridfinity-bin/')
    wait_ready(page)
    for value, expected in [('', '2'), ('0', '1'), ('7', '6')]:
        page.locator('#cz-columns').fill(value)
        page.locator('#cz-columns').blur()
        wait_settled(page)
        expect(page.locator('#cz-columns')).to_have_value(expected)
    assert not errors


@pytest.mark.parametrize('generator_id,design', [('gridfinity-base', 'magnetic'), ('gridfinity-bin', 'divided'), ('gridfinity-bin', 'vase'), ('gridfinity-bin', 'adapter')])
def test_gridfinity_design_private_intake_preserves_component_provenance(browser, generator_id, design):
    with running_operator_workspace() as (storefront, operator, store_path):
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        try:
            page.goto(f'{storefront}/customize/g/{generator_id}/')
            wait_ready(page)
            page.locator(f'button.cz-design[data-design="{design}"]').click()
            wait_settled(page)
            expected_component = 'adapter' if design == 'adapter' else 'shell' if design == 'vase' else None
            page.get_by_role('button', name='Continue to request', exact=True).click()
            expect(page.locator('#customize-notice')).to_have_text('Loaded from the customizer — review and continue.')
            page.locator('#next-button').click()
            expect(page.locator('#file-list')).to_contain_text(generator_id)
            if expected_component:
                expect(page.locator('#file-list')).to_contain_text('vase-' + expected_component)
            page.locator('#next-button').click()
            page.locator('#name').fill('Gridfinity QA')
            page.locator('#email').fill('gridfinity-qa@example.com')
            page.locator('#next-button').click()
            page.locator('#terms').check()
            page.locator('#submit-button').click()
            page.locator('#submission-state.visible').wait_for(state='visible', timeout=15000)
            state = json.loads(store_path.read_text(encoding='utf-8'))
            stored = [record['request'] for record in state['requests'] if record['request'].get('customization')]
            assert len(stored) == 1
            custom = stored[0]['customization']
            assert custom['generatorId'] == generator_id
            assert custom['generatorVersion'] == 1
            if expected_component:
                assert custom['params']['style'] == 'vase'
                assert custom['params']['vase_part'] == expected_component
            elif generator_id == 'gridfinity-base':
                assert custom['params']['style'] == 'magnetic'
            else:
                assert custom['params']['compartments_x'] == custom['params']['compartments_y'] == 2
            saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
            assert saved['customization'] == {'generatorId': generator_id, 'generatorVersion': 1}
        finally:
            context.close()
