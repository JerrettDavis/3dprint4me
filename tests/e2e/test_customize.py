"""Customize section against the real dev server (WASM, module workers and the /customize CSP need real HTTP)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
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
DRAFT_KEY = "3dp-customize:route-shield:v3"
# Generators past version 1 (their draft key and recorded provenance carry it).
GENERATOR_VERSIONS = {"route-shield": 3, "wifi-tag": 2, "rating-card": 2, "name-plate": 2}


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


def wait_settled(page: Page) -> None:
    """Every edit has been reported (no debounce/settle timer pending: the form drops
    data-settling) and the model for it is ready. A timer that fires starts its build in the same
    task, so once the attribute is gone the page is already building or done."""
    expect(page.locator("#cz-form:not([data-settling])")).to_be_attached(timeout=BUILD_TIMEOUT)
    wait_ready(page)


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


def test_download_is_gated_by_a_thank_you_dialog_and_email_is_optional(page: Page, base_url: str) -> None:
    events: list[dict] = []

    def capture(route) -> None:
        events.append(route.request.post_data_json)
        route.fulfill(status=200, content_type="application/json", body='{"ok":true}')

    page.route("**/api/inquiry?kind=customize-download", capture)
    page.goto(f"{base_url}/customize/g/route-shield/")
    download = page.get_by_role("button", name="Download my model")
    expect(download).to_be_disabled()
    wait_ready(page)
    expect(download).to_be_enabled()
    download.click()
    dialog = page.get_by_role("dialog", name="Thanks for using 3dprint4.me")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role("button", name="Yes, I'd like a print")).to_be_visible()
    # Closing the dialog downloads nothing and tracks nothing.
    page.keyboard.press("Escape")
    expect(dialog).to_be_hidden()
    assert events == []
    # A bad email blocks the choice with a message; clearing it lets the customer skip.
    download.click()
    dialog.get_by_label("Email (optional)").fill("not-an-email")
    dialog.get_by_role("button", name="No, just give me my file").click()
    expect(dialog.get_by_role("alert")).to_be_visible()
    dialog.get_by_label("Email (optional)").fill("")
    with page.expect_download() as info:
        dialog.get_by_role("button", name="No, just give me my file").click()
    assert info.value.suggested_filename.endswith(".3mf")
    expect(dialog).to_be_hidden()
    page.wait_for_timeout(200)
    assert events == [{"generatorId": "route-shield", "action": "download"}]


def test_csp_allows_wasm_and_blocks_remote(page: Page, base_url: str) -> None:
    errors: list[str] = []
    requests: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("request", lambda r: requests.append(r.url))
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_role("tab", name="3D").click()
    # The 3D view is drawn synchronously when its tab is selected: wait for that state.
    expect(page.get_by_role("tab", name="3D")).to_have_attribute("aria-selected", "true")
    expect(page.locator("#cz-stage canvas")).to_be_attached()
    expect(page.get_by_role("button", name="Show on print bed")).to_be_visible()
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
            assert saved["customization"] == {"generatorId": "route-shield", "generatorVersion": 3}, "stored copies keep no parameters"

            state = json.loads(store_path.read_text(encoding="utf-8"))
            stored = [record["request"] for record in state["requests"] if record["request"].get("customization")]
            assert stored, state["requests"]
            customization = stored[0]["customization"]
            assert customization["generatorId"] == "route-shield"
            assert customization["generatorVersion"] == 3
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


# --- Wi-Fi tag ---------------------------------------------------------------------------------

WIFI_DRAFT_KEY = "3dp-customize:wifi-tag:v2"
WIFI_SECRET = "correct-horse-battery"


def open_wifi(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/wifi-tag/")
    # No password yet: the page explains what is missing instead of building.
    expect(page.locator("[data-field='password'] #cz-password-error")).to_have_text("Enter the network password, or choose 'No password'.", timeout=BUILD_TIMEOUT)


def test_catalog_lists_wifi_tag(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/")
    link = page.get_by_role("link", name=re.compile("Wi-Fi tag"))
    expect(link).to_be_visible()
    link.click()
    expect(page).to_have_url(re.compile(r"/customize/g/wifi-tag/$"))


def test_wifi_password_is_masked_explained_and_never_drafted(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    password = page.get_by_label("Network password", exact=True)
    # Masked by CSS, not type=password: browsers neither offer to save it as this site's login
    # nor autofill a saved one into it (see test_wifi_password_field_is_invisible_to_password_managers).
    expect(password).to_have_attribute("type", "text")
    assert password.evaluate("el => getComputedStyle(el).webkitTextSecurity") == "disc"
    expect(page.locator("#cz-password-note")).to_be_visible()
    expect(page.get_by_text("The password is encoded in the QR code inside your model file. The file is stored privately like any upload and seen by us when we print it. It is not copied into our request records, emails or your saved draft.")).to_be_visible()
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    page.get_by_label("Network name (SSID)", exact=True).fill("Cafe Guest")
    password.fill(WIFI_SECRET)
    wait_ready(page)
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
    expect(page.locator("#cz-color-badge")).to_have_text("2 colors")
    stored = ""
    for _ in range(50):
        stored = page.evaluate(f"sessionStorage.getItem({WIFI_DRAFT_KEY!r}) || ''")
        if "Cafe Guest" in stored:
            break
        page.wait_for_timeout(50)
    assert "Cafe Guest" in stored, stored
    assert WIFI_SECRET not in stored and "password" not in stored, stored
    page.reload()
    expect(page.get_by_label("Network name (SSID)", exact=True)).to_have_value("Cafe Guest")
    expect(page.get_by_label("Network password", exact=True)).to_have_value("")


def test_wifi_password_field_is_invisible_to_password_managers(page: Page, base_url: str) -> None:
    # A type=password box next to a text field reads as a login form: browsers offer to save the
    # Wi-Fi password as this site's password and autofill a saved site login into the form. The
    # page must have no password box and nothing named like a credential; the secret field opts
    # out of autofill and password managers, and only Continue ever navigates.
    open_wifi(page, base_url)
    navigations: list[str] = []
    page.on("framenavigated", lambda frame: navigations.append(frame.url) if frame == page.main_frame else None)
    assert page.locator("input[type='password']").count() == 0
    assert page.locator("[name*='pass' i], [autocomplete~='current-password'], [autocomplete~='username']").count() == 0
    expect(page.locator("#cz-form")).to_have_attribute("autocomplete", "off")
    secret = page.locator("#cz-password")
    for name, value in {"type": "text", "autocomplete": "off", "data-lpignore": "true", "data-1p-ignore": "", "data-form-type": "other",
                        "spellcheck": "false", "autocapitalize": "off", "autocorrect": "off"}.items():
        expect(secret).to_have_attribute(name, value)
    assert secret.get_attribute("name") is None
    assert secret.evaluate("el => getComputedStyle(el).webkitTextSecurity") == "disc", "the value is masked on screen"
    page.get_by_label("Network name (SSID)", exact=True).fill("Cafe Guest")
    secret.fill(WIFI_SECRET)
    secret.press("Enter")  # implicit form submission must do nothing
    wait_settled(page)
    expect(page).to_have_url(re.compile(r"/customize/g/wifi-tag/$"))
    assert secret.evaluate("el => el.value") == WIFI_SECRET
    assert WIFI_SECRET not in page.content(), "the secret is never written into the markup"
    assert navigations == [], navigations
    page.get_by_role("button", name="Continue to request").click()
    expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize$"))
    expect(page.locator("#customize-notice")).to_have_text("Loaded from the customizer — review and continue.")
    assert len(navigations) == 1 and re.search(r"/order\.html\?service=print&from=customize$", navigations[0]), navigations


def test_wifi_keychain_builds_and_a_too_dense_code_is_explained_at_the_network_name(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    page.get_by_label("Tag format").select_option("keychain")
    page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
    wait_ready(page)
    expect(page.locator("#cz-facts-list")).to_contain_text("45 × 69")
    page.get_by_label("Network name (SSID)", exact=True).fill(";" * 32)
    page.get_by_label("Network password", exact=True).fill(";" * 63)
    # Dense but printable: the build succeeds and warns that scanning may be unreliable.
    expect(page.locator("#cz-warnings")).to_contain_text("0.4 mm nozzle", timeout=BUILD_TIMEOUT)
    # Shrinking it further crosses the printability floor: the error sits next to the QR size.
    page.locator("#cz-qr_scale_pct").fill("25")
    page.locator("#cz-qr_scale_pct").press("Tab")
    error = page.locator("[data-field='qr_scale_pct'] #cz-qr_scale_pct-error")
    expect(error).to_contain_text("QR code size", timeout=BUILD_TIMEOUT)
    expect(page.locator("#cz-qr_scale_pct")).to_have_attribute("aria-invalid", "true")
    page.locator("#cz-qr_scale_pct").fill("100")
    page.locator("#cz-qr_scale_pct").press("Tab")
    page.get_by_label("Tag format").select_option("placard")
    wait_ready(page)
    expect(error).to_have_text("")


def test_wifi_low_contrast_colors_are_rejected_next_to_both_fields(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
    wait_ready(page)
    page.locator("#cz-qr_color").evaluate("(el) => { el.value = '#eeeeee'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }")
    for key in ("base_color", "qr_color"):
        expect(page.locator(f"#cz-{key}-error")).to_contain_text("too similar", timeout=5000)
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()


def test_wifi_mobile_layout_has_no_horizontal_scroll(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", reduced_motion="reduce")
    page = context.new_page()
    try:
        open_wifi(page, base_url)
        page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
        wait_ready(page)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 0, overflow
    finally:
        context.close()


def test_wifi_hand_off_stores_the_model_but_never_the_password(browser: Browser) -> None:
    with running_operator_workspace() as (storefront, operator, store_path):
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            open_wifi(page, storefront)
            page.get_by_label("Network name (SSID)", exact=True).fill("Cafe Guest")
            page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
            wait_ready(page)
            page.get_by_role("button", name="Continue to request").click()
            expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize$"))
            page.locator("#next-button").click()
            expect(page.locator("#file-list")).to_contain_text("wifi-tag-placard.3mf")
            page.locator("#next-button").click()
            page.locator("#name").fill("Taylor Customer")
            page.locator("#email").fill("taylor@example.com")
            page.locator("#next-button").click()
            page.locator("#terms").check()
            page.locator("#submit-button").click()
            page.locator("#submission-state.visible").wait_for(state="visible", timeout=15000)

            raw_store = store_path.read_text(encoding="utf-8")
            assert WIFI_SECRET not in raw_store
            state = json.loads(raw_store)
            stored = [r["request"] for r in state["requests"] if r["request"].get("customization")]
            assert stored, state["requests"]
            customization = stored[0]["customization"]
            assert customization["generatorId"] == "wifi-tag"
            assert customization["params"]["ssid"] == "Cafe Guest"
            assert customization["params"]["password"] == "[redacted]"
            assert customization["redacted"] == ["password"]
            for storage in ("localStorage", "sessionStorage"):
                dump = page.evaluate(f"JSON.stringify(Object.entries({storage}))")
                assert WIFI_SECRET not in dump, storage

            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").first.click()
            sheet = page.locator(".customization-sheet")
            sheet.wait_for()
            text = sheet.inner_text()
            assert "wifi-tag" in text and "Cafe Guest" in text and WIFI_SECRET not in text, text
            assert not errors, errors
        finally:
            context.close()


def test_wifi_loop_checkbox_follows_format_and_text_comes_back_after_keychain(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    loop = page.get_by_label("Key-ring loop", exact=True)
    show_text = page.get_by_label(re.compile("^Show title and network name"))
    expect(loop).to_be_hidden()
    expect(show_text).to_be_checked()
    page.get_by_label("Tag format").select_option("keychain")
    expect(loop).to_be_visible()
    expect(loop).to_be_checked()
    expect(show_text).not_to_be_checked()
    page.get_by_label("Tag format").select_option("card")
    expect(loop).to_be_hidden()
    expect(show_text).to_be_checked()
    # A sensitive field's note says plainly where the value goes.
    note = page.locator("#cz-password-note")
    expect(note).to_contain_text("model file")
    expect(note).to_contain_text("stored privately")


def test_wifi_label_too_small_to_read_is_an_error_at_the_network_name(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    page.get_by_label("Tag format").select_option("card")
    page.get_by_label("Title", exact=True).fill("")
    page.get_by_label("Network name (SSID)", exact=True).fill("S" * 32)
    page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
    error = page.locator("[data-field='ssid'] #cz-ssid-error")
    expect(error).to_have_text("The network name is too long to print legibly at this tag size. Shorten it, turn the label off, or choose a larger format.", timeout=BUILD_TIMEOUT)
    page.get_by_label("Tag format").select_option("placard")
    wait_ready(page)
    expect(error).to_have_text("")


# --- Rating card ------------------------------------------------------------------------------

RATING_DRAFT_KEY = "3dp-customize:rating-card:v2"


def paw_png() -> bytes:
    """A bold test image generated in memory (a paw print on white)."""
    import io
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (600, 520), "white")
    draw = ImageDraw.Draw(img)
    draw.ellipse((170, 230, 430, 470), fill="black")
    for cx, cy in [(130, 190), (230, 110), (370, 110), (470, 190)]:
        draw.ellipse((cx - 55, cy - 70, cx + 55, cy + 70), fill="black")
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def test_catalog_lists_rating_card_and_the_default_card_builds(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/")
    page.get_by_role("link", name="Rating card").click()
    expect(page).to_have_url(re.compile(r"/customize/g/rating-card/$"))
    wait_ready(page)
    expect(page.locator("#cz-facts-list")).to_contain_text("85.6 × 54 × 1.6 mm")
    expect(page.locator("#cz-color-badge")).to_have_text("5 colors")
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
    # Image controls appear only for a custom icon; the stars slider moves in half steps.
    expect(page.locator("#cz-image-area")).to_be_hidden()
    expect(page.locator("[data-field='image_threshold']")).to_be_hidden()
    expect(page.locator("#cz-rating-range")).to_have_attribute("step", "0.5")


def test_rating_card_traces_a_local_image_and_never_stores_it(page: Page, base_url: str) -> None:
    requests: list[str] = []
    errors: list[str] = []
    page.on("request", lambda r: requests.append(r.url))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{base_url}/customize/g/rating-card/")
    wait_ready(page)
    page.get_by_label("Icon", exact=True).select_option("custom")
    expect(page.locator("#cz-image-area")).to_be_visible()
    expect(page.get_by_text("Your image stays in your browser. Only the traced outline goes into the model.")).to_be_visible()
    expect(page.locator("[data-field='icon'] #cz-icon-error")).to_have_text("Choose an image below, or pick a built-in icon.", timeout=BUILD_TIMEOUT)
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    # A file that isn't an image is refused with a readable message.
    page.locator("#cz-image-file").set_input_files({"name": "notes.txt", "mimeType": "text/plain", "buffer": b"hello"})
    expect(page.locator("#cz-icon-error")).to_contain_text("isn't a PNG, JPEG, WebP or GIF image")
    # A small file declaring a 30000 × 30000 image is refused from its header, before decoding.
    import struct
    bomb = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 30000, 30000) + bytes([8, 6, 0, 0, 0]) + bytes(4) + bytes(1000)
    page.locator("#cz-image-file").set_input_files({"name": "bomb.png", "mimeType": "image/png", "buffer": bomb})
    expect(page.locator("#cz-icon-error")).to_contain_text("too large")
    # The input is cleared after each pick, so the same file can be picked again.
    expect(page.locator("#cz-image-file")).to_have_value("")
    before = len(requests)
    page.locator("#cz-image-file").set_input_files({"name": "secret-paw.png", "mimeType": "image/png", "buffer": paw_png()})
    expect(page.locator("#cz-image-preview")).to_be_visible(timeout=BUILD_TIMEOUT)
    wait_ready(page)
    expect(page.locator("#cz-icon-error")).to_have_text("")
    expect(page.locator("#cz-image-status")).to_contain_text("Traced from your 600 × 520 pixel image")
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
    # Tracing and building stay on this page: no network request carries the image.
    assert not [u for u in requests[before:] if not u.startswith(("blob:", "data:"))], requests[before:]
    draft = page.evaluate(f"sessionStorage.getItem({RATING_DRAFT_KEY!r}) || ''")
    assert '"icon":"custom"' in draft and "paw" not in draft and "[[" not in draft, draft
    assert "secret-paw" not in page.url
    # The threshold re-traces the same image: a threshold of 0 leaves nothing dark to trace.
    page.locator("#cz-image_threshold").fill("0")
    page.locator("#cz-image_threshold").press("Tab")
    expect(page.locator("#cz-icon-error")).to_contain_text("nothing to trace")
    page.locator("#cz-image_threshold").fill("128")
    page.locator("#cz-image_threshold").press("Tab")
    wait_ready(page)
    assert not errors, errors


def test_rating_card_mobile_layout_has_no_horizontal_scroll(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", reduced_motion="reduce")
    page = context.new_page()
    try:
        page.goto(f"{base_url}/customize/g/rating-card/")
        wait_ready(page)
        page.get_by_label("Icon", exact=True).select_option("custom")
        page.locator("#cz-image-file").set_input_files({"name": "paw.png", "mimeType": "image/png", "buffer": paw_png()})
        wait_ready(page)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 0, overflow
    finally:
        context.close()


# --- Name plate -------------------------------------------------------------------------------

NAME_DRAFT_KEY = "3dp-customize:name-plate:v2"
FONT_FILES = ["Pacifico-Regular.ttf", "Lobster-Regular.ttf", "BebasNeue-Regular.ttf", "Righteous-Regular.ttf", "CaveatBrush-Regular.ttf", "RubikMonoOne-Regular.ttf", "Bangers-Regular.ttf", "TitanOne-Regular.ttf"]


def open_name_plate(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/name-plate/")
    wait_ready(page)


def test_catalog_lists_name_plate_and_the_default_plate_builds(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/")
    page.get_by_role("link", name="Name plate").click()
    expect(page).to_have_url(re.compile(r"/customize/g/name-plate/$"))
    wait_ready(page)
    expect(page.locator("#cz-color-badge")).to_have_text("2 colors")
    expect(page.locator("#cz-facts-list")).to_contain_text("× 3 mm")
    expect(page.locator("#cz-font-toggle")).to_have_text("Block (built-in)")
    # Color controls follow the style and plate.
    expect(page.locator("[data-field='outline_color']")).to_be_hidden()
    page.get_by_label("Style", exact=True).select_option("outline")
    expect(page.locator("[data-field='outline_color']")).to_be_visible()
    wait_ready(page)
    expect(page.locator("#cz-color-badge")).to_have_text("3 colors")
    page.get_by_label("Plate", exact=True).select_option("none")
    expect(page.locator("[data-field='plate_color']")).to_be_hidden()


def test_fonts_are_served_same_origin_with_type_and_cache_headers(base_url: str) -> None:
    for name in FONT_FILES:
        status, headers, body = request(f"{base_url}/customize/fonts/{name}")
        assert status == 200, name
        assert headers.get("Content-Type") == "font/ttf", headers
        assert headers.get("Cache-Control", "").startswith("public, max-age="), headers
        assert body[:4] == b"\x00\x01\x00\x00", name
    status, headers, body = request(f"{base_url}/customize/fonts/fonts.css")
    assert status == 200 and headers.get("Content-Type", "").startswith("text/css")
    assert b"http" not in body
    status, _, body = request(f"{base_url}/customize/fonts/LICENSES.md")
    assert status == 200 and b"SIL Open Font License, Version 1.1" in body


def test_font_picker_is_keyboard_operable_and_fetches_fonts_same_origin(page: Page, base_url: str) -> None:
    requests: list[str] = []
    page.on("request", lambda r: requests.append(r.url))
    open_name_plate(page, base_url)
    toggle = page.locator("#cz-font-toggle")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(page.locator("#cz-font-list")).to_be_hidden()
    toggle.focus()
    page.keyboard.press("Enter")
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(page.get_by_role("radio", name="Block (built-in)")).to_be_focused()
    # Arrow keys move the choice (each is a build); the list stays open until Enter or Escape.
    page.keyboard.press("ArrowDown")
    expect(page.get_by_role("radio", name=FONT_CHOICES[1], exact=True)).to_be_checked()
    expect(page.locator("#cz-font-list")).to_be_visible()
    page.keyboard.press("Enter")
    expect(page.locator("#cz-font-list")).to_be_hidden()
    expect(toggle).to_be_focused()
    expect(toggle).to_have_text(FONT_CHOICES[1])
    wait_ready(page)
    # Each option is drawn in its own font, from this site.
    toggle.click()
    page.locator("label[for='cz-font-lobster']").scroll_into_view_if_needed()  # faces load as options scroll into view
    page.wait_for_function("() => getComputedStyle(document.querySelector(\"label[for='cz-font-lobster']\")).fontFamily.includes('cz-lobster')")
    family = page.locator("label[for='cz-font-lobster']").evaluate("el => getComputedStyle(el).fontFamily")
    assert "cz-lobster" in family, family
    page.wait_for_function("() => document.fonts.check('16px \"cz-lobster\"')")
    page.locator("label[for='cz-font-bebas-neue']").click()
    expect(page.locator("#cz-font-list")).to_be_hidden()
    expect(toggle).to_have_text("Bebas Neue")
    wait_ready(page)
    # Escape closes an open list and returns focus to the toggle.
    toggle.click()
    expect(page.locator("#cz-font-list")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#cz-font-list")).to_be_hidden()
    expect(toggle).to_be_focused()
    font_requests = [u for u in requests if "/fonts/" in u]
    assert font_requests and all(u.startswith(base_url + "/customize/fonts/") for u in font_requests), font_requests
    assert not [u for u in requests if not u.startswith((base_url, "blob:", "data:"))], requests
    draft = page.evaluate(f"sessionStorage.getItem({NAME_DRAFT_KEY!r}) || ''")
    assert '"font":"bebas-neue"' in draft, draft


ACK_REQUIRED = "Confirm that you may use this font for a printed item."


def test_own_font_file_is_parsed_locally_and_never_uploaded(page: Page, base_url: str) -> None:
    requests: list[tuple[str, str]] = []
    page.on("request", lambda r: requests.append((r.method, r.url)))
    open_name_plate(page, base_url)
    page.locator("#cz-font-toggle").click()
    page.locator("label[for='cz-font-custom']").click()
    expect(page.locator("#cz-font-area")).to_be_visible()
    # A font we have not vetted needs the license confirmation first: nothing can be picked until then.
    expect(page.locator("#cz-font_license_ack-error")).to_have_text(ACK_REQUIRED, timeout=BUILD_TIMEOUT)
    expect(page.locator("#cz-font-file")).to_be_disabled()
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    page.get_by_label("I have the right to use this font to make a printed item.").check()
    expect(page.locator("#cz-font-file")).to_be_enabled()
    expect(page.locator("#cz-font-error")).to_have_text("Choose a font file below, or pick one of the listed fonts.", timeout=BUILD_TIMEOUT)
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    # Not a font: a readable error next to the font control.
    page.locator("#cz-font-file").set_input_files({"name": "notes.ttf", "mimeType": "font/ttf", "buffer": b"not a font at all"})
    expect(page.locator("#cz-font-error")).to_contain_text("couldn't be read", timeout=BUILD_TIMEOUT)
    before = len(requests)
    font_bytes = (ROOT / "customizer/static/fonts/Righteous-Regular.ttf").read_bytes()
    page.locator("#cz-font-file").set_input_files({"name": "secret-house-font.ttf", "mimeType": "font/ttf", "buffer": font_bytes})
    wait_ready(page)
    expect(page.locator("#cz-font-error")).to_have_text("")
    expect(page.locator("#cz-font-status")).to_contain_text("secret-house-font.ttf")
    assert not [r for r in requests[before:] if r[0] != "GET" or not r[1].startswith((base_url, "blob:", "data:"))], requests[before:]
    # Unchecking the box withdraws the font again.
    page.get_by_label("I have the right to use this font to make a printed item.").uncheck()
    expect(page.locator("#cz-font_license_ack-error")).to_have_text(ACK_REQUIRED)
    expect(page.locator("#cz-font-file")).to_be_disabled()
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    page.get_by_label("I have the right to use this font to make a printed item.").check()
    wait_ready(page)
    # Neither the font nor the confirmation is kept: a draft returns to the default font.
    draft = page.evaluate(f"sessionStorage.getItem({NAME_DRAFT_KEY!r}) || ''")
    assert '"font":"block"' in draft and "secret-house" not in draft and "font_license_ack" not in draft, draft


def test_name_plate_rules_coerce_inlay_and_report_disconnected_letters(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    page.get_by_label("Style", exact=True).select_option("inlay")
    wait_ready(page)
    page.get_by_label("Plate", exact=True).select_option("none")
    expect(page.get_by_label("Style", exact=True)).to_have_value("raised")
    wait_ready(page)
    # A word gap is bridged in the backing: an ordinary two-word name builds with no plate.
    page.get_by_label("Name", exact=True).fill("Mary Ann")
    page.get_by_label("Name", exact=True).press("Tab")
    wait_ready(page)
    # An apostrophe over a full stop never reaches the centre line: the build says so.
    page.get_by_label("Name", exact=True).fill("'.")
    page.get_by_label("Name", exact=True).press("Tab")
    expect(page.locator("#cz-plate-error")).to_have_text("The letters aren't connected — choose a plate.", timeout=BUILD_TIMEOUT)
    page.get_by_label("Plate", exact=True).select_option("rect")
    wait_ready(page)
    expect(page.locator("#cz-plate-error")).to_have_text("")
    # Missing glyphs are skipped with a warning, never a crash.
    page.get_by_label("Name", exact=True).fill("Zoë 🚽")
    page.get_by_label("Name", exact=True).press("Tab")
    expect(page.locator("#cz-warnings")).to_contain_text("Some characters aren't in this font and were skipped.", timeout=BUILD_TIMEOUT)


def test_name_plate_mobile_picker_has_no_horizontal_scroll(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", reduced_motion="reduce")
    page = context.new_page()
    try:
        open_name_plate(page, base_url)
        page.locator("#cz-font-toggle").click()
        expect(page.locator("#cz-font-list")).to_be_visible()
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 0, overflow
        box = page.locator("label[for='cz-font-titan-one']").bounding_box()
        assert box and box["height"] >= 44, box
    finally:
        context.close()


def test_a_font_that_fails_to_download_offers_try_again(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    failing = {"on": True}

    def handle(route) -> None:
        if failing["on"]:
            route.abort()
        else:
            route.continue_()
    page.context.route("**/customize/fonts/Righteous-Regular.ttf", handle)
    page.locator("#cz-font-toggle").click()
    page.locator("label[for='cz-font-righteous']").click()
    expect(page.locator("#cz-retry")).to_be_visible(timeout=BUILD_TIMEOUT)
    # A font that didn't download is the connection, not the settings: the status says so and
    # the Settings panel shows no error.
    expect(page.locator("#cz-status")).to_have_text("We couldn't load the model builder. Check your connection and try again.")
    expect(page.locator("#cz-form-errors")).to_have_text("")
    expect(page.locator("#cz-font-error")).to_have_text("")
    failing["on"] = False
    page.locator("#cz-retry").click()
    wait_ready(page)
    expect(page.locator("#cz-form-errors")).to_have_text("")


def test_a_model_builder_that_fails_to_load_is_not_blamed_on_the_settings(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    blocked = {"on": True, "hits": 0}

    def handle(route) -> None:
        if blocked["on"]:
            blocked["hits"] += 1
            route.abort()
        else:
            route.continue_()
    # Registered before the page loads so the worker's first WASM fetch is the one refused.
    context.route("**/*.wasm", handle)
    page = context.new_page()
    try:
        page.goto(f"{base_url}/customize/g/route-shield/")
        status = page.locator("#cz-status")
        expect(status).to_have_text("We couldn't load the model builder. Check your connection and try again.", timeout=BUILD_TIMEOUT)
        assert blocked["hits"] >= 1, "the WASM request was really intercepted"
        expect(page.locator("#cz-retry")).to_be_visible()
        expect(page.locator("#cz-form-errors")).to_have_text("")
        assert "settings" not in status.inner_text().lower()
        expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
        blocked["on"] = False
        page.locator("#cz-retry").click()
        wait_ready(page)
        expect(page.locator("#cz-retry")).to_be_hidden()
        expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
    finally:
        context.close()


def test_customize_without_a_trailing_slash_redirects(base_url: str) -> None:
    from http.client import HTTPConnection
    from urllib.parse import urlparse
    parsed = urlparse(base_url)
    connection = HTTPConnection(parsed.hostname, parsed.port, timeout=5)
    try:
        connection.request("GET", "/customize")
        response = connection.getresponse()
        response.read()
        assert response.status == 308, response.status
        assert response.getheader("Location") == "/customize/"
    finally:
        connection.close()
    status, _, body = request(f"{base_url}/customize/")
    assert status == 200 and b"<title>" in body


def test_a_stale_customizer_design_is_explained_next_to_the_attached_model(page: Page, base_url: str) -> None:
    # A hand-off whose parameters no longer validate (the generator changed since) is refused by
    # the server; the order page says why and how to recover next to that model's Remove button.
    page.goto(f"{base_url}/order.html?service=print")
    page.evaluate("""() => new Promise((resolve, reject) => {
      const open = indexedDB.open('3dp-customize', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handoff');
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('handoff', 'readwrite');
        tx.objectStore('handoff').put({ file: new Blob(['PK']), filename: 'route-shield-old.3mf', generatorId: 'route-shield', generatorVersion: 1, generatorTitle: 'Route shield', params: { width_mm: 9999 }, createdAt: Date.now() }, 'pending');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    })""")
    page.goto(f"{base_url}/order.html?service=print&from=customize")
    expect(page.locator("#customize-notice")).to_have_text("Loaded from the customizer — review and continue.")
    page.locator("#next-button").click()
    expect(page.locator("#file-list")).to_contain_text("route-shield-old.3mf")
    page.locator("#next-button").click()
    page.locator("#name").fill("Taylor Customer")
    page.locator("#email").fill("taylor@example.com")
    page.locator("#next-button").click()
    page.locator("#terms").check()
    page.locator("#submit-button").click()
    row = page.locator("#file-list .file-item", has_text="route-shield-old.3mf")
    problem = row.locator(".file-item-error")
    expect(problem).to_contain_text("This design was made with an older version of the generator. Remove the attached model and open the customizer again.", timeout=15000)
    expect(problem).to_be_visible()
    assert "9999" not in problem.inner_text()
    shot(page, "order-stale-design.png")
    row.get_by_role("button", name="Remove route-shield-old.3mf").click()
    expect(page.locator("#file-list .file-item-error")).to_have_count(0)


def test_arrowing_through_the_font_picker_builds_once(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    # Count every transition into "building" from here on.
    page.evaluate("""() => {
        window.__builds = 0;
        new MutationObserver(() => { if (document.body.dataset.buildState === 'building') window.__builds++; })
            .observe(document.body, { attributes: true, attributeFilter: ['data-build-state'] });
    }""")
    page.locator("#cz-font-toggle").focus()
    page.keyboard.press("Enter")
    for _ in range(5):
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(80)
    expect(page.get_by_role("radio", name=FONT_CHOICES[5], exact=True)).to_be_checked()
    page.keyboard.press("Enter")
    expect(page.locator("#cz-font-toggle")).to_have_text(FONT_CHOICES[5])
    wait_settled(page)
    assert page.evaluate("window.__builds") == 1, page.evaluate("window.__builds")
    # Arrowing and pausing (no Enter) commits the settled choice once, too.
    page.keyboard.press("Enter")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    expect(page.locator("#cz-font-toggle")).to_have_text(FONT_CHOICES[7], timeout=BUILD_TIMEOUT)
    wait_settled(page)
    assert page.evaluate("window.__builds") == 2, page.evaluate("window.__builds")


def test_name_plate_page_links_the_font_licenses(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    link = page.get_by_role("link", name="Font licenses")
    expect(link).to_have_attribute("href", "/customize/fonts/LICENSES.md")
    status, _, _ = request(f"{base_url}/customize/fonts/LICENSES.md")
    assert status == 200


def test_picking_a_font_then_typing_a_name_keeps_both(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    page.locator("#cz-font-toggle").click()
    page.locator("label[for='cz-font-pacifico']").click()
    # No pause: a late font commit must not overwrite what is being typed.
    page.get_by_label("Name", exact=True).fill("Mary Ann")
    page.get_by_label("Name", exact=True).press("Tab")
    wait_settled(page)
    expect(page.get_by_label("Name", exact=True)).to_have_value("Mary Ann")
    expect(page.locator("#cz-font-toggle")).to_have_text("Pacifico")
    draft = page.evaluate(f"sessionStorage.getItem({NAME_DRAFT_KEY!r}) || ''")
    assert '"name":"Mary Ann"' in draft and '"font":"pacifico"' in draft, draft


# --- Full matrix: every generator, end to end -------------------------------------------------
# One shared storefront + operator workspace for the matrix (the operator store accumulates, so
# each test finds its own request by a value unique to that run).

GENERATOR_IDS = sorted(p.name for p in (ROOT / "customizer/g").iterdir() if (p / "index.html").is_file())
# Generators that print text and so have the shared font control (the pumpkin has none).
TEXT_GENERATOR_IDS = [g for g in GENERATOR_IDS if "fontSchema" in (ROOT / f"public/assets/js/customize/generators/{g}.js").read_text(encoding="utf-8")]
DEV_LOG = ROOT / "data/dev-requests.ndjson"
CSP_PROBE = """
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
"""


def test_the_matrix_covers_every_registered_generator() -> None:
    registry = (ROOT / "public/assets/js/customize/registry.js").read_text(encoding="utf-8")
    registered = sorted(re.findall(r'import \w+ from "\./generators/([a-z0-9-]+)\.js', registry))
    assert registered and registered == GENERATOR_IDS, (registered, GENERATOR_IDS)


@pytest.fixture(scope="module")
def workspace() -> Iterator[tuple[str, str, Path]]:
    if not BUILT_PAGE.is_file():
        pytest.fail("The customizer bundle is not built. Run `npm run customizer:build && npm run assets:version` first.")
    with running_operator_workspace() as running:
        yield running


def edit_and_wait(page: Page, origin: str, generator_id: str, token: str) -> dict[str, str]:
    """Opens a generator page, makes it buildable, changes one field to a value unique to this run
    and waits until the model for that value is ready. Returns the values typed (for the Wi-Fi tag
    including the password, which the server must never hold)."""
    page.goto(f"{origin}/customize/g/{generator_id}/")
    expect(page.locator("body[data-build-state]")).to_be_attached(timeout=BUILD_TIMEOUT)
    values: dict[str, str] = {}
    if generator_id == "route-shield":
        key, label, value = "top_text", "Upper text", f"R{token[:6].upper()}"
    elif generator_id == "wifi-tag":
        values["password"] = f"pw-{uuid.uuid4().hex}"
        page.get_by_label("Network password", exact=True).fill(values["password"])
        key, label, value = "ssid", "Network name (SSID)", f"Net {token[:8]}"
    elif generator_id == "rating-card":
        key, label, value = "caption", "Caption", f"GREAT {token[:6].upper()}"
    elif generator_id == "name-plate":
        key, label, value = "name", "Name", f"Robin {token[:4].upper()}"
    elif generator_id == "pumpkin":
        # No text to type: the width is a whole number of millimetres, unique per run inside the store.
        key, label, value = "diameter_mm", None, str(60 + int(token[:4], 16) % 100)
    else:  # a new generator needs a flow here (see test_the_matrix_covers_every_registered_generator)
        pytest.fail(f"No matrix flow for generator {generator_id}")
    if label is None:
        box = page.locator(f"[name='{key}']")
        box.fill(value)
        box.press("Tab")
        values[key] = int(value)
    else:
        page.get_by_label(label, exact=True).fill(value)
        values[key] = value
    draft_key = f"3dp-customize:{generator_id}:v{GENERATOR_VERSIONS.get(generator_id, 1)}"
    needle = json.dumps(value)[1:-1]
    for _ in range(100):  # the draft is written in the same step that starts the rebuild
        if needle in page.evaluate(f"sessionStorage.getItem({draft_key!r}) || ''"):
            break
        page.wait_for_timeout(50)
    else:
        pytest.fail(f"{generator_id}: the edit never reached the draft")
    wait_ready(page)
    return values


def new_matrix_page(browser: Browser, **context_options) -> Page:
    options = {"viewport": {"width": 1280, "height": 900}, **context_options}
    context = browser.new_context(**options)
    context.add_init_script(CSP_PROBE)
    return context.new_page()


def csp_violations(page: Page) -> list[str]:
    return page.evaluate("window.__cspViolations || []")


def submit_print_request(page: Page) -> None:
    page.locator("#next-button").click()
    page.locator("#name").fill("Taylor Customer")
    page.locator("#email").fill("taylor@example.com")
    page.locator("#next-button").click()
    page.locator("#terms").check()
    page.locator("#submit-button").click()
    page.locator("#submission-state.visible").wait_for(state="visible", timeout=15000)


def stored_requests(store_path: Path) -> list[dict]:
    return [record["request"] for record in json.loads(store_path.read_text(encoding="utf-8"))["requests"]]


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_each_generator_flows_from_edit_to_operator_store(browser: Browser, workspace: tuple[str, str, Path], generator_id: str) -> None:
    storefront, _operator, store_path = workspace
    page = new_matrix_page(browser)
    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))
    log_offset = DEV_LOG.stat().st_size if DEV_LOG.is_file() else 0
    try:
        values = edit_and_wait(page, storefront, generator_id, uuid.uuid4().hex)
        expect(page.locator("#cz-color-badge")).to_have_text(re.compile(r"^[1-5] colors?$"))
        assert csp_violations(page) == [], csp_violations(page)
        page.get_by_role("button", name="Continue to request").click()
        expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize$"))
        expect(page.locator("#customize-notice")).to_have_text("Loaded from the customizer — review and continue.")
        expect(page.locator("#service-print")).to_be_checked()
        page.locator("#next-button").click()
        expect(page.locator("#file-list")).to_contain_text(".3mf")
        submit_print_request(page)
        assert csp_violations(page) == [], csp_violations(page)
        assert not [e for e in console_errors if "Content Security Policy" in e], console_errors

        public_values = {k: v for k, v in values.items() if k != "password"}
        mine = [r for r in stored_requests(store_path) if (r.get("customization") or {}).get("generatorId") == generator_id
                and all(r["customization"]["params"].get(k) == v for k, v in public_values.items())]
        assert len(mine) == 1, [r.get("customization") for r in stored_requests(store_path)]
        assert mine[0]["customization"]["generatorVersion"] == GENERATOR_VERSIONS.get(generator_id, 1)

        # The local dev API logged this request (create and complete) with its generator id.
        appended = DEV_LOG.read_bytes()[log_offset:].decode("utf-8")
        events = [json.loads(line) for line in appended.splitlines() if line.strip()]
        logged = [e for e in events if (e.get("request", {}).get("customization") or {}).get("generatorId") == generator_id]
        assert {e["event"] for e in logged} == {"create", "complete"}, [e.get("event") for e in events]
        if "password" in values:
            secret = values["password"]
            customization = mine[0]["customization"]
            assert customization["params"]["password"] == "[redacted]" and customization["redacted"] == ["password"]
            assert secret not in appended, "the Wi-Fi password reached data/dev-requests.ndjson"
            assert secret not in store_path.read_text(encoding="utf-8"), "the Wi-Fi password reached the operator store"
            for storage in ("localStorage", "sessionStorage"):
                assert secret not in page.evaluate(f"JSON.stringify(Object.entries({storage}))"), storage
    finally:
        page.context.close()


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_each_generator_builds_with_every_other_origin_blocked(browser: Browser, workspace: tuple[str, str, Path], generator_id: str) -> None:
    storefront, _operator, _store = workspace
    page = new_matrix_page(browser)
    aborted: list[str] = []
    routed: list[str] = []

    def only_this_origin(route) -> None:
        routed.append(route.request.url)
        if route.request.url.startswith(storefront + "/"):
            route.continue_()
        else:
            aborted.append(route.request.url)
            route.abort()
    page.context.route("**/*", only_this_origin)
    try:
        edit_and_wait(page, storefront, generator_id, uuid.uuid4().hex)
        if generator_id == "name-plate":  # a curated font is fetched by the worker: same origin only
            page.locator("#cz-font-toggle").click()
            page.locator("label[for='cz-font-bebas-neue']").click()
            expect(page.locator("#cz-font-toggle")).to_have_text("Bebas Neue")
            wait_ready(page)
        expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
        assert aborted == [], aborted
        # Not vacuous: the route also sees the build worker's own requests. Only the worker fetches
        # the Manifold .wasm (instantiateStreaming), so the interception covers the worker.
        assert any(u.endswith(".wasm") for u in routed), routed
        if generator_id == "name-plate":
            assert any(u.endswith("/customize/fonts/BebasNeue-Regular.ttf") for u in routed), routed
    finally:
        page.context.close()


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_each_generator_page_fits_390_px_without_csp_violations(browser: Browser, workspace: tuple[str, str, Path], generator_id: str) -> None:
    storefront, _operator, _store = workspace
    page = new_matrix_page(browser, viewport={"width": 390, "height": 844}, color_scheme="dark", reduced_motion="reduce")
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text))
    try:
        edit_and_wait(page, storefront, generator_id, uuid.uuid4().hex)
        page.get_by_role("tab", name="3D").click()
        expect(page.get_by_role("tab", name="3D")).to_have_attribute("aria-selected", "true")
        expect(page.locator("#cz-stage canvas")).to_be_visible()
        expect(page.get_by_role("button", name="Show on print bed")).to_be_visible()
        widths = page.evaluate("({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })")
        assert widths["scroll"] <= widths["inner"], widths
        assert csp_violations(page) == [], csp_violations(page)
        assert not [m for m in console if "Content Security Policy" in m], console
    finally:
        page.context.close()


def test_the_csp_probe_sees_a_violation(browser: Browser, workspace: tuple[str, str, Path]) -> None:
    # Guards the guard: the listener used above does report a blocked request on these pages.
    storefront, _operator, _store = workspace
    page = new_matrix_page(browser)
    try:
        page.goto(f"{storefront}/customize/g/route-shield/")
        page.evaluate("() => { const img = document.createElement('img'); img.src = 'https://evil.example/pixel.png'; document.body.append(img); }")
        for _ in range(40):
            if csp_violations(page):
                break
            page.wait_for_timeout(50)
        assert any("evil.example" in v for v in csp_violations(page)), csp_violations(page)
    finally:
        page.context.close()


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_indexeddb_open_throwing_falls_back_to_a_download(browser: Browser, workspace: tuple[str, str, Path], generator_id: str) -> None:
    storefront, _operator, _store = workspace
    page = new_matrix_page(browser, accept_downloads=True)
    page.context.add_init_script("IDBFactory.prototype.open = function () { throw new DOMException('Storage is blocked.', 'SecurityError'); };")
    try:
        edit_and_wait(page, storefront, generator_id, uuid.uuid4().hex)
        with page.expect_download() as download_info:
            page.get_by_role("button", name="Continue to request").click()
        download = download_info.value
        assert download.suggested_filename.endswith(".3mf"), download.suggested_filename
        assert Path(download.path()).read_bytes()[:2] == b"PK"
        expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize&handoff=download$"))
        expect(page.locator("#customize-notice")).to_have_text("Your browser blocked the direct hand-off; attach the file you just downloaded.")
    finally:
        page.context.close()


def hand_off_route_shield(page: Page, origin: str, title: str) -> None:
    edit_and_wait(page, origin, "route-shield", uuid.uuid4().hex)
    page.get_by_role("button", name="Continue to request").click()
    expect(page.locator("#customize-notice")).to_have_text("Loaded from the customizer — review and continue.")
    page.locator("#next-button").click()
    expect(page.locator("#file-list")).to_contain_text(".3mf")
    page.locator("#project-title").fill(title)


def test_removing_the_handed_off_model_drops_the_customization(browser: Browser, workspace: tuple[str, str, Path]) -> None:
    storefront, _operator, store_path = workspace
    page = new_matrix_page(browser)
    title = f"Removed model {uuid.uuid4().hex[:8]}"
    try:
        hand_off_route_shield(page, storefront, title)
        page.get_by_role("button", name=re.compile(r"^Remove .*\.3mf$")).click()
        expect(page.locator("#file-list")).not_to_contain_text(".3mf")
        page.locator("#model-url").fill("https://example.com/my-model.stl")
        submit_print_request(page)
        mine = [r for r in stored_requests(store_path) if r.get("projectTitle") == title]
        assert len(mine) == 1 and mine[0].get("customization") is None, mine
    finally:
        page.context.close()


def test_replacing_the_handed_off_model_drops_the_customization(browser: Browser, workspace: tuple[str, str, Path]) -> None:
    storefront, _operator, store_path = workspace
    page = new_matrix_page(browser)
    title = f"Replaced model {uuid.uuid4().hex[:8]}"
    try:
        hand_off_route_shield(page, storefront, title)
        page.locator("#model-file").set_input_files(str(ROOT / "tests/fixtures/customize/three-color-bambu.3mf"))
        expect(page.locator("#file-list")).to_contain_text("three-color-bambu.3mf")
        expect(page.locator("#file-list")).not_to_contain_text("route-shield")
        submit_print_request(page)
        mine = [r for r in stored_requests(store_path) if r.get("projectTitle") == title]
        assert len(mine) == 1 and mine[0].get("customization") is None, mine
        assert [f["name"] for f in mine[0]["files"]] == ["three-color-bambu.3mf"], mine[0]["files"]
    finally:
        page.context.close()


def test_the_catalog_page_has_no_csp_violations(browser: Browser, workspace: tuple[str, str, Path]) -> None:
    storefront, _operator, _store = workspace
    page = new_matrix_page(browser)
    console: list[str] = []
    page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console.append(str(e)))
    try:
        page.goto(f"{storefront}/customize/", wait_until="networkidle")
        expect(page.locator(".cz-card-link")).to_have_count(len(GENERATOR_IDS))
        assert csp_violations(page) == [], csp_violations(page)
        assert not console, console
    finally:
        page.context.close()


# ---- The shared font picker: the same on every generator, with installed fonts ------------------

def _font_choices() -> list[str]:
    """The picker's labels, read from the shared catalogue so the test follows it."""
    root = Path(__file__).resolve().parents[2]
    code = "import('./public/assets/js/customize/fonts.js').then(m=>console.log(JSON.stringify(m.FONT_OPTIONS.map(o=>o.label))))"
    out = subprocess.run(["node", "-e", code], cwd=root, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


FONT_CHOICES = _font_choices()
ACK_LABEL = "I have the right to use this font to make a printed item."
INSTALLED_STUB = """
window.queryLocalFonts = async () => [
  { family: 'Bebas Neue', style: 'Regular', fullName: 'Bebas Neue Regular', postscriptName: 'BebasNeue-Regular',
    blob: async () => (await fetch('/customize/fonts/BebasNeue-Regular.ttf')).blob() },
  { family: 'Righteous', style: 'Regular', fullName: 'Righteous Regular', postscriptName: 'Righteous-Regular',
    blob: async () => (await fetch('/customize/fonts/Righteous-Regular.ttf')).blob() },
  { family: 'Broken', style: 'Regular', fullName: 'Broken Regular', postscriptName: 'Broken-Regular',
    blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])]) }
];
"""


def open_generator(page: Page, base_url: str, generator_id: str) -> None:
    page.goto(f"{base_url}/customize/g/{generator_id}/")
    expect(page.locator("body[data-build-state]")).to_be_attached(timeout=BUILD_TIMEOUT)
    if generator_id == "wifi-tag":
        page.get_by_label("Network password", exact=True).fill("pw-font-test")
    wait_ready(page)


def choose_font(page: Page, value: str) -> None:
    page.locator("#cz-font-toggle").click()
    page.locator(f"label[for='cz-font-{value}']").click()


@pytest.mark.parametrize("generator_id", TEXT_GENERATOR_IDS)
def test_every_generator_offers_the_same_font_picker(page: Page, base_url: str, generator_id: str) -> None:
    open_generator(page, base_url, generator_id)
    toggle = page.locator("#cz-font-toggle")
    expect(toggle).to_be_visible()
    expect(toggle).to_have_text("Block (built-in)")
    toggle.click()
    assert page.locator("#cz-font-list label").all_text_contents() == FONT_CHOICES
    page.locator("label[for='cz-font-lobster']").click()
    expect(toggle).to_have_text("Lobster")
    wait_ready(page)
    # A curated font needs no confirmation and no own-font panel.
    expect(page.get_by_label(ACK_LABEL)).to_be_hidden()
    expect(page.locator("#cz-font-area")).to_be_hidden()
    choose_font(page, "system")
    expect(page.get_by_label(ACK_LABEL)).to_be_visible()
    expect(page.locator("#cz-font-area")).to_be_visible()
    expect(page.locator("#cz-font_license_ack-error")).to_have_text(ACK_REQUIRED)
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    choose_font(page, "custom")
    expect(page.locator("#cz-font-file")).to_be_visible()
    expect(page.locator("#cz-font-file")).to_be_disabled()


@pytest.mark.parametrize("generator_id", TEXT_GENERATOR_IDS)
def test_an_installed_font_needs_the_confirmation_and_is_never_uploaded(page: Page, base_url: str, generator_id: str) -> None:
    requests: list[tuple[str, str]] = []
    page.on("request", lambda r: requests.append((r.method, r.url)))
    page.context.add_init_script(INSTALLED_STUB)
    open_generator(page, base_url, generator_id)
    choose_font(page, "system")
    opener = page.get_by_role("button", name="Choose an installed font…")
    expect(opener).to_be_disabled()
    expect(page.locator("#cz-font-status")).to_have_text("Confirm the license box above to choose a font.")
    page.get_by_label(ACK_LABEL).check()
    expect(opener).to_be_enabled()
    expect(page.locator("#cz-font-error")).to_have_text("Choose an installed font below, or pick one of the listed fonts.", timeout=BUILD_TIMEOUT)
    opener.click()
    options = page.locator("#cz-font-system-list button")
    expect(options).to_have_count(3)
    family = options.first.evaluate("el => getComputedStyle(el).fontFamily")
    assert "Bebas Neue" in family, family
    # A font that won't parse is explained next to the font control, and a good one builds.
    page.get_by_role("button", name="Broken Regular").click()
    expect(page.locator("#cz-font-error")).to_contain_text("installed font couldn't be read", timeout=BUILD_TIMEOUT)
    before = len(requests)
    page.locator("#cz-font-system-filter").fill("bebas")
    expect(options).to_have_count(1)
    options.first.click()
    wait_ready(page)
    expect(page.locator("#cz-font-status")).to_contain_text("Using Bebas Neue Regular")
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled()
    assert not [r for r in requests[before:] if r[0] != "GET" or not r[1].startswith((base_url, "blob:", "data:"))], requests[before:]
    # Withdrawing the confirmation withdraws the font; the choice, the font and the box are not drafted.
    page.get_by_label(ACK_LABEL).uncheck()
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    expect(page.locator("#cz-font-system-list button").first).to_be_disabled()
    page.get_by_label(ACK_LABEL).check()
    wait_ready(page)
    draft = page.evaluate(f"sessionStorage.getItem({f'3dp-customize:{generator_id}:v{GENERATOR_VERSIONS.get(generator_id, 1)}'!r}) || ''")
    assert '"font":"block"' in draft and "font_license_ack" not in draft and "Bebas" not in draft, draft


def test_a_refused_font_permission_is_explained(page: Page, base_url: str) -> None:
    page.context.add_init_script("window.queryLocalFonts = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };")
    open_name_plate(page, base_url)
    choose_font(page, "system")
    page.get_by_label(ACK_LABEL).check()
    page.get_by_role("button", name="Choose an installed font…").click()
    expect(page.locator("#cz-font-status")).to_contain_text("Permission to list installed fonts wasn't given")
    expect(page.locator("#cz-font-status")).to_have_attribute("data-state", "error")


@pytest.mark.parametrize("generator_id", TEXT_GENERATOR_IDS)
def test_a_browser_that_cannot_list_fonts_still_offers_the_font_file(page: Page, base_url: str, generator_id: str) -> None:
    page.context.add_init_script("Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: undefined });")
    open_generator(page, base_url, generator_id)
    page.locator("#cz-font-toggle").click()
    expect(page.locator("#cz-font-system")).to_be_disabled()
    expect(page.locator("label[for='cz-font-system']")).to_contain_text("not available in this browser")
    page.locator("label[for='cz-font-custom']").click()
    page.get_by_label(ACK_LABEL).check()
    expect(page.locator("#cz-font-file")).to_be_enabled()


# ---- The studio layout: a full-bleed canvas with docked, collapsible tool windows ------------------

UI_KEY = "3dp-customize:ui:v1"


def test_the_preview_fills_the_canvas_and_the_tool_windows_float_beside_it(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    stage = page.locator("#cz-stage").bounding_box()
    canvas = page.locator("#cz-canvas").bounding_box()
    assert stage and canvas
    assert stage["width"] >= canvas["width"] - 1 and stage["height"] >= canvas["height"] - 1, (stage, canvas)
    assert canvas["height"] >= 600, canvas  # the studio takes the viewport under the header
    settings = page.locator("#cz-win-settings").bounding_box()
    facts = page.locator("#cz-win-info").bounding_box()
    assert settings and facts
    assert settings["x"] + settings["width"] <= facts["x"], "the windows sit at opposite edges and never overlap"
    expect(page.locator("#cz-stage canvas")).to_be_visible()
    # The view tabs, bed toggle and Continue live in the top bar, above the canvas.
    assert page.get_by_role("button", name="Continue to request").bounding_box()["y"] < canvas["y"]


def test_a_tool_window_collapses_with_its_button_and_the_choice_is_remembered(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    toggle = page.locator("#cz-win-settings .cz-win-toggle")
    body = page.locator("#cz-win-settings-body")
    expect(toggle).to_have_attribute("aria-expanded", "true")
    expect(body).to_be_visible()
    toggle.click()
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(body).to_be_hidden()
    assert '"settings":true' in page.evaluate(f"localStorage.getItem({UI_KEY!r}) || ''")
    page.reload()
    wait_ready(page)
    expect(toggle).to_have_attribute("aria-expanded", "false")
    expect(body).to_be_hidden()
    toggle.click()
    expect(body).to_be_visible()
    # Escape in a control moves focus to the window's title button; Escape there collapses it.
    page.get_by_label("Upper text", exact=True).focus()
    page.keyboard.press("Escape")
    expect(toggle).to_be_focused()
    expect(toggle).to_have_attribute("aria-expanded", "true")
    page.keyboard.press("Escape")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    # The facts window is independent.
    expect(page.locator("#cz-win-info .cz-win-toggle")).to_have_attribute("aria-expanded", "true")


def test_collapsing_is_instant_when_reduced_motion_is_requested(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    try:
        page.goto(f"{base_url}/customize/g/route-shield/")
        wait_ready(page)
        page.locator("#cz-win-settings .cz-win-toggle").click()
        assert page.locator("#cz-win-settings-body").evaluate("el => el.hidden") is True, "no animation to wait for"
        duration = page.locator("#cz-win-settings-body").evaluate("el => el.getAnimations().length")
        assert duration == 0
        assert page.evaluate("getComputedStyle(document.body).getPropertyValue('--cz-dur').trim()") in ("0ms", "0s")
    finally:
        context.close()


def test_a_settings_group_collapses_and_a_field_error_opens_and_closes(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    if page.locator("#cz-mode").is_visible():  # sections are declared: the category groups are one click away
        page.locator("#cz-mode").get_by_role("button", name="Category").click()
    group = page.locator("[data-group-key='size'] .cz-group-toggle")
    expect(group).to_have_attribute("aria-expanded", "true")
    group.click()
    expect(group).to_have_attribute("aria-expanded", "false")
    expect(page.locator("#cz-width_mm")).to_be_hidden()
    group.click()
    expect(page.locator("#cz-width_mm")).to_be_visible()
    width = page.locator("#cz-width_mm")
    width.fill("20")
    wrap = page.locator("[data-field='width_mm'] .cz-err")
    expect(wrap).to_have_class(re.compile(r"\bis-open\b"))
    width.press("Tab")
    wait_ready(page)
    expect(wrap).not_to_have_class(re.compile(r"\bis-open\b"))


def test_mobile_uses_a_bottom_sheet_with_tabs_that_leaves_the_preview_room(browser: Browser, base_url: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark")
    page = context.new_page()
    try:
        page.goto(f"{base_url}/customize/g/route-shield/")
        wait_ready(page)
        expect(page.locator("#cz-win-settings")).to_be_visible()
        expect(page.locator("#cz-win-info")).to_be_hidden()
        sheet = page.locator(".cz-panels").bounding_box()
        assert sheet and sheet["height"] <= 844 * 0.6 and sheet["y"] + sheet["height"] <= 844 + 1, sheet
        page.get_by_role("button", name="Facts", exact=True).click()
        expect(page.locator("#cz-win-info")).to_be_visible()
        expect(page.locator("#cz-facts-list")).to_contain_text("cm³")
        expect(page.locator("#cz-win-settings")).to_be_hidden()
        page.get_by_role("button", name="Settings", exact=True).click()
        expect(page.locator("#cz-win-settings")).to_be_visible()
        # The chevron folds the sheet down to its tab strip and back.
        toggle = page.locator("#cz-sheet-toggle")
        toggle.click()
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(page.locator("#cz-win-settings-body")).to_be_hidden()
        assert page.locator(".cz-panels").bounding_box()["height"] < 120
        toggle.click()
        expect(page.locator("#cz-win-settings-body")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") <= 0
    finally:
        context.close()


def test_font_picker_type_ahead_jumps_to_the_font_and_commits_once(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    toggle = page.locator("#cz-font-toggle")
    toggle.click()
    expect(page.get_by_role("radio", name="Block (built-in)")).to_be_focused()
    page.keyboard.press("l")
    expect(page.get_by_role("radio", name="Lobster")).to_be_checked()
    expect(page.get_by_role("radio", name="Lobster")).to_be_focused()
    page.keyboard.press("Enter")
    expect(toggle).to_have_text("Lobster")
    wait_settled(page)
    # The list scrolls inside its own bounded box and keeps heading rows out of the labels.
    toggle.click()
    scroller = page.locator("#cz-font-list .cz-picker-scroll")
    assert scroller.evaluate("el => getComputedStyle(el).overflowY") == "auto"
    assert scroller.bounding_box()["height"] <= 900 * 0.6
    assert page.locator("#cz-font-list label").count() == len(FONT_CHOICES)


# ---- Sections: group by Section | Category, and the preview that points at its settings -----------

_CONTRACT_SCRIPT = """
import { pathToFileURL } from 'node:url';
const { GENERATORS } = await import(pathToFileURL(process.argv[1]).href);
const out = {};
for (const [id, g] of Object.entries(GENERATORS)) {
  out[id] = {
    sections: Object.keys(g.sections ?? {}).length > 0,
    focus: Array.isArray(g.focus) && g.focus.length > 0,
    fieldSections: Object.values(g.schema ?? {}).some(f => typeof f.section === 'string' && f.section)
  };
}
console.log(JSON.stringify(out));
"""


def section_contract() -> dict[str, dict[str, bool]]:
    """What each registered definition declares (read from the registry itself, so shorthand,
    spreads and helpers count): { id: { sections, focus, fieldSections } }."""
    import subprocess
    done = subprocess.run(["node", "--input-type=module", "-e", _CONTRACT_SCRIPT, str(ROOT / "public/assets/js/customize/registry.js")],
                          cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(done.stdout)


def needs(generator_id: str, *flags: str) -> None:
    declared = section_contract()[generator_id]
    missing = [f for f in flags if not declared[f]]
    if missing:
        pytest.skip(f"{generator_id} does not declare {' / '.join(missing)} yet")


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_the_hint_only_promises_what_the_page_and_view_can_do(page: Page, base_url: str, generator_id: str) -> None:
    open_generator(page, base_url, generator_id)
    hint = page.locator("#cz-hint")
    text = hint.text_content() or ""
    starts_in_3d = page.locator("[data-view][aria-selected='true']").get_attribute("data-view") == "3d"
    if not starts_in_3d:
        assert "Drag to turn" not in text, "turning exists only in the 3D view"
    assert ("Click a part" in text) == section_contract()[generator_id]["focus"], text
    page.get_by_role("tab", name="3D").click()
    expect(hint).to_contain_text("Drag to turn")


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_group_by_toggle_shows_the_same_fields_in_both_modes_and_is_remembered(page: Page, base_url: str, generator_id: str) -> None:
    needs(generator_id, "fieldSections")
    open_generator(page, base_url, generator_id)
    mode = page.locator("#cz-mode")
    expect(mode).to_be_visible()
    expect(mode.get_by_role("button", name="Section")).to_have_attribute("aria-pressed", "true")
    fields = page.locator("#cz-form [data-field]").evaluate_all("els => els.map(e => e.dataset.field).sort()")
    assert page.locator("#cz-form .cz-group[data-section]").count() >= 1
    mode.get_by_role("button", name="Category").click()
    expect(mode.get_by_role("button", name="Category")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#cz-form .cz-group[data-section]")).to_have_count(0)
    assert page.locator("#cz-form [data-field]").evaluate_all("els => els.map(e => e.dataset.field).sort()") == fields
    page.reload()
    open_generator(page, base_url, generator_id)
    expect(page.locator("#cz-mode").get_by_role("button", name="Category")).to_have_attribute("aria-pressed", "true")


@pytest.mark.parametrize("generator_id", GENERATOR_IDS)
def test_hovering_and_clicking_a_part_leads_to_its_settings(page: Page, base_url: str, generator_id: str) -> None:
    needs(generator_id, "focus", "fieldSections")
    open_generator(page, base_url, generator_id)
    page.locator("#cz-mode").get_by_role("button", name="Section").click()
    box = page.locator("#cz-stage").bounding_box()
    assert box
    tip = page.locator("#cz-tip")
    headers = [t.strip() for t in page.locator("#cz-form .cz-group[data-section] .cz-group-toggle").all_text_contents()]
    hit = None
    # Scan the middle of the canvas for a part whose section has settings (a part without any
    # settings only gets the tooltip, which the contract allows).
    for row in range(1, 11):
        for col in range(1, 15):
            x = box["x"] + box["width"] * (0.28 + 0.44 * col / 15)
            y = box["y"] + box["height"] * (0.12 + 0.76 * row / 11)
            page.mouse.move(x, y)
            page.wait_for_timeout(35)
            if "is-visible" in (tip.get_attribute("class") or "") and (tip.text_content() or "").strip() in headers:
                hit = (x, y)
                break
        if hit:
            break
    assert hit, f"no part of the model that maps to one of {headers} reacts to hovering"
    label = (tip.text_content() or "").strip()
    # The matching settings header is softly marked, and the part is outlined.
    expect(page.locator("#cz-form .cz-group.is-linked")).to_have_count(1)
    expect(page.locator("#cz-form .cz-group.is-linked .cz-group-toggle")).to_contain_text(label)
    page.mouse.click(*hit)
    expect(page.locator("#cz-announce")).to_contain_text("selected", timeout=3000)
    section = page.locator("#cz-form .cz-group.is-linked")
    expect(section).to_have_count(1)
    expect(section.locator(".cz-group-toggle")).to_have_attribute("aria-expanded", "true")
    focused_section = page.evaluate("document.activeElement.closest('.cz-group')?.dataset.section || ''")
    assert focused_section == section.get_attribute("data-section"), focused_section
    # Clicking empty canvas clears the selection.
    page.mouse.move(box["x"] + 4, box["y"] + 4)
    page.mouse.click(box["x"] + 4, box["y"] + 4)
    expect(page.locator("#cz-announce")).to_contain_text("Selection cleared", timeout=3000)


def test_a_per_location_font_loads_in_the_worker_and_builds(page: Page, base_url: str) -> None:
    """The override font is requested by the page and handed to the builder (not just unit-built)."""
    fonts: list[str] = []
    page.on("request", lambda r: fonts.append(r.url) if "/customize/fonts/Pacifico" in r.url else None)
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.locator("#cz-top_font-toggle").click()
    page.locator("label[for='cz-top_font-pacifico']").click()
    wait_settled(page)
    expect(page.locator("body[data-build-state]")).to_have_attribute("data-build-state", "ready", timeout=BUILD_TIMEOUT)
    assert any(u.endswith(".ttf") and "Pacifico-Regular" in u for u in fonts), fonts


def test_design_gallery_applies_a_design_and_undo_restores(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    # A fresh visit opens the gallery, with 66 the default.
    expect(page.locator("#cz-designs-toggle")).to_have_attribute("aria-expanded", "true")
    expect(page.locator("#cz-designs-current")).to_have_text("Based on Route 66.")
    expect(page.locator("button.cz-design")).to_have_count(13)
    expect(page.locator("button.cz-design[data-design='route-66']")).to_have_attribute("aria-pressed", "true")
    page.locator("button.cz-design[data-design='i-95']").click()
    expect(page.locator("#cz-lower_text")).to_have_value("95")
    expect(page.locator("#cz-top_text")).to_have_value("INTERSTATE")
    expect(page.locator("#cz-designs-current")).to_have_text("Based on Interstate 95.")
    expect(page.locator("#cz-designs-toggle")).to_have_attribute("aria-expanded", "false")
    wait_settled(page)
    # Editing afterwards is noted, and Undo brings the previous settings back.
    page.locator("#cz-lower_text").fill("96")
    expect(page.locator("#cz-designs-current")).to_have_text("Based on Interstate 95, with your changes.")
    page.get_by_role("button", name="Undo", exact=True).click()
    expect(page.locator("#cz-lower_text")).to_have_value("66")
    expect(page.locator("#cz-designs-current")).to_have_text("Based on Route 66.")
    wait_settled(page)


def test_randomize_respects_locks_and_never_touches_text(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    base_before = page.locator("#cz-base_color").input_value()
    text_before = page.locator("#cz-top_text").input_value()
    lock = page.locator("button.cz-lock[data-lock='base_color']")
    lock.click()
    expect(lock).to_have_attribute("aria-pressed", "true")
    changed = False
    for _ in range(4):
        page.get_by_role("button", name="Randomize", exact=True).click()
        wait_settled(page)
        assert page.locator("#cz-base_color").input_value() == base_before
        assert page.locator("#cz-top_text").input_value() == text_before
        assert page.locator("#cz-qr_data").input_value() == "https://3dprint4.me/"
        changed = changed or page.locator("#cz-upper_color").input_value() != "#ef233c"
    assert changed
    expect(page.locator("#cz-designs-current")).to_have_text("Your own settings.")
    expect(page.get_by_role("button", name="Undo", exact=True)).to_be_visible()
    expect(page.locator("#cz-continue")).to_be_enabled()


def test_name_plate_offers_common_names_and_randomizes_to_a_buildable_plate(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/name-plate/")
    wait_ready(page)
    page.locator("button.cz-design[data-design='emma']").click()
    expect(page.locator("#cz-name")).to_have_value("Emma")
    wait_settled(page)
    for _ in range(3):
        page.get_by_role("button", name="Randomize", exact=True).click()
        wait_settled(page)
        expect(page.locator("#cz-name")).to_have_value("Emma")
        expect(page.locator("body[data-build-state='ready']")).to_be_attached()


# --- Pumpkin: Simple / Advanced, designs and the type switches ---------------------------------

def pick_design(page: Page, label: str) -> None:
    page.evaluate("""(label) => { const n = [...document.querySelectorAll('.cz-design-name')].find(e => e.textContent.trim() === label); n.closest('button').click(); }""", label)
    wait_settled(page)


def test_the_pumpkin_starts_simple_and_advanced_shows_the_shape_controls(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/pumpkin/")
    wait_ready(page)
    level = page.locator("#cz-level")
    expect(level).to_be_visible()
    expect(level.get_by_role("button", name="Simple")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("[data-field='boxiness_pct']")).to_be_hidden()
    expect(page.locator("[data-field='segments']")).to_be_visible()
    expect(page.locator("[data-field='style']")).to_be_visible()
    # The page opens in 3D and the flat views are named for what they show.
    expect(page.get_by_role("tab", name="3D")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("tab", name="Top")).to_be_visible()
    level.get_by_role("button", name="Advanced").click()
    expect(page.locator("[data-field='boxiness_pct']")).to_be_visible()
    expect(page.locator("[data-field='twist_deg']")).to_be_visible()
    stored = json.loads(page.evaluate("localStorage.getItem('3dp-customize:ui:v1')"))
    assert stored["level"] == "advanced"
    page.reload()
    wait_ready(page)
    expect(page.locator("#cz-level").get_by_role("button", name="Advanced")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("[data-field='boxiness_pct']")).to_be_visible()


def test_a_rule_error_on_a_hidden_advanced_setting_can_be_reached(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/pumpkin/")
    wait_ready(page)
    # A 50 mm pumpkin with the default face leaves a face narrower than 24 mm: an advanced setting's rule.
    box = page.locator("[name='diameter_mm']")
    box.fill("50")
    box.press("Tab")
    summary = page.locator("#cz-form-errors")
    expect(summary).to_contain_text("at least 24 mm")
    show = summary.get_by_role("button", name="Show advanced settings")
    expect(show).to_be_visible()
    show.click()
    expect(page.locator("[data-field='face_size_pct']")).to_be_visible()
    expect(page.locator("#cz-level").get_by_role("button", name="Advanced")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#cz-face_size_pct-error")).to_contain_text("at least 24 mm")


def test_other_generators_have_no_simple_advanced_switch(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    expect(page.locator("#cz-level")).to_have_count(0)


def test_the_pumpkin_types_switch_their_own_controls(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/pumpkin/")
    wait_ready(page)
    style = page.locator("[name='style']")
    style.select_option("hollow")
    expect(page.locator("[data-field='opening']")).to_be_visible()
    style.select_option("vase")
    wait_settled(page)
    expect(page.locator("[data-field='face']")).to_be_hidden()
    expect(page.locator("[data-field='stem']")).to_be_hidden()
    expect(page.locator("#cz-warnings")).to_contain_text("Spiral vase")
    style.select_option("solid")
    wait_settled(page)
    # The face and stem the visitor had before the vase come back (a vase only ignores them).
    expect(page.locator("[name='face']")).to_have_value("cute")
    expect(page.locator("[name='stem']")).to_have_value("fused")
    style.select_option("bowl")
    wait_settled(page)
    expect(page.locator("[name='wall_mm']")).to_have_value("2")
    page.locator("[name='stem']").select_option("peg")
    wait_settled(page)
    expect(page.locator("#cz-warnings")).to_contain_text("prints on its own")


def test_a_pumpkin_design_builds_and_continues_to_the_request(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/pumpkin/")
    wait_ready(page)
    pick_design(page, "Jack-o'-lantern")
    expect(page.locator("[name='style']")).to_have_value("hollow")
    expect(page.locator("#cz-color-badge")).to_have_text("1 color")
    expect(page.locator("#cz-warnings")).to_contain_text("tealight")
    page.get_by_role("button", name="Continue to request").click()
    expect(page).to_have_url(re.compile(r"/order\.html\?service=print&from=customize$"))
    expect(page.locator("#customize-notice")).to_have_text("Loaded from the customizer — review and continue.")
