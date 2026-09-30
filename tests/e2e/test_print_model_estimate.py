from __future__ import annotations

import json
import re

from tests.support.browser_harness import ROOT, SiteBrowser

FIXTURES = ROOT / "tests/fixtures/print-estimation"
LOCAL_FALLBACK_WARNINGS = ("Backend unavailable; preserving a local request copy.",)


def open_print_details(site: SiteBrowser):
    page = site.load("/order.html?service=print")
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Model-aware bracket")
    page.locator("#description").fill("Print the attached bracket; please confirm orientation and supports.")
    return page


def amount(page) -> str:
    return page.locator("#estimate-amount").inner_text()


def test_stl_selection_measures_geometry_locally_and_updates_the_planning_range() -> None:
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        size_based = amount(page)
        page.locator("#model-file").set_input_files(str(FIXTURES / "cube-20mm-binary.stl"))
        card = page.locator("#model-card[data-state='analyzed']")
        card.wait_for()
        text = card.inner_text()
        assert "cube-20mm-binary.stl" in text
        assert "20 × 20 × 20 mm" in text
        assert "8 cm³" in text
        assert "not a slice" in text
        assert "millimetres are assumed" in text
        assert "cube-20mm-binary.stl" in page.locator("#file-list").inner_text(), "the model travels with the request"
        assumption = page.locator("#estimate-list").inner_text()
        assert "Model geometry (not a slice)" in assumption
        assert page.locator("#estimate-confidence").inner_text() == "Planning range, confirmed after review"
        assert amount(page) != size_based

        observed = {amount(page)}
        for selector, value in [("#quantity", "12"), ("#quality", "fine"), ("#material", "asa"), ("#colors", "3"), ("#supports", "heavy"), ("#finish", "painted")]:
            if selector == "#quantity":
                page.locator(selector).fill(value)
            else:
                page.locator(selector).select_option(value)
            page.wait_for_timeout(30)
            current = amount(page)
            assert current not in observed, f"{selector} did not change the estimate ({current})"
            observed.add(current)
        rough_grams = re.search(r"~([\d.]+) g", page.locator("#model-card").inner_text())
        assert rough_grams, "model card shows the rough material estimate"
        site.assert_no_page_errors()


def test_3mf_selection_reports_ignored_embedded_settings_and_units() -> None:
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(FIXTURES / "two-cubes.3mf"))
        card = page.locator("#model-card[data-state='analyzed']")
        card.wait_for()
        text = card.inner_text()
        assert "3MF" in text
        assert "25 × 15 × 10 mm" in text
        assert "embedded slicer settings are not trusted or used" in text
        site.assert_no_page_errors()


def test_hostile_3mf_fails_safely_and_the_request_can_still_be_submitted() -> None:
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(FIXTURES / "zip-bomb.3mf"))
        page.locator("#model-card[data-state='failed']").wait_for()
        message = page.locator("#model-card").inner_text()
        assert "could not be measured automatically" in message
        assert "You can still submit it" in message
        status_copy = page.locator("#model-card .model-status").inner_text().lower()
        assert not any(term in status_copy for term in ("zip", "ratio", "limit", "archive")), "public failure copy stays generic"
        assert "Model geometry" not in page.locator("#estimate-list").inner_text(), "failed analysis falls back to size assumptions"
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()
        page.locator("#submission-state.visible").wait_for()
        saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
        assert saved["files"][0]["name"] == "zip-bomb.3mf"
        site.assert_no_page_errors(allow_console_warnings=LOCAL_FALLBACK_WARNINGS)


def test_replacing_or_removing_the_model_clears_stale_geometry() -> None:
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(FIXTURES / "cube-10mm-ascii.stl"))
        page.locator("#model-card[data-state='analyzed']").wait_for()
        page.locator("#model-file").set_input_files(str(FIXTURES / "cube-20mm-binary.stl"))
        page.wait_for_function("document.querySelector('#model-card').innerText.includes('cube-20mm-binary.stl')")
        page.locator("#model-card[data-state='analyzed']").wait_for()
        assert "cube-10mm-ascii.stl" not in page.locator("#file-list").inner_text(), "choosing a new model replaces the old one"
        page.locator("#file-list .file-remove").click()
        page.locator("#model-card").wait_for(state="hidden")
        assert "size assumption" in page.locator("#estimate-list").inner_text()
        site.assert_no_page_errors()


def test_public_order_page_never_contains_internal_economics() -> None:
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(FIXTURES / "cube-20mm-binary.stl"))
        page.locator("#model-card[data-state='analyzed']").wait_for()
        text = page.locator("body").inner_text().lower()
        for forbidden in ("landed", "margin", "wage", "economic floor", "passive machine", "inventory"):
            assert forbidden not in text, forbidden
    for path in (ROOT / "public").rglob("*.js"):
        source = path.read_text(encoding="utf-8")
        for forbidden in ("landedUsdPerKg", "economicFloor", "baseWageUsdPerHour", "requiredMinimumMargin", "filament_inventory"):
            assert forbidden not in source, f"{path.name} contains {forbidden}"
        site.assert_no_page_errors()
