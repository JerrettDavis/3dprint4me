from __future__ import annotations

from tests.e2e.test_api import project_request
from tests.support.browser_harness import SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import json_request


def test_intake_to_interactive_work_inbox() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": request, "website": ""})
        assert status == 201
        status, _, completed = json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": request, "uploadedFiles": []})
        assert status == 200 and completed["live"] is True

        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            assert page is not None
            page.goto(operator, wait_until="networkidle")
            page.locator("#workspace:not([hidden])").wait_for()
            assert page.locator("#work-list .work-row").count() == 1
            assert page.locator("#work-list").inner_text().find(request["projectTitle"]) >= 0
            page.locator("#work-list .work-row").click()
            page.locator("#detail-content:not([hidden])").wait_for()
            page.get_by_role("button", name="Acknowledge").click()
            page.locator(".job-heading .kicker").get_by_text("revision 2").wait_for()
            page.locator("#detail-content").get_by_label("Priority").select_option("high")
            page.locator(".job-heading .kicker").get_by_text("revision 3").wait_for()
            page.locator("#private-note").fill("Confirm the build plate choice before slicing.")
            page.get_by_role("button", name="Add private note").click()
            page.locator(".job-heading .kicker").get_by_text("revision 4").wait_for()
            page.reload(wait_until="networkidle")
            page.locator("#work-list .work-row").click()
            page.locator("#detail-content").get_by_text("Confirm the build plate choice before slicing.").wait_for()
            assert page.evaluate("() => Object.keys(localStorage).length") == 0
            site.assert_no_page_errors()


def test_operator_mobile_shell_has_no_horizontal_overflow() -> None:
    with running_operator_workspace() as (_, operator, _):
        with SiteBrowser(viewport=(390, 844), color_scheme="dark", reduced_motion="reduce") as site:
            page = site.page
            assert page is not None
            page.goto(operator, wait_until="networkidle")
            page.locator("#workspace:not([hidden])").wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
            site.assert_no_page_errors()
