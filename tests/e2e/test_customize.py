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


# --- Wi-Fi tag ---------------------------------------------------------------------------------

WIFI_DRAFT_KEY = "3dp-customize:wifi-tag:v1"
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
    expect(password).to_have_attribute("type", "password")
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


def test_wifi_keychain_builds_and_a_too_dense_code_is_explained_at_the_network_name(page: Page, base_url: str) -> None:
    open_wifi(page, base_url)
    page.get_by_label("Tag format").select_option("keychain")
    page.get_by_label("Network password", exact=True).fill(WIFI_SECRET)
    wait_ready(page)
    expect(page.locator("#cz-facts-list")).to_contain_text("45 × 69")
    page.get_by_label("Network name (SSID)", exact=True).fill(";" * 32)
    page.get_by_label("Network password", exact=True).fill(";" * 63)
    error = page.locator("[data-field='ssid'] #cz-ssid-error")
    expect(error).to_contain_text("too dense", timeout=BUILD_TIMEOUT)
    expect(error).to_contain_text("choose a larger tag format")
    expect(page.get_by_label("Network name (SSID)", exact=True)).to_have_attribute("aria-invalid", "true")
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

RATING_DRAFT_KEY = "3dp-customize:rating-card:v1"


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

NAME_DRAFT_KEY = "3dp-customize:name-plate:v1"
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
    expect(page.get_by_role("radio", name="Pacifico")).to_be_checked()
    expect(page.locator("#cz-font-list")).to_be_visible()
    page.keyboard.press("Enter")
    expect(page.locator("#cz-font-list")).to_be_hidden()
    expect(toggle).to_be_focused()
    expect(toggle).to_have_text("Pacifico")
    wait_ready(page)
    # Each option is drawn in its own font, from this site.
    toggle.click()
    family = page.locator("label[for='cz-font-lobster']").evaluate("el => getComputedStyle(el).fontFamily")
    assert "cz-lobster" in family, family
    page.wait_for_function("document.fonts.check('16px \"cz-lobster\"')")
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


def test_own_font_file_is_parsed_locally_and_never_uploaded(page: Page, base_url: str) -> None:
    requests: list[tuple[str, str]] = []
    page.on("request", lambda r: requests.append((r.method, r.url)))
    open_name_plate(page, base_url)
    page.locator("#cz-font-toggle").click()
    page.locator("label[for='cz-font-custom']").click()
    expect(page.locator("#cz-font-area")).to_be_visible()
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
    draft = page.evaluate(f"sessionStorage.getItem({NAME_DRAFT_KEY!r}) || ''")
    assert '"font":"custom"' in draft and "secret-house" not in draft, draft


def test_name_plate_rules_coerce_inlay_and_report_disconnected_letters(page: Page, base_url: str) -> None:
    open_name_plate(page, base_url)
    page.get_by_label("Style", exact=True).select_option("inlay")
    wait_ready(page)
    page.get_by_label("Plate", exact=True).select_option("none")
    expect(page.get_by_label("Style", exact=True)).to_have_value("raised")
    wait_ready(page)
    page.get_by_label("Name", exact=True).fill("A B")
    page.get_by_label("Name", exact=True).press("Tab")
    expect(page.locator("#cz-plate-error")).to_have_text("The letters aren't connected — choose a plate or a bolder font.", timeout=BUILD_TIMEOUT)
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
