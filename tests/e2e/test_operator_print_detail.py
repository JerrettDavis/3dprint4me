from __future__ import annotations

import json

from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.print_seed import fake_slicer_env, seed_print_request
from tests.support.server import json_request, request


def test_operator_job_sheet_shows_model_estimate_margin_history_and_signed_download() -> None:
    env = fake_slicer_env()
    with running_operator_workspace(env) as (storefront, operator, store_path):
        seeded = seed_print_request(storefront, store_path, title="Alignment bracket run", slice_env=env)

        status, _, listing = json_request(storefront + "/api/operator-work", headers={"Origin": operator})
        assert status == 200
        listed = json.dumps(listing).lower()
        assert "printestimation" not in listed and "margin" not in listed and "alignment-bracket.stl" not in listed, "the work list stays minimized"
        work_id = listing["items"][0]["id"]
        status, _, detail = json_request(storefront + f"/api/operator-work?id={work_id}", headers={"Origin": operator})
        print_detail = detail["printEstimation"]
        assert print_detail["available"] is True
        assert print_detail["latestEstimate"]["estimatorType"] == "slicer"
        assert print_detail["latestEstimate"]["engineVersion"] == "9.9.9"
        assert "print-estimates/" not in json.dumps(print_detail)

        assert request(storefront + f"/api/operator-print?resource=asset-download&workId={work_id}&assetId={seeded['assetId']}")[0] == 403, "no origin, no signed link"

        with SiteBrowser(viewport=(1440, 1000)) as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").click()
            sheet = page.locator(".print-sheet")
            sheet.wait_for()
            text = sheet.inner_text()
            for expected in ("Print estimate", "Source files", "alignment-bracket.stl", "20 × 20 × 20 mm", "Latest estimate", "Economic floor", "Internal cost", "Projected margin", "Passive machine", "Active labor", "prusaslicer-cli 9.9.9", "pla-0.20mm-standard", "Estimate history", "Slicer analysis", "Actual production"):
                assert expected in text, expected
            with page.expect_download() as download_info:
                page.get_by_role("button", name="Download alignment-bracket.stl").click()
            download = download_info.value
            assert download.suggested_filename == "alignment-bracket.stl"
            assert open(download.path(), "rb").read() == seeded["model"]
            page.get_by_label("Actual grams").fill("40")
            page.get_by_label("Machine hours").fill("5")
            page.get_by_role("button", name="Record run").click()
            page.locator(".print-runs table").wait_for()
            assert "grams" in page.locator(".print-runs").inner_text()
            site.assert_no_page_errors()


def test_operator_print_sheet_fits_a_390_pixel_screen() -> None:
    with running_operator_workspace() as (storefront, operator, store_path):
        seed_print_request(storefront, store_path, title="Mobile bracket")
        with SiteBrowser(viewport=(390, 844), color_scheme="dark", reduced_motion="reduce") as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").click()
            page.locator(".print-sheet").wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            site.assert_no_page_errors()
