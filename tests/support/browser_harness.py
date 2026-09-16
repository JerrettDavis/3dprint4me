from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SITE_ROOT = ROOT / "public"
CSS_PATH = SITE_ROOT / "assets/css/site.css"
SYSTEM_CHROMIUM_PATH = Path(os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"))


def _module_source(path: Path) -> str:
    """Convert the small production ES module graph into one equivalent inline script.

    The managed Chromium available in this build environment blocks every URL through
    enterprise policy. Inline rendering lets us execute the production source without
    weakening that policy or replacing browser behavior with a DOM emulator.
    """
    source = path.read_text(encoding="utf-8")
    source = re.sub(r"^\s*import\s+[^;]+;\s*$", "", source, flags=re.MULTILINE)
    source = re.sub(r"\bexport\s+(?=(?:const|let|var|function|class|async\s+function)\b)", "", source)
    return f"\n/* source: {path.relative_to(ROOT).as_posix()} */\n{source}\n"


def _bundle(order: bool, *, home: bool = False) -> str:
    if home:
        paths = [SITE_ROOT / "assets/evolution" / name for name in (
            "inquiry-core.js", "projects.js", "inquiry-client.js", "app.js"
        )]
        bundle = "(() => {" + _module_source(SITE_ROOT / "assets/js/config.js") + _module_source(SITE_ROOT / "assets/js/site.js") + "})();\n" + "\n".join(_module_source(path) for path in paths)
        # Gallery and dialog photos are created from the production project data.
        return re.sub(
            r"(?P<quote>['\"])(?P<path>/assets/[^'\"]+\.(?:svg|png|jpe?g|webp))(?P=quote)",
            lambda match: json.dumps(_asset_data_uri(match.group("path"))),
            bundle,
        )
    paths = [SITE_ROOT / "assets/js/config.js"]
    if order:
        paths.append(SITE_ROOT / "assets/js/quote-engine.js")
    paths.append(SITE_ROOT / "assets/js/site.js")
    if order:
        paths.append(SITE_ROOT / "assets/js/order.js")
    bundle = "\n".join(_module_source(path) for path in paths)
    # Header/footer art is created from JavaScript, so make that image self-contained too.
    mark_uri = _asset_data_uri("/assets/icons/mark.svg")
    return bundle.replace('"/assets/icons/mark.svg"', json.dumps(mark_uri))


def _asset_data_uri(root_relative_path: str) -> str:
    path = SITE_ROOT / root_relative_path.lstrip("/")
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    suffix = path.suffix.lower()
    mime = {
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")
    return f"data:{mime};base64,{payload}"


def _inline_static_images(html: str) -> str:
    pattern = re.compile(r'(?P<prefix>\b(?:src|poster)=["\'])(?P<path>/assets/[^"\']+|/favicon\.svg)(?P<suffix>["\'])')

    def replace(match: re.Match[str]) -> str:
        return f"{match.group('prefix')}{_asset_data_uri(match.group('path'))}{match.group('suffix')}"

    return pattern.sub(replace, html)


def _storage_preamble(pathname: str, search: str, storage: dict[str, str] | None) -> str:
    initial = json.dumps(storage or {})
    return f"""
<script>
(() => {{
  const values = new Map(Object.entries({initial}));
  const storage = {{
    getItem(key) {{ key = String(key); return values.has(key) ? values.get(key) : null; }},
    setItem(key, value) {{ values.set(String(key), String(value)); }},
    removeItem(key) {{ values.delete(String(key)); }},
    clear() {{ values.clear(); }},
    key(index) {{ return [...values.keys()][Number(index)] ?? null; }},
    get length() {{ return values.size; }}
  }};
  Object.defineProperty(window, "localStorage", {{ configurable: true, value: storage }});
  Object.defineProperty(window, "sessionStorage", {{ configurable: true, value: storage }});
  window.__THREEDP_STORAGE = values;
  window.__THREEDP_TEST_PATH = {json.dumps(pathname)};
  window.__THREEDP_TEST_SEARCH = {json.dumps(search)};
  if (typeof crypto.randomUUID !== "function") {{
    Object.defineProperty(crypto, "randomUUID", {{ value: () => "10000000-1000-4000-8000-100000000000" }});
  }}
  window.fetch = async () => {{ throw new TypeError("Network intentionally unavailable in isolated browser verification"); }};
}})();
</script>
"""


def render_page_html(route: str, *, storage: dict[str, str] | None = None, storage_denied: bool = False) -> str:
    """Return a self-contained browser-test copy of a production route."""
    route_path, _, query = route.partition("?")
    filename = route_path.strip("/") or "index.html"
    if not filename.endswith(".html"):
        filename += ".html"
    source_path = SITE_ROOT / filename
    if not source_path.is_file():
        raise FileNotFoundError(f"Unknown site route: {route}")

    html = source_path.read_text(encoding="utf-8")
    html = re.sub(
        r'<link\s+rel=["\']stylesheet["\']\s+href=["\'](?P<path>/assets/[^"\'?]+\.css)(?:\?v=[a-f0-9]+)?["\']\s*/?>',
        lambda match: "<style>\n" + (SITE_ROOT / match.group("path").lstrip("/")).read_text(encoding="utf-8") + "\n</style>",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(r'<link\s+rel=["\'](?:icon|manifest)["\'][^>]*>', "", html, flags=re.IGNORECASE)
    order = filename == "order.html"
    html = re.sub(
        r'<script\s+type=["\']module["\']\s+src=["\']/assets/(?:js/(?:site|order)|evolution/app)\.js(?:\?v=[a-f0-9]+)?["\']\s*>\s*</script>',
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = _inline_static_images(html)
    preamble = _storage_preamble(f"/{filename}" if filename != "index.html" else "/", f"?{query}" if query else "", storage)
    scripts = f"<script>\n{_bundle(order, home=filename == 'index.html')}\n</script>"
    denied_script = "<script>Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } });</script>" if storage_denied else ""
    html = html.replace("</head>", f"{preamble}{denied_script}</head>", 1)
    html = html.replace("</body>", f"{scripts}</body>", 1)
    return html


@dataclass
class ConsoleEntry:
    kind: str
    text: str


class SiteBrowser:
    """Playwright wrapper used by E2E tests, the UX audit, and screenshots."""

    def __init__(
        self,
        *,
        viewport: tuple[int, int] = (1440, 1000),
        color_scheme: str = "light",
        reduced_motion: str = "no-preference",
        device_scale_factor: float = 1,
    ) -> None:
        self.viewport = viewport
        self.color_scheme = color_scheme
        self.reduced_motion = reduced_motion
        self.device_scale_factor = device_scale_factor
        self._playwright = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self.console: list[ConsoleEntry] = []
        self.page_errors: list[str] = []

    def __enter__(self) -> "SiteBrowser":
        self._playwright = sync_playwright().start()
        launch_options = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        if SYSTEM_CHROMIUM_PATH.is_file():
            launch_options["executable_path"] = str(SYSTEM_CHROMIUM_PATH)
        self.browser = self._playwright.chromium.launch(**launch_options)
        self.context = self.browser.new_context(
            viewport={"width": self.viewport[0], "height": self.viewport[1]},
            color_scheme=self.color_scheme,
            reduced_motion=self.reduced_motion,
            device_scale_factor=self.device_scale_factor,
        )
        self.page = self.context.new_page()
        self._attach_page_listeners()
        return self

    def _attach_page_listeners(self) -> None:
        if not self.page:
            return
        self.page.on("console", lambda message: self.console.append(ConsoleEntry(message.type, message.text)))
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.context:
            self.context.close()
        if self.browser:
            self.browser.close()
        if self._playwright:
            self._playwright.stop()

    def load(self, route: str, *, storage: dict[str, str] | None = None, storage_denied: bool = False) -> Page:
        if not self.context:
            raise RuntimeError("SiteBrowser must be used as a context manager")
        if self.page:
            self.page.close()
        self.console.clear()
        self.page_errors.clear()
        self.page = self.context.new_page()
        self._attach_page_listeners()
        self.page.set_content(render_page_html(route, storage=storage, storage_denied=storage_denied), wait_until="load")
        self.page.wait_for_timeout(80)
        return self.page

    def screenshot(self, path: Path, *, full_page: bool = True) -> None:
        if not self.page:
            raise RuntimeError("No page loaded")
        path.parent.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(path), full_page=full_page, animations="disabled")

    def assert_no_page_errors(self, *, allow_console_warnings: Iterable[str] = ()) -> None:
        if self.page_errors:
            raise AssertionError(f"Browser page errors: {self.page_errors}")
        allowed = tuple(allow_console_warnings)
        unexpected = [entry for entry in self.console if entry.kind == "error" or (entry.kind == "warning" and not any(fragment in entry.text for fragment in allowed))]
        if unexpected:
            raise AssertionError(f"Unexpected browser console entries: {unexpected}")
