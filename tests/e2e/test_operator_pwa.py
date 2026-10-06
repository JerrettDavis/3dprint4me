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
            toast = page.locator("#toast")
            toast.wait_for(state="visible")
            assert "Acknowledged" in toast.inner_text() and "revision 2" in toast.inner_text()
            assert page.get_by_role("button", name="Acknowledge").count() == 0
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


RECORD_AUTH_VIEW = """
window.__authVisibility = [];
new MutationObserver(() => {
  const visible = id => { const node = document.querySelector(id); return Boolean(node) && !node.hidden; };
  const frame = [visible('#session-view') ? 'checking' : '', visible('#auth-view') ? 'sign-in' : '', visible('#workspace') ? 'workspace' : ''].filter(Boolean).join('+') || 'none';
  if (window.__authVisibility.at(-1) !== frame) window.__authVisibility.push(frame);
}).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
"""


def test_sign_in_progression_is_checking_then_workspace_without_a_sign_in_flash() -> None:
    with running_operator_workspace() as (_, operator, _store):
        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            page.add_init_script(RECORD_AUTH_VIEW)
            page.goto(operator, wait_until="networkidle")
            page.locator("#workspace:not([hidden])").wait_for()
            frames = page.evaluate("window.__authVisibility")
            assert "sign-in" not in "|".join(frames), frames
            assert frames[-1] == "workspace", frames


def test_returning_from_sign_in_survives_transient_401_without_flipping_to_signed_out() -> None:
    with running_operator_workspace() as (_, operator, _store):
        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            page.add_init_script(RECORD_AUTH_VIEW)
            page.add_init_script("sessionStorage.setItem('operator-sign-in-pending', '1')")
            seen = {"count": 0}

            def session(route):
                if route.request.method == "OPTIONS":
                    route.continue_()
                    return
                seen["count"] += 1
                if seen["count"] <= 2:
                    route.fulfill(status=401, headers={"access-control-allow-origin": operator, "access-control-allow-credentials": "true", "content-type": "application/json"}, body='{"error":"signed out"}')
                else:
                    route.continue_()

            page.context.route("**/api/operator-session", session)
            page.goto(operator, wait_until="networkidle")
            page.locator("#workspace:not([hidden])").wait_for(timeout=15000)
            frames = page.evaluate("window.__authVisibility")
            assert seen["count"] >= 3
            assert "sign-in" not in "|".join(frames), frames
            assert page.evaluate("sessionStorage.getItem('operator-sign-in-pending')") is None


def test_controls_show_pointer_cursor_and_react_to_hover() -> None:
    with running_operator_workspace() as (storefront, operator, _store):
        request = project_request()
        created = json_request(storefront + "/api/request", method="POST", payload={"request": request, "website": ""})[2]
        json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": request, "uploadedFiles": []})
        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            page.goto(operator, wait_until="networkidle")
            row = page.locator("#work-list .work-row")
            assert row.evaluate("node => getComputedStyle(node).cursor") == "pointer"
            item = page.locator("#work-list li")
            before = item.evaluate("node => getComputedStyle(node).backgroundColor")
            item.hover()
            page.wait_for_timeout(400)
            assert item.evaluate("node => getComputedStyle(node).backgroundColor") != before
            row.click()
            ack = page.get_by_role("button", name="Acknowledge")
            assert ack.evaluate("node => getComputedStyle(node).cursor") == "pointer"
            ack_before = ack.evaluate("node => getComputedStyle(node).backgroundColor")
            ack.hover()
            page.wait_for_timeout(400)
            assert ack.evaluate("node => getComputedStyle(node).backgroundColor") != ack_before


def test_failed_work_update_shows_a_visible_error_and_stays_usable() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": request, "website": ""})
        assert status == 201
        json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": request, "uploadedFiles": []})

        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            assert page is not None
            page.add_init_script("delete Navigator.prototype.serviceWorker")  # service workers bypass page.route
            page.goto(operator, wait_until="networkidle")
            row = page.locator("#work-list .work-row")
            row.wait_for()
            row.click()
            page.locator("#work-list li[data-active='true']").wait_for()
            ack = page.get_by_role("button", name="Acknowledge")
            ack.wait_for()
            page.route("**/api/operator-work-update", lambda route: route.fulfill(status=503, content_type="application/json", body='{"error":"Operator service is temporarily unavailable."}'))
            ack.click()
            toast = page.locator("#toast")
            toast.wait_for(state="visible")
            assert "temporarily unavailable" in toast.inner_text()
            assert page.locator("#work-list .work-row").count() == 1
            assert page.get_by_role("button", name="Acknowledge").is_enabled()
            assert not site.page_errors  # the stubbed 503 legitimately logs a console resource error


def test_attached_files_list_a_download_button_per_stored_file() -> None:
    with running_operator_workspace() as (storefront, operator, _):
        request = project_request()
        status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": request, "website": ""})
        assert status == 201
        files = [
            {"name": "bracket.stl", "size": 1200, "type": "model/stl", "path": f"{created['id']}/bracket.stl", "mode": "signed"},
            {"name": "notes.txt", "size": 20, "type": "text/plain", "mode": "metadata"},
        ]
        status, _, _ = json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": request, "uploadedFiles": files})
        assert status == 200

        with SiteBrowser(viewport=(1280, 900)) as site:
            page = site.page
            assert page is not None
            page.goto(operator, wait_until="networkidle")
            page.locator("#work-list .work-row").click()
            page.locator(".request-files").wait_for()
            assert page.get_by_role("button", name="Download bracket.stl").count() == 1
            assert page.get_by_role("button", name="Download notes.txt").count() == 0
            assert "Name only" in page.locator(".request-files").inner_text()
            site.assert_no_page_errors()
