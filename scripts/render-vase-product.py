"""Capture the original vase generator's own local realistic preview for browsing media."""
from io import BytesIO
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageOps
from playwright.sync_api import sync_playwright, expect
from tests.support.browser_harness import SYSTEM_CHROMIUM_PATH
from tests.support.server import running_server


def main():
    with running_server() as url, sync_playwright() as playwright:
        options = {'headless': True, 'args': ['--no-sandbox']}
        if SYSTEM_CHROMIUM_PATH.is_file():
            options['executable_path'] = str(SYSTEM_CHROMIUM_PATH)
        browser = playwright.chromium.launch(**options)
        try:
            page = browser.new_page(viewport={'width': 1280, 'height': 960}, reduced_motion='reduce', color_scheme='light')
            page.goto(url + '/customize/g/vase/')
            expect(page.locator('body[data-build-state="ready"]')).to_be_attached(timeout=30000)
            page.get_by_role('button', name='Realistic preview', exact=True).click()
            expect(page.locator('#cz-stage')).to_have_attribute('data-presentation-state', 'ready', timeout=30000)
            page.locator('#cz-stage canvas').wait_for(state='visible')
            page.locator('#cz-stage canvas').hover()
            page.mouse.wheel(0, -700)
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            page.evaluate("""() => {
                for (const element of document.querySelectorAll('.cz-win, #cz-status, #cz-hint, .cz-viewer-hint')) element.style.visibility = 'hidden';
            }""")
            image = Image.open(BytesIO(page.locator('#cz-stage canvas').screenshot())).convert('RGB')
            target = ROOT / 'public/assets/images/products/vase.webp'
            ImageOps.pad(image, (640, 480), color='#e8e7e1').save(target, format='WEBP', quality=88)
            page.evaluate("""() => {
                for (const element of document.querySelectorAll('.cz-win, #cz-status, #cz-hint, .cz-viewer-hint')) element.style.visibility = '';
            }""")
            page.screenshot(path=str(ROOT / 'screenshots/vase-studio-desktop.png'), full_page=True)
            print(target)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
