"""Render catalog media from the actual default generator geometry; no AI imagery."""
from io import BytesIO
from pathlib import Path
import sys

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.support.browser_harness import SiteBrowser
from tests.support.server import running_server

ROOT = Path(__file__).resolve().parents[1]

with running_server() as base_url:
    for generator in ['gridfinity-base', 'gridfinity-bin']:
        with SiteBrowser(viewport=(1100, 900), color_scheme='light', reduced_motion='reduce') as site:
            page = site.goto(f'{base_url}/customize/g/{generator}/')
            page.wait_for_selector("body[data-build-state='ready']", timeout=30000)
            page.wait_for_timeout(200)
            page.add_style_tag(content='body * { visibility: hidden !important; } #cz-stage canvas { visibility: visible !important; }')
            data = page.locator('#cz-stage canvas').screenshot()
            image = ImageOps.fit(Image.open(BytesIO(data)).convert('RGB'), (640, 480))
            image.save(ROOT / f'public/assets/images/products/{generator}.webp', quality=88)
            site.assert_no_page_errors(allow_console_warnings=('GPU stall due to ReadPixels',))
