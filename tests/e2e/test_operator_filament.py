from __future__ import annotations

from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import json_request
from tests.e2e.test_api import project_request


def seed_filament_work(storefront: str, operator: str) -> str:
    payload = project_request()
    payload.update({"service": "print", "projectTitle": "Blue replacement bracket", "modelUrl": "https://example.com/part.stl", "specifications": {"material": "pla", "color": "blue", "grams": "20", "quantity": "1"}})
    status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": payload, "website": ""})
    assert status == 201, created
    status, _, complete = json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": payload, "uploadedFiles": []})
    assert status == 200, complete
    status, _, listing = json_request(storefront + "/api/operator-work", headers={"Origin": operator})
    return next(item["id"] for item in listing["items"] if item["requestId"] == created["id"])


def test_inventory_matching_operator_acceptance_and_email_fallback() -> None:
    with running_operator_workspace({"RESEND_API_KEY": "", "REQUEST_FROM_EMAIL": "", "REQUEST_TO_EMAIL": ""}) as (storefront, operator, _):
        work_id = seed_filament_work(storefront, operator)
        with SiteBrowser(viewport=(1440, 1000)) as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            page.get_by_role("button", name="Filament inventory", exact=True).click()
            page.get_by_label("Material key", exact=True).fill("pla")
            page.get_by_label("Color name", exact=True).fill("Violet blue")
            page.get_by_label("Color hex", exact=True).fill("#1000ff")
            page.get_by_label("On-hand grams", exact=True).fill("500")
            page.get_by_label("Purchase cost (cents)", exact=True).fill("2200")
            page.get_by_role("button", name="Save filament", exact=True).click()
            page.get_by_text("Violet blue", exact=False).first.wait_for()
            page.locator("#work-list .work-row").click()
            sheet = page.locator(".filament-sheet")
            sheet.get_by_text("Violet blue", exact=False).first.wait_for()
            assert "Substitution available" in sheet.inner_text()
            page.get_by_role("button", name="Inventory and matching limits").click()
            page.get_by_role("button", name="Preview against selected work").click()
            page.get_by_role("heading", name="Matching preview").wait_for()
            assert "close options" in page.locator(".filament-preview").inner_text()
            page.locator("#work-list .work-row").click()
            sheet.get_by_role("button", name="Create substitution proposal").click()
            sheet.get_by_role("button", name="Preview customer approval email").wait_for()
            sheet.get_by_label("Decision reason or response source").fill("Verbal call with customer")
            sheet.get_by_role("button", name="Accept on customer's behalf").click()
            sheet.get_by_text("Accepted · operator on behalf", exact=True).wait_for()
            sheet.get_by_label("Decision reason or response source").fill("Customer wants email confirmation")
            sheet.get_by_role("button", name="Reopen decision").click()
            sheet.get_by_role("button", name="Preview customer approval email").click()
            sheet.get_by_label("Customer approval message").wait_for()
            assert "Requested: pla" in sheet.get_by_label("Customer approval message").input_value()
            sheet.get_by_role("button", name="Send approval request").click()
            sheet.get_by_text("Delivery: unconfigured", exact=True).wait_for()
            assert "pending" in sheet.inner_text().lower()
            sheet.get_by_role("button", name="Preview customer approval email").click()
            assert sheet.get_by_label("Customer approval message").input_value()
            site.assert_no_page_errors()
        status, _, detail = json_request(storefront + f"/api/operator-work?id={work_id}", headers={"Origin": operator})
        assert detail["filamentMatching"]["requirements"][0]["proposal"]["status"] == "pending"


def test_inventory_and_matching_fit_390_pixels_and_adjust_thresholds() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        seed_filament_work(storefront, operator)
        with SiteBrowser(viewport=(390, 844), color_scheme="dark", reduced_motion="reduce") as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            page.get_by_role("button", name="Filament inventory", exact=True).click()
            page.get_by_label("Match mode").select_option("rgb")
            page.get_by_label("Red variance (0–255)").fill("45")
            page.get_by_role("button", name="Save matching settings").click()
            page.get_by_text("Matching settings saved.", exact=True).wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            page.get_by_role("button", name="Back to inbox", exact=True).click()
            page.locator("#work-list .work-row").click()
            page.locator(".filament-sheet").wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            site.assert_no_page_errors()


def test_multiple_candidates_further_bands_requirement_edit_and_deactivation() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        work_id = seed_filament_work(storefront, operator)
        def post(body):
            status, _, result = json_request(storefront + "/api/operator-print", method="POST", headers={"Origin": operator}, payload=body)
            assert status == 200, result
            return result
        for name, color in [("Near blue", "#1000ff"), ("Other blue", "#1500ff"), ("Further violet", "#5000ff")]:
            post({"action": "save-filament", "filament": {"material": "pla", "color": name, "colorHex": color, "spoolNominalGrams": 1000, "purchaseCostCents": 2000, "onHandGrams": 200}})
        post({"action": "save-filament-settings", "revision": 0, "settings": {"mode": "rgb", "red": 100, "green": 100, "blue": 100}})
        with SiteBrowser(viewport=(1440, 1000)) as site:
            page = site.page
            page.goto(operator + f"/work/{work_id}", wait_until="networkidle")
            sheet = page.locator(".filament-sheet")
            assert sheet.locator(".filament-candidate:visible").count() == 2
            assert sheet.get_by_role("radio").first.is_checked()
            sheet.get_by_text("1 further matches inside limits", exact=True).click()
            sheet.get_by_role("radio").last.check()
            sheet.get_by_role("button", name="Create substitution proposal").click()
            sheet.get_by_text("Offered: pla · Further violet", exact=True).wait_for()
            sheet.get_by_text("Review or correct filament requirements", exact=True).click()
            sheet.get_by_label("Requested color name or hex").fill("#ff0000")
            sheet.get_by_role("button", name="Save requirements", exact=True).click()
            sheet.get_by_text("Purchase needed", exact=True).wait_for()
            assert sheet.locator(".filament-proposal").count() == 0
            page.get_by_role("button", name="Inventory and matching limits").click()
            page.get_by_role("button", name="Edit Near blue", exact=True).click()
            page.get_by_label("Stock status").select_option("false")
            page.get_by_role("button", name="Save filament", exact=True).click()
            page.get_by_text("Filament saved.", exact=True).wait_for()
            assert "Inactive" in page.locator(".inventory-list").inner_text()
            site.assert_no_page_errors()
