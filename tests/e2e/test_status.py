from __future__ import annotations

import functools
import json
import threading
import time
import pytest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tests.support.browser_harness import SiteBrowser


def test_independent_status_is_responsive_and_expires_green_evidence() -> None:
    root = Path(__file__).resolve().parents[2] / "status/public"
    assert (root / "index.html").is_file()
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(SimpleHTTPRequestHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with SiteBrowser(viewport=(390, 844), color_scheme="dark", reduced_motion="reduce") as site:
            page = site.page
            assert page is not None
            now = int(time.time() * 1000)
            snapshot = {"version": 1, "generatedAt": now, "checkedAt": now,
                        "components": [{"id": "storefront", "name": "Storefront <script>alert(1)</script>", "status": "operational", "checkedAt": now}],
                        "history": [], "incidents": []}
            page.route("https://status-api.3dprint4.me/api/public", lambda route: route.fulfill(content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(snapshot)))
            page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="networkidle")
            page.locator("#components [data-status='operational']").wait_for()
            assert page.locator("#components script").count() == 0
            assert "<script>" in page.locator("#components").inner_text()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.get_by_label("Appearance").select_option("light")
            assert page.locator("html").get_attribute("data-theme") == "light"
            snapshot["components"] = [{"id":"email","name":"Request receipts","status":"operational","checkedAt":now,"verifiedAt":now-4*3600000,"validUntil":now+60000,"scope":"Owner-confirmed delivery"}]
            page.get_by_role("button", name="Refresh status").click()
            page.locator("#components [data-status='operational']").wait_for()
            assert "Owner-confirmed delivery" in page.locator("#components .scope").inner_text()
            assert "·" in page.locator("#components .scope").inner_text(), "Show the actual functional verification date"
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.screenshot(path=str(root.parents[1] / "screenshots/status-functional-mobile.png"), full_page=True)
            snapshot["components"][0]["validUntil"] = now-1
            page.get_by_role("button", name="Refresh status").click()
            page.locator("#components [data-status='unknown']").wait_for()
            snapshot["checkedAt"] = now - 13 * 60000
            snapshot["components"][0]["checkedAt"] = snapshot["checkedAt"]
            page.get_by_role("button", name="Refresh status").click()
            page.locator("#components [data-status='unknown']").wait_for()
            assert "fresh" in page.locator("#summary").inner_text().lower()
            page.route("https://status-api.3dprint4.me/api/public", lambda route: route.abort())
            page.get_by_role("button", name="Refresh status").click()
            page.get_by_text("Status evidence could not be refreshed.", exact=False).wait_for()
            page.screenshot(path=str(root.parents[1] / "screenshots/status-mobile.png"), full_page=True)
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("expiry", ["functional", "api", "control"])
def test_functional_status_expires_in_open_tab_when_refresh_fails(expiry: str) -> None:
    root = Path(__file__).resolve().parents[2] / "status/public"
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(SimpleHTTPRequestHandler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with SiteBrowser(viewport=(390, 844), color_scheme="dark", reduced_motion="reduce") as site:
            page = site.page
            now = int(time.time() * 1000)
            checked = now-11*60000 if expiry == "api" else now
            verified = now-86400000+60000 if expiry == "functional" else now-3600000
            until = now+60000 if expiry in ("functional", "control") else verified+86400000
            snapshot = {"version":1,"checkedAt":now,"components":[{"id":"email","name":"Request receipts","status":"operational","checkedAt":checked,"verifiedAt":verified,"validUntil":until,"scope":"Owner-confirmed delivery"}]}
            endpoint = "https://status-api.3dprint4.me/api/public"
            page.route(endpoint, lambda route: route.fulfill(content_type="application/json", headers={"Access-Control-Allow-Origin":"*"}, body=json.dumps(snapshot)))
            page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="networkidle")
            page.locator("#components [data-status='operational']").wait_for()
            page.clock.install(time=now)
            page.route(endpoint, lambda route: route.abort())
            page.clock.fast_forward(76001)
            page.locator("#components [data-status='unknown']").wait_for()
            assert "incomplete" in page.locator("#summary-title").inner_text().lower()
    finally:
        server.shutdown()
        server.server_close()
