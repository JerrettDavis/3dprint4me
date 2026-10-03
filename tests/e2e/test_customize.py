"""Customize section against the real dev server (WASM, module workers and the /customize CSP need real HTTP)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Iterator

import pytest
from playwright.sync_api import Browser, Page, expect, sync_playwright

from tests.support.browser_harness import SYSTEM_CHROMIUM_PATH
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import request, running_server

ROOT = Path(__file__).resolve().parents[2]
BUILT_PAGE = ROOT / "public/customize/g/route-shield/index.html"
BUILD_TIMEOUT = 30000
DRAFT_KEY = "3dp-customize:route-shield:v1"


@pytest.fixture(scope="module")
def base_url() -> Iterator[str]:
    if not BUILT_PAGE.is_file():
        pytest.fail("The customizer bundle is not built. Run `npm run customizer:build && npm run assets:version` first.")
    with running_server() as url:
        yield url


@pytest.fixture(scope="module")
def browser() -> Iterator[Browser]:
    with sync_playwright() as p:
        options = {"headless": True, "args": ["--no-sandbox"]}
        if SYSTEM_CHROMIUM_PATH.is_file():
            options["executable_path"] = str(SYSTEM_CHROMIUM_PATH)
        browser = p.chromium.launch(**options)
        yield browser
        browser.close()


@pytest.fixture
def page(browser: Browser) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    yield page
    context.close()


def wait_ready(page: Page) -> None:
    expect(page.locator("body[data-build-state='ready']")).to_be_attached(timeout=BUILD_TIMEOUT)


def test_catalog_lists_route_shield(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/")
    link = page.get_by_role("link", name=re.compile("Route shield"))
    expect(link).to_be_visible()
    expect(page.locator(".nav-links a[aria-current='page']")).to_have_text("Customize")
    link.click()
    expect(page).to_have_url(re.compile(r"/customize/g/route-shield/$"))


def test_route_shield_builds_and_continue_is_enabled(page: Page, base_url: str) -> None:
    # The production bundle wires Continue to the order hand-off, so it is enabled as soon as
    # a model that matches the settings is ready (and disabled while building or invalid).
    page.goto(f"{base_url}/customize/g/route-shield/")
    continue_button = page.get_by_role("button", name="Continue to request")
    page.get_by_label("Upper text", exact=True).fill("ROUTE")
    expect(page.locator("#cz-color-badge")).to_have_text(re.compile(r"^\d+ colors?$"), timeout=BUILD_TIMEOUT)
    wait_ready(page)
    expect(continue_button).to_be_enabled()
    expect(page.locator("#cz-continue-note")).to_be_hidden()
    facts = page.locator("#cz-facts-list")
    expect(facts).to_contain_text("80 × 88")
    expect(facts).to_contain_text("cm³")
    expect(page.get_by_text("Planning figures only; we confirm before printing.")).to_be_visible()
    expect(page.locator("#cz-status")).to_have_attribute("aria-live", "polite")


def test_csp_allows_wasm_and_blocks_remote(page: Page, base_url: str) -> None:
    errors: list[str] = []
    requests: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_role("tab", name="3D").click()
    page.wait_for_timeout(300)
    assert not [e for e in errors if "Content Security Policy" in e], errors
    assert not errors, errors
    foreign = [url for url in requests if not url.startswith(base_url) and not url.startswith(("blob:", "data:"))]
    assert not foreign, foreign
    _, headers, _ = request(f"{base_url}/customize/g/route-shield/")
    csp = {k.lower(): v for k, v in headers.items()}["content-security-policy"]
    assert "'wasm-unsafe-eval'" in csp and "connect-src 'self';" in csp


def test_invalid_value_is_explained_inside_its_own_field(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    width = page.locator("#cz-width_mm")
    width.fill("20")
    field_error = page.locator("[data-field='width_mm'] #cz-width_mm-error")
    expect(field_error).to_have_text("Width must be 50–250 mm.", timeout=5000)
    expect(width).to_have_attribute("aria-invalid", "true")
    expect(width).to_have_attribute("aria-describedby", re.compile(r"\bcz-width_mm-error\b"))
    expect(page.locator("#cz-form-errors")).to_contain_text("One setting needs attention")
    expect(page.locator("body[data-build-state='error']")).to_be_attached()
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    width.press("Tab")  # commit: the value is clamped back into range
    expect(width).to_have_value("50")
    wait_ready(page)
    expect(field_error).to_have_text("")
    expect(width).not_to_have_attribute("aria-invalid", "true")


def test_build_error_is_shown_next_to_the_text_it_concerns(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_label("Upper text", exact=True).fill("WWWWWWWWWWWWWWWWWW")
    page.locator("#cz-top_scale_pct").fill("150")
    page.locator("#cz-top_scale_pct").press("Tab")
    expect(page.locator("[data-field='top_text'] #cz-top_text-error")).to_contain_text("doesn't fit", timeout=BUILD_TIMEOUT)
    expect(page.get_by_label("Upper text", exact=True)).to_have_attribute("aria-invalid", "true")
    expect(page.locator("#cz-status")).to_contain_text("See the note in Settings")


def test_draft_restores_from_session_storage_and_reset_clears_it(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_label("Lower text", exact=True).fill("101")
    stored = ""
    for _ in range(50):  # poll the draft written after the 150 ms debounce (no fixed sleep)
        stored = page.evaluate(f"sessionStorage.getItem({DRAFT_KEY!r}) || ''")
        if '"lower_text":"101"' in stored:
            break
        page.wait_for_timeout(50)
    assert '"lower_text":"101"' in stored, stored
    page.reload()
    expect(page.get_by_label("Lower text", exact=True)).to_have_value("101")
    page.get_by_role("button", name="Reset to defaults").click()
    expect(page.get_by_label("Lower text", exact=True)).to_have_value("66")


def test_preview_tabs_are_keyboard_operable(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    front = page.get_by_role("tab", name="Front")
    front.focus()
    page.keyboard.press("ArrowRight")
    expect(page.get_by_role("tab", name="Back")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("tab", name="Back")).to_be_focused()
    page.keyboard.press("End")
    expect(page.get_by_role("tab", name="3D")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("button", name="Show on print bed")).to_be_visible()


def test_mobile_layout_has_no_horizontal_scroll(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", reduced_motion="reduce")
    page = context.new_page()
    try:
        for route in ["/customize/", "/customize/g/route-shield/"]:
            page.goto(base_url + route)
            if "route-shield" in route:
                wait_ready(page)
            overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert overflow <= 0, (route, overflow)
    finally:
        context.close()


# --- Hand-off to the order page -------------------------------------------------------------

SHOT_DIR = os.environ.get("CZ_SHOT_DIR")  # optional: save review screenshots here


def shot(page: Page, name: str) -> None:
    if SHOT_DIR:
        Path(SHOT_DIR).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOT_DIR) / name), full_page=True)


def build_and_continue(page: Page, origin: str) -> None:
    page.goto(f"{origin}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_label("Upper text", exact=True).fill("HANDOFF")
    # The draft is written in the same step that starts the rebuild, so once it holds the new
    # text the page has left "ready"; waiting for "ready" again then means the new model.
    for _ in range(100):  # poll (the page CSP forbids string evaluation in wait_for_function)
        if "HANDOFF" in page.evaluate(f"sessionStorage.getItem({DRAFT_KEY!r}) || ''"):
            break
        page.wait_for_timeout(50)
    wait_ready(page)
    page.get_by_role("button", name="Continue to request").click()


def test_continue_hands_the_model_to_the_order_page_and_the_operator_sees_provenance(browser: Browser) -> None:
    with running_operator_workspace() as (storefront, operator, store_path):
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            build_and_continue(page, storefront)
            expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize$"))
            notice = page.locator("#customize-notice")
            expect(notice).to_have_text("Loaded from the customizer — review and continue.")
            expect(page.locator("#service-print")).to_be_checked()
            shot(page, "order-handoff-step0.png")
            page.locator("#next-button").click()
            expect(page.locator("#file-list")).to_contain_text(re.compile(r"route-shield.*\.3mf"))
            expect(page.locator("#project-title")).to_have_value("Custom Route shield")
            expect(page.locator("#description")).to_have_value("Custom Route shield — see attached model.")
            shot(page, "order-handoff-details.png")
            # The record is single-use: the database no longer holds it.
            assert page.evaluate("""() => new Promise(resolve => {
              const open = indexedDB.open('3dp-customize', 1);
              open.onsuccess = () => { const db = open.result; const get = db.transaction('handoff').objectStore('handoff').get('pending'); get.onsuccess = () => { db.close(); resolve(get.result ?? null); }; };
            })""") is None
            draft = page.evaluate("localStorage.getItem('3dp-project-draft-v1') || ''")
            assert "HANDOFF" not in draft and "top_text" not in draft, draft

            page.locator("#next-button").click()
            page.locator("#name").fill("Taylor Customer")
            page.locator("#email").fill("taylor@example.com")
            page.locator("#next-button").click()
            page.locator("#terms").check()
            page.locator("#submit-button").click()
            page.locator("#submission-state.visible").wait_for(state="visible", timeout=15000)

            saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
            assert saved["customization"] == {"generatorId": "route-shield", "generatorVersion": 1}, "stored copies keep no parameters"

            state = json.loads(store_path.read_text(encoding="utf-8"))
            stored = [record["request"] for record in state["requests"] if record["request"].get("customization")]
            assert stored, state["requests"]
            customization = stored[0]["customization"]
            assert customization["generatorId"] == "route-shield"
            assert customization["generatorVersion"] == 1
            assert customization["params"]["top_text"] == "HANDOFF"
            assert customization["redacted"] == []

            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").first.click()
            sheet = page.locator(".customization-sheet")
            sheet.wait_for()
            text = sheet.inner_text()
            for expected in ("Customizer", "route-shield", "Top text", "HANDOFF", "The attached 3MF is the model to print; these values are provenance."):
                assert expected in text, expected
            sheet.scroll_into_view_if_needed()
            shot(page, "operator-customization.png")
            assert not errors, errors
        finally:
            context.close()


def test_blocked_indexeddb_downloads_the_model_and_explains(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    context.add_init_script("Object.defineProperty(window, 'indexedDB', { configurable: true, get() { return undefined; } });")
    page = context.new_page()
    try:
        page.goto(f"{base_url}/customize/g/route-shield/")
        wait_ready(page)
        with page.expect_download() as download_info:
            page.get_by_role("button", name="Continue to request").click()
        download = download_info.value
        assert download.suggested_filename.endswith(".3mf"), download.suggested_filename
        assert Path(download.path()).read_bytes()[:2] == b"PK", "a real 3MF (zip) was downloaded"
        expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize&handoff=download$"))
        expect(page.locator("#customize-notice")).to_have_text("Your browser blocked the direct hand-off; attach the file you just downloaded.")
        expect(page.locator("#service-print")).to_be_checked()
        shot(page, "order-handoff-blocked.png")
    finally:
        context.close()


def test_stale_or_missing_hand_off_leaves_the_order_page_usable(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/order.html?service=print")
    expect(page.locator("#customize-notice")).to_be_hidden()
    page.evaluate("""() => new Promise((resolve, reject) => {
      const open = indexedDB.open('3dp-customize', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handoff');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('handoff', 'readwrite');
        tx.objectStore('handoff').put({ file: new Blob(['PK']), filename: 'old.3mf', generatorId: 'route-shield', generatorVersion: 1, params: {}, createdAt: Date.now() - 31 * 60 * 1000 }, 'pending');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    })""")
    page.goto(f"{base_url}/order.html?service=print&from=customize")
    expect(page.locator("#customize-notice")).to_contain_text("didn't arrive")
    page.locator("#next-button").click()
    expect(page.locator("#file-list")).not_to_contain_text("old.3mf")
    expect(page.locator("#project-title")).to_have_value("")
