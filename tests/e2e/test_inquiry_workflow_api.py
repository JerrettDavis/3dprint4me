from __future__ import annotations

import tempfile
from urllib.request import urlopen
from pathlib import Path

from tests.support.server import json_request, running_server
from tests.e2e.test_api import project_request
from tests.support.browser_harness import SiteBrowser
from playwright.sync_api import expect


def test_received_inquiry_enters_inbox_and_operator_can_prepare_and_share_without_sending() -> None:
    origin = "http://127.0.0.1:4180"
    with tempfile.TemporaryDirectory(prefix="3dp-inquiry-api-") as directory:
        with running_server(extra_env={"OPERATOR_DEV_AUTH": "1", "OPERATOR_ALLOWED_ORIGINS": origin,
                                       "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "work.json")}) as base:
            key = "a" * 64
            status, _, created = json_request(base + "/api/inquiry", method="POST", payload={
                "submissionKey": key, "inquiry": {"replyEmail": "customer@example.com", "message": "Can you help with a part?"}, "files": []})
            assert status == 201
            status, _, accepted = json_request(base + "/api/inquiry", method="PATCH", payload={"id": created["id"], "submissionKey": key})
            assert status == 200 and accepted["live"]
            headers = {"Origin": origin}
            status, _, inbox = json_request(base + "/api/operator-work?kind=inquiry", headers=headers)
            assert status == 200 and len(inbox["items"]) == 1
            item = inbox["items"][0]
            assert item["kind"] == "inquiry" and item["requestId"] is None
            status, _, invite = json_request(base + "/api/operator-work?resource=inquiries", method="POST", headers=headers,
                                             payload={"action": "invite", "workId": item["id"]})
            assert status == 200 and "#inquiry=" in invite["url"]
            with urlopen(invite["url"].split("#")[0]) as landing:
                assert landing.status == 200
            assert invite["url"].startswith(base + "/order.html#inquiry=")
            status, _, prefill = json_request(base + "/api/inquiry?kind=handoff", method="POST", payload={"action": "read", "token": invite["token"]})
            assert status == 200 and prefill["inquiry"]["replyEmail"] == "customer@example.com"
            assert "notes" not in prefill and "token" not in prefill
            status, _, prepared = json_request(base + "/api/operator-work?resource=inquiries", method="POST",
                                               headers={**headers, "Idempotency-Key": "test-key-00000000"},
                                               payload={"action": "prepare", "command": {"workId": item["id"], "revision": 1,
                                                                                         "title": "Replacement part", "service": "design"}})
            assert status == 200 and prepared["workId"] == item["id"]
            status, _, _ = json_request(base + f"/api/operator-work?id={item['id']}", headers=headers)
            assert status == 426
            status, _, detail = json_request(base + f"/api/operator-work?id={item['id']}&schema=2", headers=headers)
            assert status == 200 and detail["item"]["projectDraft"]
            assert detail["request"]["consent"] is False and detail["request"]["estimate"] is None


def test_customer_continuation_preserves_one_work_item_for_all_four_services_and_rejects_missing_capability() -> None:
    origin = "http://127.0.0.1:4180"
    with tempfile.TemporaryDirectory(prefix="3dp-inquiry-services-") as directory:
        with running_server(extra_env={"OPERATOR_DEV_AUTH": "1", "OPERATOR_ALLOWED_ORIGINS": origin,
                                       "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "work.json")}) as base:
            headers = {"Origin": origin}
            for number, service in enumerate(["print", "design", "repair", "consult"], start=1):
                key = str(number) * 64
                status, _, inquiry = json_request(base + "/api/inquiry", method="POST", payload={"submissionKey": key,
                    "inquiry": {"replyEmail": "customer@example.com", "message": "Help with this project"}, "files": []})
                assert status == 201
                status, _, _ = json_request(base + "/api/inquiry", method="PATCH", payload={"id": inquiry["id"], "submissionKey": key})
                assert status == 200
                status, _, invite = json_request(base + "/api/inquiry?kind=handoff", method="POST", payload={"action": "issue", "id": inquiry["id"], "submissionKey": key})
                assert status == 200
                payload = project_request()
                payload["service"] = service
                payload["specifications"] = {}
                if service != "print":
                    payload["modelUrl"] = None
                status, _, created = json_request(base + "/api/request", method="POST", payload={"request": payload, "handoffToken": invite["token"]})
                assert status == 201 and created["live"]
                status, _, denied = json_request(base + "/api/request", method="PATCH", payload={"id": created["id"], "request": payload, "uploadedFiles": []})
                assert status == 403
                status, _, completed = json_request(base + "/api/request", method="PATCH", payload={"id": created["id"], "request": payload,
                    "uploadedFiles": [], "handoffToken": invite["token"]})
                assert status == 200 and completed["live"] and completed["integrations"]["database"]
                status, _, again = json_request(base + "/api/request", method="PATCH", payload={"id": created["id"], "handoffToken": invite["token"]})
                assert status == 200 and again["replayed"] and again["checkoutToken"] is None
                status, _, inbox = json_request(base + "/api/operator-work?kind=request", headers=headers)
                assert status == 200 and len(inbox["items"]) == number


def test_private_invitation_prefills_only_its_customer_and_never_persists_the_capability() -> None:
    with tempfile.TemporaryDirectory(prefix="3dp-inquiry-browser-") as directory:
        with running_server(extra_env={"OPERATOR_DEV_AUTH": "1", "OPERATOR_DEV_STORE_PATH": str(Path(directory) / "work.json")}) as base:
            key = "a" * 64
            _, _, inquiry = json_request(base + "/api/inquiry", method="POST", payload={"submissionKey": key,
                "inquiry": {"name": "Inquiry Customer", "replyEmail": "person@example.com", "message": "Please help with this part"}, "files": []})
            json_request(base + "/api/inquiry", method="PATCH", payload={"id": inquiry["id"], "submissionKey": key})
            _, _, invite = json_request(base + "/api/inquiry?kind=handoff", method="POST", payload={"action": "issue", "id": inquiry["id"], "submissionKey": key})
            with SiteBrowser(viewport=(390, 844), color_scheme="dark") as site:
                page = site.goto(base + "/order.html")
                page.evaluate("localStorage.setItem('3dp-project-draft-v1', JSON.stringify({name:'Different person',description:'Unrelated draft',terms:true}))")
                page.goto(invite["url"])
                expect(page.locator("#inquiry-notice")).to_contain_text("Continue your inquiry")
                assert page.url.endswith("/order.html")
                assert page.locator("#name").input_value() == "Inquiry Customer"
                assert page.locator("#description").input_value() == "Please help with this part"
                assert not page.locator("#terms").is_checked()
                assert page.locator('[name="service"]:checked').count() == 0
                page.locator('label[for="service-design"]').click()
                page.locator("#next-button").click()
                page.locator("#project-title").fill("Inquiry project")
                page.locator("#next-button").click()
                page.locator("#next-button").click()
                page.locator("#terms").check()
                page.locator("#submit-button").click()
                expect(page.locator("#confirmation-title")).to_have_text("Your project request is in.")
                assert invite["token"] not in page.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
                assert "Different person" in page.evaluate("localStorage.getItem('3dp-project-draft-v1')")
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                site.assert_no_page_errors()
                page.goto(invite["url"])
                expect(page.locator("#inquiry-notice")).to_contain_text("already received")
                assert page.locator("#project-form").evaluate("form => form.inert")
