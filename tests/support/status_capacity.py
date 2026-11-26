"""Render the actual protected page using synthetic readings, never live providers."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def capacity_html(theme='system'):
    return subprocess.run(['node', 'scripts/status-capacity-preview.mjs', theme], cwd=ROOT,
                          check=True, capture_output=True, text=True, encoding='utf-8', timeout=20).stdout


def capture_capacity_states(output):
    from tests.support.browser_harness import SiteBrowser
    captured = []
    for width, scheme in [(1440, 'light'), (390, 'dark'), (390, 'light')]:
        with SiteBrowser(viewport=(width, 1000), color_scheme=scheme, reduced_motion='reduce') as site:
            site.page.set_content(capacity_html(scheme), wait_until='load')
            assert site.page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')
            path = output / f'status-capacity-{width}-{scheme}.png'
            site.page.screenshot(path=str(path), full_page=True)
            site.assert_no_page_errors()
            captured.append((f'Private capacity · {width} · {scheme}', path))
    return captured
