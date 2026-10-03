"""Customize section against the real dev server (WASM, module workers and the /customize CSP need real HTTP)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

import pytest
from playwright.sync_api import Browser, Page, expect, sync_playwright

from tests.support.browser_harness import SYSTEM_CHROMIUM_PATH
from tests.support.server import request, running_server

ROOT = Path(__file__).resolve().parents[2]
BUILT_PAGE = ROOT / "public/customize/g/route-shield/index.html"
BUILD_TIMEOUT = 30000


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


def test_route_shield_builds_and_enables_continue(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    continue_button = page.get_by_role("button", name="Continue to request")
    expect(continue_button).to_be_disabled()
    page.get_by_label("Upper text", exact=True).fill("ROUTE")
    expect(page.locator("#cz-color-badge")).to_have_text(re.compile(r"^\d+ colors?$"), timeout=BUILD_TIMEOUT)
    expect(continue_button).to_be_enabled(timeout=BUILD_TIMEOUT)
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
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled(timeout=BUILD_TIMEOUT)
    page.get_by_role("tab", name="3D").click()
    page.wait_for_timeout(300)
    assert not [e for e in errors if "Content Security Policy" in e], errors
    assert not errors, errors
    foreign = [url for url in requests if not url.startswith(base_url) and not url.startswith(("blob:", "data:"))]
    assert not foreign, foreign
    _, headers, _ = request(f"{base_url}/customize/g/route-shield/")
    csp = {k.lower(): v for k, v in headers.items()}["content-security-policy"]
    assert "'wasm-unsafe-eval'" in csp and "connect-src 'self';" in csp


def test_invalid_settings_explain_and_disable_continue(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.locator("#cz-width_mm").fill("20")
    expect(page.locator("#cz-form-errors")).to_contain_text("Width must be 50–250 mm", timeout=5000)
    expect(page.get_by_role("button", name="Continue to request")).to_be_disabled()
    page.locator("#cz-width_mm").press("Tab")  # commit: the value is clamped back into range
    expect(page.locator("#cz-width_mm")).to_have_value("50")
    expect(page.get_by_role("button", name="Continue to request")).to_be_enabled(timeout=BUILD_TIMEOUT)


def test_draft_restores_from_session_storage_and_reset_clears_it(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/customize/g/route-shield/")
    wait_ready(page)
    page.get_by_label("Lower text", exact=True).fill("101")
    expect(page.locator("body[data-build-state='building'], body[data-build-state='ready']")).to_be_attached()
    page.wait_for_timeout(400)
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
