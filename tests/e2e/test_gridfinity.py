"""Gridfinity's actual WASM builds, isolated vase exports and private hand-off."""
import json
from pathlib import Path
from zipfile import ZipFile

import pytest
from playwright.sync_api import expect

from tests.e2e.test_customize import base_url, browser, page, wait_ready, wait_settled


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
