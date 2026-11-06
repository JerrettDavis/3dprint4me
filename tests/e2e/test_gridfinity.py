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


def test_magnetic_light_advanced_dimensions_survive_reload_and_offline_download(page, base_url):
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(base_url + '/customize/g/gridfinity-base/')
    wait_ready(page)
    page.locator('button.cz-design[data-design="magnetic-sample"]').click()
    wait_settled(page)
    expect(page.locator('#cz-style')).to_have_value('magnetic-light')
    page.locator('#cz-level').get_by_role('button', name='Advanced', exact=True).click()
    for key, value in [('light_base_mm', '4'), ('light_opening_mm', '38'), ('light_tab_wall_mm', '1.6'), ('light_magnet_diameter_mm', '6.09')]:
        page.locator('#cz-' + key).fill(value)
        page.locator('#cz-' + key).blur()
        wait_settled(page)
    expect(page.get_by_text('Wide cell openings leave a short bridging ledge', exact=False)).to_be_attached()
    page.locator('#cz-light_through_holes').uncheck()
    wait_settled(page)
    expect(page.locator('#cz-light_through_diameter_mm')).to_be_hidden()
    expect(page.locator('#cz-magnet_diameter_mm')).to_be_hidden()
    page.reload()
    wait_ready(page)
    expect(page.locator('#cz-light_opening_mm')).to_have_value('38')
    expect(page.locator('#cz-light_magnet_diameter_mm')).to_have_value('6.09')
    expect(page.locator('#cz-light_through_holes')).not_to_be_checked()
    page.context.set_offline(True)
    page.locator('#cz-light_base_mm').fill('2.4')
    page.locator('#cz-light_base_mm').blur()
    wait_settled(page)
    expect(page.locator('#cz-magnet_depth_mm')).to_have_value('2')
    filename, settings = download(page)
    assert filename == 'gridfinity-base-1x1-magnetic-light.3mf'
    assert settings['spiral_mode'] == '0'
    assert all(url.startswith(base_url + '/') or url.startswith('blob:') for url in requests)
    assert not errors


@pytest.mark.parametrize('scheme,width', [('light', 1280), ('dark', 1280), ('light', 390), ('dark', 390)])
def test_magnetic_light_reference_shape_and_responsive_controls(browser, base_url, scheme, width):
    context = browser.new_context(viewport={'width': width, 'height': 900 if width == 1280 else 844}, color_scheme=scheme, reduced_motion='reduce')
    try:
        page = context.new_page()
        page.goto(base_url + '/customize/g/gridfinity-base/')
        wait_ready(page)
        if width == 390:
            page.get_by_role('button', name='Settings', exact=True).click()
        page.locator('#cz-style').select_option('magnetic-light')
        wait_settled(page)
        page.locator('#cz-level').get_by_role('button', name='Advanced', exact=True).click()
        expect(page.locator('#cz-light_base_mm')).to_be_visible()
        page.locator('#cz-light_base_mm').scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        output = Path(__file__).resolve().parents[2] / 'screenshots'
        output.mkdir(exist_ok=True)
        page.screenshot(path=str(output / f'gridfinity-magnetic-light-{scheme}-{width}.png'), full_page=True)
        if width == 1280:
            page.locator('#cz-stage canvas').screenshot(path=str(output / f'gridfinity-magnetic-light-model-{scheme}.png'))
    finally:
        context.close()


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


@pytest.mark.parametrize('generator_id,design', [('gridfinity-base', 'magnetic'), ('gridfinity-base', 'magnetic-light'), ('gridfinity-bin', 'divided'), ('gridfinity-bin', 'vase'), ('gridfinity-bin', 'adapter')])
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
                assert custom['params']['style'] == design
                if design == 'magnetic-light':
                    assert custom['params']['light_opening_mm'] == 36
                    assert custom['params']['light_magnet_diameter_mm'] == 6.5
                    assert custom['params']['light_through_holes'] is True
            else:
                assert custom['params']['compartments_x'] == custom['params']['compartments_y'] == 2
            saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
            assert saved['customization'] == {'generatorId': generator_id, 'generatorVersion': 1}
        finally:
            context.close()
