"""The default guided UI, separate from full-form geometry regression scenarios."""
import re
import pytest
from playwright.sync_api import expect
from tests.e2e.test_customize import base_url, browser, page, BUILD_TIMEOUT

def ready(page):
    expect(page.locator("body[data-build-state=ready]")).to_be_attached(timeout=BUILD_TIMEOUT)

@pytest.mark.parametrize('generator_id', ['pumpkin','route-shield','wifi-tag','rating-card','name-plate','display-sign','gridfinity-base','gridfinity-bin','infinity-fidget','vase'])
def test_guided_default_builds_with_one_panel_and_complete_navigation(page, base_url, generator_id):
    page.goto(f'{base_url}/customize/g/{generator_id}/')
    if generator_id == 'wifi-tag':
        page.get_by_label('Network password',exact=True).fill('test-private-network')
        page.get_by_label('Network password',exact=True).press('Tab')
    ready(page)
    nav=page.get_by_role('navigation', name='Design sections')
    expect(nav).to_be_visible()
    assert 3 <= nav.locator('button[data-editing-section]').count() <= 4
    preview=page.locator('.cz-preview').bounding_box()
    controls=page.locator('.cz-panels').bounding_box()
    assert preview['x'] + preview['width'] <= controls['x'] + 2
    hint=page.locator('#cz-hint')
    if hint.is_visible():
        assert hint.bounding_box()['height'] < preview['height'] / 4, 'The navigation hint must not cover the product'
    page.get_by_role('button',name='Review design',exact=True).click()
    expect(page.locator('#cz-review-specification')).to_be_visible()
    expect(page.locator('#cz-win-settings')).to_be_hidden()
    expect(page.locator('#cz-facts-list')).to_be_visible()

@pytest.mark.parametrize('scheme',['light','dark'])
def test_grouped_visual_choice_keyboard_review_and_mobile_state(browser, base_url, scheme):
    context=browser.new_context(viewport={'width':390,'height':844},color_scheme=scheme,reduced_motion='reduce')
    page=context.new_page()
    try:
        page.goto(f'{base_url}/customize/g/pumpkin/')
        ready(page)
        witch=page.get_by_role('radio', name=re.compile('Witch ·'))
        witch.focus()
        page.keyboard.press('ArrowRight')
        expect(page.get_by_role('radio',name=re.compile('Santa ·'))).to_be_checked()
        ready(page)
        page.get_by_role('button',name='Review design',exact=True).click()
        expect(page.locator('#cz-review-specification')).to_be_visible()
        expect(page.locator('#cz-review-specification')).to_contain_text('Santa')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.get_by_role('button',name='Design & appearance',exact=True).click()
        expect(page.get_by_role('radio',name=re.compile('Santa ·'))).to_be_checked()
        assert page.locator('#cz-topper').input_value()=='santa'
    finally:
        context.close()

def test_guided_review_never_includes_wifi_secret(page,base_url):
    page.goto(f'{base_url}/customize/g/wifi-tag/')
    page.get_by_label('Network password',exact=True).fill('private-guided-secret')
    page.get_by_label('Network password',exact=True).press('Tab')
    ready(page)
    page.get_by_role('button',name='Review design',exact=True).click()
    assert 'private-guided-secret' not in page.locator('#cz-review-specification').inner_text()
    assert 'private-guided-secret' not in page.content()

def test_undo_routes_out_of_a_section_that_becomes_unavailable(page,base_url):
    page.goto(f'{base_url}/customize/g/pumpkin/')
    ready(page)
    page.locator('#cz-designs-toggle').click()
    page.get_by_text("Jack-o'-lantern",exact=True).click()
    ready(page)
    nav=page.get_by_role('navigation',name='Design sections')
    nav.get_by_role('button',name='Size & construction',exact=True).click()
    page.get_by_role('button',name='Undo',exact=True).click()
    ready(page)
    expect(nav.get_by_role('button',name='Design & appearance',exact=True)).to_have_attribute('aria-current','step')
    expect(page.locator('[data-field=topper]')).to_be_visible()

def test_guided_validation_link_reveals_another_section(page,base_url):
    page.goto(f'{base_url}/customize/g/wifi-tag/')
    page.get_by_label('Network password',exact=True).fill('private-guided-network')
    page.get_by_label('Network password',exact=True).press('Tab')
    ready(page)
    nav=page.get_by_role('navigation',name='Design sections')
    nav.get_by_role('button',name='Style & size',exact=True).click()
    page.locator('#cz-qr_color').evaluate("el=>{el.value='#eeeeee';el.dispatchEvent(new Event('change',{bubbles:true}));}")
    nav.get_by_role('button',name='Content & details',exact=True).click()
    page.locator('.cz-step-error').filter(has_text='too similar').first.click()
    expect(nav.get_by_role('button',name='Style & size',exact=True)).to_have_attribute('aria-current','step')
    expect(page.locator('#cz-base_color')).to_be_focused()

@pytest.mark.parametrize('generator_id',['route-shield','pumpkin','display-sign','gridfinity-bin'])
def test_guided_enlarged_text_reflows_at_320px(page,base_url,generator_id):
    page.set_viewport_size({'width':320,'height':844})
    page.goto(f'{base_url}/customize/g/{generator_id}/')
    ready(page)
    page.add_style_tag(content='html { font-size:200% !important }')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

def test_larger_preset_is_framed_without_clipping_the_product(page,base_url):
    import io
    from PIL import Image
    page.emulate_media(reduced_motion='reduce')
    page.goto(f'{base_url}/customize/g/pumpkin/')
    ready(page)
    page.locator('#cz-designs-toggle').click()
    page.get_by_text("Jack-o'-lantern",exact=True).click()
    ready(page)
    image=Image.open(io.BytesIO(page.locator('#cz-stage canvas').screenshot())).convert('RGB')
    mask=Image.new('1',image.size)
    pixels=image.get_flattened_data() if hasattr(image,'get_flattened_data') else image.getdata()
    mask.putdata([r>100 and g>40 and r>g*1.15 and g>b*1.4 for r,g,b in pixels])
    bounds=mask.getbbox()
    assert bounds and bounds[1]>2 and bounds[3]<image.height-2, (bounds,image.size)

def test_complex_builder_groups_details_without_adding_steps_or_losing_edits(page,base_url):
    page.goto(f'{base_url}/customize/g/display-sign/')
    ready(page)
    assert page.locator('#cz-form .cz-field:visible').count() <= 20
    text=page.get_by_label('Text 1',exact=True)
    expect(text).to_be_visible()
    text.fill('Grouped details')
    text.press('Tab')
    ready(page)
    page.get_by_role('button',name='Review design',exact=True).click()
    expect(page.locator('#cz-review-specification')).to_contain_text('Grouped details')
    page.get_by_role('navigation',name='Design sections').get_by_role('button',name='Text & artwork',exact=True).click()
    expect(text).to_have_value('Grouped details')
    assert page.get_by_role('navigation',name='Design sections').locator('[data-editing-section]').count()==4
