"""Vase studio: real local WASM, accessible profile editing, offline exports and handoff."""
import json
import math
import re
import zipfile
import defusedxml.ElementTree as xml
from pathlib import Path

import pytest
from playwright.sync_api import expect

from tests.e2e.test_customize import base_url, browser, page, wait_ready, wait_settled, pick_design


def download_metadata(page):
    page.get_by_role('button', name='Download my model', exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button', name='No, just give me my file', exact=True).click()
    with zipfile.ZipFile(download.value.path()) as archive:
        # The established exporter wraps the single mesh in a build assembly.
        assert archive.read('3D/3dmodel.model').count(b'<mesh>') == 1
        return json.loads(archive.read('Metadata/customizer.json'))


@pytest.mark.parametrize('design,pattern,construction', [
    ('Wind-shaped dunes', 'dune', 'solid'), ('Classic urn', 'smooth', 'solid'),
    ('Blossom', 'smooth', 'solid'), ('Twisted ripple', 'ripple', 'solid'),
    ('Hollow faceted planter', 'smooth', 'hollow'), ('Faceted rose', 'smooth', 'solid'),
    ('Layered scales', 'scales', 'solid'), ('Cell relief', 'cells', 'solid'),
    ('Zigzag crystal', 'zigzag', 'solid'), ('Organic multiscale', 'fractal', 'solid'),
])
def test_vase_presets_export_offline(page, base_url, design, pattern, construction):
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(base_url + '/customize/g/vase/')
    wait_ready(page)
    page.context.set_offline(True)
    pick_design(page, design)
    metadata = download_metadata(page)
    assert metadata['pattern'] == pattern
    assert metadata['construction'] == construction
    assert 3 <= len(metadata['profile']) <= 12
    assert metadata['template'] == 'vase-v1'
    assert not errors
    assert all(url.startswith(base_url + '/') or url.startswith('blob:') for url in requests)
    page.context.set_offline(False)


def test_vase_profile_keyboard_pointer_draft_and_handoff(page, base_url):
    page.goto(base_url + '/customize/g/vase/')
    wait_ready(page)
    expect(page.locator('.cz-profile-chart')).to_be_in_viewport()
    page.get_by_label('Point 2 radius (%)', exact=True).fill('70')
    page.get_by_label('Point 2 radius (%)', exact=True).press('Tab')
    wait_settled(page)
    page.get_by_role('button', name='Add point', exact=True).click()
    wait_settled(page)
    expect(page.locator('[data-profile-coordinate="radius"]')).to_have_count(6)
    handle = page.locator('[data-profile-handle="2"]')
    handle.scroll_into_view_if_needed()
    bounds = handle.bounding_box()
    assert bounds
    page.mouse.move(bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] / 2)
    page.mouse.down()
    page.mouse.move(bounds['x'] + bounds['width'] / 2 - 25, bounds['y'] + bounds['height'] / 2, steps=6)
    page.mouse.up()
    wait_settled(page)
    profile = json.loads(page.locator('input[name="profile"]').input_value())
    assert profile[1]['radius'] == 0.7
    page.context.set_offline(True)
    exported = download_metadata(page)
    assert exported['profile'] == profile
    page.context.set_offline(False)
    page.reload()
    wait_ready(page)
    assert json.loads(page.locator('input[name="profile"]').input_value()) == profile
    page.get_by_role('button', name='Continue to request', exact=True).click()
    expect(page.locator('#customize-notice')).to_have_text('Loaded from the customizer — review and continue.')


def test_vase_physical_endpoint_controls_change_actual_exported_dimensions(page, base_url):
    page.goto(base_url + '/customize/g/vase/')
    wait_ready(page)
    pick_design(page, 'Classic urn')
    for label, value in [('Base outside diameter (mm)', '70'), ('Mouth outside diameter (mm)', '45')]:
        control = page.get_by_label(label, exact=True)
        control.fill(value)
        control.press('Tab')
        wait_settled(page)
    page.get_by_role('button', name='Download my model', exact=True).click()
    with page.expect_download() as download:
        page.get_by_role('button', name='No, just give me my file', exact=True).click()
    with zipfile.ZipFile(download.value.path()) as archive:
        metadata = json.loads(archive.read('Metadata/customizer.json'))
        assert abs(metadata['profile'][0]['radius'] - 0.7) < 0.001
        assert abs(metadata['profile'][-1]['radius'] - 0.45) < 0.001
        model = xml.fromstring(archive.read('3D/3dmodel.model'))
        vertices = [tuple(float(vertex.attrib[key]) for key in ('x', 'y', 'z'))
                    for vertex in model.findall('.//{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}vertex')]
        cx = (min(p[0] for p in vertices) + max(p[0] for p in vertices)) / 2
        cy = (min(p[1] for p in vertices) + max(p[1] for p in vertices)) / 2
        for height, diameter in [(0, 70), (180, 45)]:
            ring = [p for p in vertices if abs(p[2] - height) < 0.0001]
            measured = 2 * max(math.hypot(p[0] - cx, p[1] - cy) for p in ring)
            assert abs(measured - diameter) < 0.05


@pytest.mark.parametrize('scheme', ['light', 'dark'])
def test_vase_mobile_profile_and_theme(browser, base_url, scheme):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, color_scheme=scheme, reduced_motion='reduce')
    page = context.new_page()
    try:
        page.goto(base_url + '/customize/g/vase/')
        wait_ready(page)
        page.get_by_role('button', name='Settings', exact=True).click()
        control = page.get_by_label('Point 1 radius (%)', exact=True)
        control.fill('65')
        control.press('Tab')
        wait_settled(page)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert json.loads(page.locator('input[name="profile"]').input_value())[0]['radius'] == 0.65
        Path('screenshots').mkdir(exist_ok=True)
        page.screenshot(path=f'screenshots/vase-studio-{scheme}-mobile.png', full_page=True)
    finally:
        context.close()
