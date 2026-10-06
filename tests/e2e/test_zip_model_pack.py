from __future__ import annotations

import json
import zipfile
from pathlib import Path

from playwright.sync_api import expect

from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace

LOCAL_FALLBACK_WARNINGS = ("Backend unavailable; preserving a local request copy.",)
PICKER = "#model-card[data-state='analyzed'] .pack-picker"
GOOD_PARTS = ("parts/base.stl", "parts/lid.stl", "parts/arm.stl")
BAD_PART = "parts/broken.stl"


def ascii_cube(size: float, name: str = "cube") -> bytes:
    """A closed ASCII STL cube (12 outward-facing triangles) with one corner at the origin."""
    s = size
    v = [(0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0), (0, 0, s), (s, 0, s), (s, s, s), (0, s, s)]
    faces = [
        ((0, 0, -1), (0, 2, 1)), ((0, 0, -1), (0, 3, 2)),
        ((0, 0, 1), (4, 5, 6)), ((0, 0, 1), (4, 6, 7)),
        ((0, -1, 0), (0, 1, 5)), ((0, -1, 0), (0, 5, 4)),
        ((1, 0, 0), (1, 2, 6)), ((1, 0, 0), (1, 6, 5)),
        ((0, 1, 0), (2, 3, 7)), ((0, 1, 0), (2, 7, 6)),
        ((-1, 0, 0), (3, 0, 4)), ((-1, 0, 0), (3, 4, 7)),
    ]
    lines = [f"solid {name}"]
    for normal, (a, b, c) in faces:
        lines.append(f"  facet normal {normal[0]} {normal[1]} {normal[2]}")
        lines.append("    outer loop")
        for index in (a, b, c):
            x, y, z = v[index]
            lines.append(f"      vertex {x} {y} {z}")
        lines.append("    endloop")
        lines.append("  endfacet")
    lines.append(f"endsolid {name}")
    return ("\n".join(lines) + "\n").encode("ascii")


def build_pack(path: Path) -> Path:
    """Three measurable cubes (stored and deflated), one unmeasurable STL, a PNG and a Markdown note."""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("parts/base.stl", ascii_cube(40, "base"), compress_type=zipfile.ZIP_STORED)
        archive.writestr("parts/lid.stl", ascii_cube(50, "lid"), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("parts/arm.stl", ascii_cube(60, "arm"), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr(BAD_PART, b"solid x", compress_type=zipfile.ZIP_STORED)  # under 15 bytes: empty_file
        archive.writestr("preview.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, compress_type=zipfile.ZIP_STORED)
        archive.writestr("NOTES.md", b"# Assembly\nGlue the lid to the base.\n", compress_type=zipfile.ZIP_DEFLATED)
    return path


def build_traversal_pack(path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("parts/ok.stl", ascii_cube(30, "ok"), compress_type=zipfile.ZIP_DEFLATED)
        archive.writestr("../x.stl", ascii_cube(30, "x"), compress_type=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(path) as archive:
        assert "../x.stl" in archive.namelist(), "the traversal entry name must survive into the archive"
    return path


def open_print_details(site: SiteBrowser):
    page = site.load("/order.html?service=print")
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Turn tracker pack")
    page.locator("#description").fill("Print the selected parts of the attached pack in PLA.")
    return page


def amount(page) -> str:
    return page.locator("#estimate-amount").inner_text()


def wait_for_amount_change(page, previous: str) -> str:
    page.wait_for_function("previous => document.querySelector('#estimate-amount').innerText !== previous", arg=previous, timeout=5_000)
    return amount(page)


def checkbox(page, index: int):
    return page.locator(f"#pack-part-{index}")


def quantity(page, index: int):
    return page.locator(f"#pack-qty-part-{index}")


def finish_and_submit(page) -> None:
    page.locator("#next-button").click()
    page.locator("#name").fill("Taylor Customer")
    page.locator("#email").fill("taylor@example.com")
    page.locator("#next-button").click()
    page.locator("#terms").check()
    page.locator("#submit-button").click()
    page.locator("#submission-state.visible").wait_for(timeout=15_000)


def test_zip_pack_lists_parts_marks_the_bad_part_and_lists_ignored_files(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(pack))
        page.locator(PICKER).wait_for()
        picker = page.locator(PICKER)
        assert "Choose parts to print (4 found in this pack)" in picker.inner_text()
        assert page.locator(".pack-part").count() == 4
        for index, name in enumerate(GOOD_PARTS):
            row = page.locator(".pack-part").nth(index)
            assert name in row.inner_text()
            expect(checkbox(page, index)).to_be_checked()
            expect(checkbox(page, index)).to_be_enabled()
            expect(quantity(page, index)).to_have_value("1")
        assert "40 × 40 × 40 mm · 64 cm³" in page.locator(".pack-part").nth(0).inner_text()
        bad = page.locator(".pack-part").nth(3)
        assert BAD_PART in bad.inner_text()
        assert "Could not be measured — a person will review it." in bad.inner_text()
        expect(checkbox(page, 3)).to_be_disabled()
        expect(checkbox(page, 3)).not_to_be_checked()
        expect(quantity(page, 3)).to_be_disabled()
        card = page.locator("#model-card").inner_text()
        assert "3 of 4 parts selected." in card
        assert "Not printed: preview.png, NOTES.md" in card
        assert "not a slice" in card
        assert "Packs are printed part by part; the confirmed price is often higher than this planning range." in card
        assert "fixture-pack.zip" in page.locator("#file-list").inner_text(), "the ZIP travels with the request"
        site.assert_no_page_errors()


def test_selection_and_quantity_change_the_planning_range_and_one_part_always_stays(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        size_based = amount(page)
        page.locator("#model-file").set_input_files(str(pack))
        page.locator(PICKER).wait_for()
        all_parts = wait_for_amount_change(page, size_based)
        assert "Model geometry (not a slice)" in page.locator("#estimate-list").inner_text()

        checkbox(page, 2).click()  # drop the 60 mm arm
        expect(checkbox(page, 2)).not_to_be_checked()
        without_arm = wait_for_amount_change(page, all_parts)
        assert "2 of 4 parts selected." in page.locator("#model-card").inner_text()
        expect(quantity(page, 2)).to_be_disabled()

        quantity(page, 1).fill("3")
        quantity(page, 1).press("Tab")  # the picker commits a quantity on change
        expect(quantity(page, 1)).to_have_value("3")
        three_lids = wait_for_amount_change(page, without_arm)
        assert three_lids != all_parts

        quantity(page, 0).fill("250")
        quantity(page, 0).press("Tab")
        expect(quantity(page, 0)).to_have_value("99")  # out-of-range quantities are clamped in place

        # Clear down to one part: the last selected part refuses to be unchecked and says why.
        checkbox(page, 1).click()
        expect(checkbox(page, 1)).not_to_be_checked()
        assert page.locator(".pack-hint").count() == 0
        checkbox(page, 0).click()
        expect(checkbox(page, 0)).to_be_checked()
        expect(page.locator(".pack-hint")).to_have_text("Keep at least one part selected.")
        assert "1 of 4 parts selected." in page.locator("#model-card").inner_text()
        checkbox(page, 2).click()  # any real change clears the hint
        expect(checkbox(page, 2)).to_be_checked()
        expect(page.locator(".pack-hint")).to_have_count(0)
        site.assert_no_page_errors()


def test_pack_picker_is_keyboard_operable(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(pack))
        page.locator(PICKER).wait_for()
        active = lambda: page.evaluate("document.activeElement && document.activeElement.id")
        page.locator("#model-file-button").focus()
        order = []
        for _ in range(6):
            page.keyboard.press("Tab")
            order.append(active())
        assert order == ["pack-part-0", "pack-qty-part-0", "pack-part-1", "pack-qty-part-1", "pack-part-2", "pack-qty-part-2"], order
        page.keyboard.press("Tab")
        assert active() not in ("pack-part-3", "pack-qty-part-3"), "the unmeasurable part is skipped"

        before = amount(page)
        checkbox(page, 1).focus()
        page.keyboard.press("Space")
        expect(checkbox(page, 1)).not_to_be_checked()
        assert active() == "pack-part-1", "toggling keeps focus on the checkbox"
        after = wait_for_amount_change(page, before)
        page.keyboard.press("Tab")
        assert active() == "pack-part-2", "a deselected part's quantity is skipped"
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Space")
        expect(checkbox(page, 1)).to_be_checked()
        wait_for_amount_change(page, after)

        page.keyboard.press("Tab")
        assert active() == "pack-qty-part-1"
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Tab")
        expect(quantity(page, 1)).to_have_value("2")
        site.assert_no_page_errors()


def test_zip_with_a_traversal_entry_fails_generically_and_still_submits(tmp_path: Path) -> None:
    pack = build_traversal_pack(tmp_path / "escape.zip")
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(pack))
        page.locator("#model-card[data-state='failed']").wait_for()
        message = page.locator("#model-card").inner_text()
        assert "This file could not be measured automatically." in message
        assert "You can still submit it" in message
        assert page.locator(".pack-picker").count() == 0
        status_copy = page.locator("#model-card .model-status").inner_text().lower()
        assert not any(term in status_copy for term in ("..", "path", "traversal", "unsafe", "zip_")), "public failure copy stays generic"
        finish_and_submit(page)
        saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
        assert saved["files"][0]["name"] == "escape.zip"
        site.assert_no_page_errors(allow_console_warnings=LOCAL_FALLBACK_WARNINGS)


def test_pack_selection_travels_as_request_text_without_integrations(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    with SiteBrowser(viewport=(1280, 1000)) as site:
        page = open_print_details(site)
        page.locator("#model-file").set_input_files(str(pack))
        page.locator(PICKER).wait_for()
        checkbox(page, 2).click()  # drop the arm
        expect(checkbox(page, 2)).not_to_be_checked()
        quantity(page, 1).fill("2")
        quantity(page, 1).press("Tab")
        expect(quantity(page, 1)).to_have_value("2")
        finish_and_submit(page)
        saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
        assert saved["specifications"]["packParts"] == "2 of 4 parts: parts/base.stl ×1; parts/lid.stl ×2"
        assert saved["specifications"]["packIgnored"] == "preview.png; NOTES.md"
        site.assert_no_page_errors(allow_console_warnings=LOCAL_FALLBACK_WARNINGS)


def test_pack_picker_fits_a_390_pixel_screen(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    for scheme in ("light", "dark"):
        with SiteBrowser(viewport=(390, 844), color_scheme=scheme, reduced_motion="reduce") as site:
            page = open_print_details(site)
            page.locator("#model-file").set_input_files(str(pack))
            page.locator(PICKER).wait_for()
            page.locator(PICKER).scroll_into_view_if_needed()
            expect(page.locator(PICKER)).to_be_visible()
            for index in range(4):
                expect(checkbox(page, index)).to_be_visible()
                expect(quantity(page, index)).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), scheme
            site.assert_no_page_errors()


def test_private_pack_estimate_submits_and_the_operator_sees_only_selected_parts(tmp_path: Path) -> None:
    pack = build_pack(tmp_path / "fixture-pack.zip")
    with running_operator_workspace() as (storefront, operator, store_path):
        with SiteBrowser(viewport=(1280, 1000)) as site:
            page = site.page
            puts: list[str] = []
            page.on("request", lambda req: puts.append(req.url) if req.method == "PUT" else None)
            page.goto(storefront + "/order.html?service=print", wait_until="networkidle")
            page.locator("#next-button").click()
            page.locator("#project-title").fill("Workspace pack")
            page.locator("#description").fill("Please print the selected pack parts in PLA.")

            is_pack_estimate = lambda response: response.url.endswith("/api/print-estimate") and response.request.method == "POST" and '"estimate-pack"' in (response.request.post_data or "")
            with page.expect_response(is_pack_estimate, timeout=20_000) as first:
                page.locator("#model-file").set_input_files(str(pack))
            assert first.value.status == 200
            initial = first.value.json()
            assert initial["status"] == "ready" and initial["pack"]["filename"] == "fixture-pack.zip"
            assert sorted(part["name"] for part in initial["pack"]["parts"]) == sorted([*GOOD_PARTS, BAD_PART])
            assert "print-estimates/" not in json.dumps(initial)
            page.locator(".model-private-verified").wait_for(timeout=15_000)
            assert "Uploaded privately and verified" in page.locator("#model-card").inner_text()

            # Deselect the arm and print two lids; the debounced preview reprices on the server.
            with page.expect_response(is_pack_estimate, timeout=10_000) as preview:
                checkbox(page, 2).click()
                quantity(page, 1).fill("2")
                quantity(page, 1).press("Tab")
            assert preview.value.status == 200
            sent = json.loads(preview.value.request.post_data)["selections"]
            assert sorted(item["quantity"] for item in sent) == [1, 2] and len(sent) == 2

            finish_and_submit(page)
            assert page.locator("#confirmation-title").inner_text() == "Your project request is in."
            assert "were not uploaded" not in page.locator("#confirmation-copy").inner_text()
            assert len(puts) == 1, f"the ZIP uploads exactly once: {puts}"
            site.assert_no_page_errors()

        state = json.loads((store_path.parent / "print-estimation-dev.json").read_text(encoding="utf-8"))
        attached = [asset for asset in state["assets"] if asset.get("requestId")]
        zip_row = next(asset for asset in attached if asset["format"] == "zip")
        children = {asset["archiveEntry"]: asset for asset in attached if asset.get("parentAssetId") == zip_row["id"]}
        assert set(children) == {"parts/base.stl", "parts/lid.stl"}, "only selected parts attach to the request"
        assert (children["parts/base.stl"]["quantity"], children["parts/lid.stl"]["quantity"]) == (1, 2)
        assert "submission" in {row["purpose"] for row in state["estimates"]}

        with SiteBrowser(viewport=(1440, 1000)) as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").click()
            page.locator(".print-sheet").wait_for()
            sheet = page.locator(".print-sheet").inner_text()
            zip_text = page.locator(".print-file").filter(has_text="fixture-pack.zip").inner_text()
            assert "Not printed (ignored): preview.png (image), NOTES.md (document)" in zip_text
            parts = page.locator(".print-file-part")
            assert parts.count() == 2
            texts = [parts.nth(index).inner_text() for index in range(2)]
            assert "parts/base.stl" in texts[0] and "quantity 1" in texts[0]
            assert "parts/lid.stl" in texts[1] and "quantity 2" in texts[1]
            for absent in ("parts/arm.stl", BAD_PART, "not selected"):
                assert absent not in sheet, absent
            site.assert_no_page_errors()
