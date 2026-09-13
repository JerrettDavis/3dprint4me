from __future__ import annotations

import json
import re
import pytest

from tests.support.browser_harness import SiteBrowser


@pytest.mark.parametrize("service", ["print", "design", "repair", "consult"])
def test_each_service_submits_only_its_own_specification_fields(service: str) -> None:
    service_fields = {
        "print": {"sizeClass", "material", "quantity", "quality", "colors", "finish", "grams", "machineHours"},
        "design": {"complexity", "sourceQuality", "deliverable", "includePrint"},
        "repair": {"printerModel", "repairType", "recentChange"},
        "consult": {"consultType", "meetingFormat", "consultOutcome"},
    }
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load(f"/order.html?service={service}")
        page.locator("#next-button").click()
        page.locator("#project-title").fill(f"{service.title()} project")
        page.locator("#description").fill("A detailed request with enough context for a human review and a written quote.")
        if service == "print":
            page.locator("#model-url").fill("https://example.com/model.stl")
        if service == "repair":
            page.locator("#printer-model").fill("Voron 2.4")
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()
        page.locator("#submission-state.visible").wait_for(state="visible")

        saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))[0]
        assert saved["service"] == service
        specs = saved["specifications"]
        assert not {"projectFiles", "preferredContact", "modelUrl", "deadline", "service"}.intersection(specs)
        assert {"print": "material", "design": "complexity", "repair": "printerModel", "consult": "consultType"}[service] in specs
        for other_service, fields in service_fields.items():
            if other_service != service:
                assert not fields.intersection(specs), f"{service} submitted {other_service} fields: {specs}"
        site.assert_no_page_errors(allow_console_warnings=(
            "Backend unavailable; preserving a local request copy.",
            "Could not complete remote delivery; preserving locally.",
        ))


def test_service_query_preselects_matching_intake_and_quote() -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?service=repair")
        assert page.locator("#service-repair").is_checked()
        assert page.locator("[data-service-panel='repair']").evaluate("el => el.classList.contains('visible')")
        assert not page.locator("[data-service-panel='print']").evaluate("el => el.classList.contains('visible')")
        assert page.locator("#estimate-amount").inner_text() == "$49–$69"
        site.assert_no_page_errors()


def test_stripe_return_url_does_not_claim_payment_was_verified() -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?payment=success")
        message = page.locator("#toast-region").inner_text().lower()
        assert "deposit received" not in message
        assert "receipt" in message
        site.assert_no_page_errors()


def test_server_rejection_keeps_request_editable_instead_of_claiming_local_success() -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?service=repair")
        page.evaluate("""() => {
          window.fetch = async (url, options = {}) => {
            if (url === '/api/request' && options.method === 'POST') {
              return new Response(JSON.stringify({ error: 'Please correct the project details.' }), {
                status: 400, headers: { 'content-type': 'application/json' }
              });
            }
            throw new Error(`Unexpected fetch: ${url}`);
          };
        }""")
        page.locator("#next-button").click()
        page.locator("#project-title").fill("Repair request")
        page.locator("#description").fill("Please diagnose a printer that skips layers during routine printing.")
        page.locator("#printer-model").fill("Voron 2.4")
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()

        page.wait_for_timeout(150)
        assert not page.locator("#submission-state").is_visible()
        assert "Please correct the project details." in page.locator("#toast-region").inner_text()
        assert page.locator("#submit-button").is_enabled()
        assert page.evaluate("localStorage.getItem('3dp-submitted-requests')") is None
        assert page.evaluate("localStorage.getItem('3dp-project-draft-v1')") is not None
        assert not site.page_errors


def test_create_server_error_preserves_local_handoff_without_completing_local_id() -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?service=consult")
        page.evaluate("""() => {
          window.__patchCalled = false;
          window.fetch = async (url, options = {}) => {
            if (url === '/api/request' && options.method === 'POST') {
              return new Response(JSON.stringify({ error: 'Temporary server failure.' }), {
                status: 503, headers: { 'content-type': 'application/json' }
              });
            }
            if (url === '/api/request' && options.method === 'PATCH') {
              window.__patchCalled = true;
              return new Response(JSON.stringify({ error: 'Invalid request ID.' }), {
                status: 400, headers: { 'content-type': 'application/json' }
              });
            }
            throw new Error(`Unexpected fetch: ${url}`);
          };
        }""")
        page.locator("#next-button").click()
        page.locator("#project-title").fill("Printer setup advice")
        page.locator("#description").fill("Review the setup and provide a calibration plan for a new printer.")
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()

        page.locator("#submission-state.visible").wait_for(state="visible", timeout=5000)
        assert page.evaluate("window.__patchCalled") is False
        assert page.locator("#request-id").inner_text().startswith("LOCAL-")
        assert "not delivered" in page.locator("#confirmation-copy").inner_text().lower()
        assert page.locator("#email-request").get_attribute("href").startswith("mailto:hello@3dprint4.me")
        assert page.evaluate("localStorage.getItem('3dp-submitted-requests')") is not None
        site.assert_no_page_errors(allow_console_warnings=("Backend unavailable; preserving a local request copy.",))


def test_delivery_only_confirmation_says_selected_files_need_separate_email() -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?service=print")
        page.evaluate("""() => {
          window.fetch = async (url, options = {}) => {
            if (url === '/api/request' && options.method === 'POST') {
              return new Response(JSON.stringify({ id: '3DP-20260901-ABC123', mode: 'delivery', live: false }), {
                status: 201, headers: { 'content-type': 'application/json' }
              });
            }
            if (url === '/api/request' && options.method === 'PATCH') {
              return new Response(JSON.stringify({ id: '3DP-20260901-ABC123', mode: 'delivery', live: true, integrations: { email: true } }), {
                status: 200, headers: { 'content-type': 'application/json' }
              });
            }
            throw new Error(`Unexpected fetch: ${url}`);
          };
        }""")
        page.locator("#next-button").click()
        page.locator("#project-title").fill("Replacement bracket")
        page.locator("#description").fill("Print this small replacement bracket for an organizer.")
        page.locator("#model-url").fill("https://example.com/bracket.stl")
        page.locator("#project-files").set_input_files(files=[{
            "name": "bracket.stl", "mimeType": "model/stl", "buffer": b"solid bracket\nendsolid bracket\n"
        }])
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()

        page.locator("#submission-state.visible").wait_for(state="visible", timeout=5000)
        assert "attach" in page.locator("#confirmation-copy").inner_text().lower()
        assert "not uploaded" in page.locator("#confirmation-copy").inner_text().lower()
        site.assert_no_page_errors()


@pytest.mark.parametrize("backend_live", [False, True])
def test_storage_failure_still_allows_request_confirmation_and_download(tmp_path, backend_live: bool) -> None:
    with SiteBrowser(viewport=(1280, 900)) as site:
        page = site.load("/order.html?service=consult")
        page.locator("#next-button").click()
        page.locator("#project-title").fill("Printer setup advice")
        page.locator("#description").fill("Review the setup and provide a calibration plan for a new printer.")
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        if backend_live:
            page.evaluate("""() => {
              window.fetch = async (url, options = {}) => {
                if (url === '/api/request' && options.method === 'POST') {
                  return new Response(JSON.stringify({ id: '3DP-20260901-ABC123', mode: 'delivery', live: false }), {
                    status: 201, headers: { 'content-type': 'application/json' }
                  });
                }
                if (url === '/api/request' && options.method === 'PATCH') {
                  return new Response(JSON.stringify({ id: '3DP-20260901-ABC123', mode: 'delivery', live: true, integrations: { database: false, email: true, webhook: false } }), {
                    status: 200, headers: { 'content-type': 'application/json' }
                  });
                }
                throw new Error(`Unexpected fetch: ${url}`);
              };
            }""")
        page.evaluate("""() => {
          localStorage.setItem = () => { throw new DOMException('Storage blocked', 'QuotaExceededError'); };
          localStorage.removeItem = () => { throw new DOMException('Storage blocked', 'QuotaExceededError'); };
        }""")
        page.evaluate("document.querySelector('#project-form').dispatchEvent(new Event('input', { bubbles: true }))")
        assert page.locator("#draft-storage-note").is_visible()
        page.locator("#submit-button").click()
        page.locator("#submission-state.visible").wait_for(state="visible", timeout=5000)
        assert page.locator("#draft-storage-note").is_hidden()

        if backend_live:
            assert "project request is in" in page.locator("#confirmation-title").inner_text().lower()
            assert page.locator("#backend-note").is_hidden()
        else:
            assert "not saved" in page.locator("#confirmation-copy").inner_text().lower()
            assert "download" in page.locator("#confirmation-copy").inner_text().lower()
        with page.expect_download() as download_info:
            page.locator("#download-request").click()
        output = tmp_path / download_info.value.suggested_filename
        download_info.value.save_as(output)
        assert json.loads(output.read_text(encoding="utf-8"))["service"] == "consult"
        assert not site.page_errors


def test_print_request_wizard_validates_updates_quote_uploads_and_submits_locally(tmp_path) -> None:
    with SiteBrowser(viewport=(1365, 960)) as site:
        page = site.load("/order.html")
        starting_estimate = page.locator("#estimate-amount").inner_text()
        assert starting_estimate == "$20–$36"
        assert page.locator("#service-print").is_checked()

        page.locator("#next-button").click()
        assert page.locator("[data-step='1']").evaluate("el => el.classList.contains('active')")

        # Required fields provide targeted inline feedback and focus the first problem.
        page.locator("#next-button").click()
        assert page.locator("#project-title").get_attribute("aria-invalid") == "true"
        assert page.locator("#project-title").evaluate("el => el === document.activeElement")
        assert "short name" in page.locator("#project-title-error").inner_text()

        page.locator("#project-title").fill("PETG under-desk controller bracket")
        page.locator("#description").fill("Print a rigid bracket that holds a small controller under a desk and tolerates a warm office.")
        page.locator("#model-url").fill("https://www.printables.com/model/123456-example-bracket")
        page.locator("#material").select_option("petg")
        page.locator("#quantity").fill("3")
        page.locator("#quality").select_option("fine")
        page.locator("#colors").select_option("2")
        page.locator("#grams").fill("118")
        page.locator("#machine-hours").fill("5.5")

        page.locator("#project-files").set_input_files(
            files=[
                {
                    "name": "controller-bracket.stl",
                    "mimeType": "model/stl",
                    "buffer": b"solid bracket\nendsolid bracket\n",
                }
            ]
        )
        assert page.locator("#file-list .file-item").count() == 1
        assert "controller-bracket.stl" in page.locator("#file-list").inner_text()
        assert page.locator("#estimate-confidence").inner_text().startswith("Better estimate")
        assert page.locator("#estimate-amount").inner_text() != starting_estimate

        page.locator("#next-button").click()
        assert page.locator("[data-step='2']").evaluate("el => el.classList.contains('active')")
        page.locator("#name").fill("Jordan Customer")
        page.locator("#email").fill("jordan@example.com")
        page.locator("#delivery-shipping").check()
        page.locator("#next-button").click()
        assert page.locator("#address").get_attribute("aria-invalid") == "true"
        page.locator("#address").fill("123 Example Ave\nTulsa, OK 74103")
        page.locator("#next-button").click()

        review = page.locator("#review-card").inner_text()
        assert "PETG under-desk controller bracket" in review
        assert "Jordan Customer · jordan@example.com" in review
        assert "controller-bracket.stl" in review
        assert "shipping" in review

        page.locator("#terms").check()
        page.locator("#deposit-button").evaluate("el => { el.hidden = false; }")
        page.locator("#submit-button").click()
        page.locator("#submission-state.visible").wait_for(state="visible")
        request_id = page.locator("#request-id").inner_text()
        assert re.fullmatch(r"LOCAL-[A-F0-9-]{8}", request_id)
        assert page.locator("#backend-note").is_visible()
        assert "not delivered" in page.locator("#confirmation-copy").inner_text().lower()
        assert "email this request" in page.locator("#backend-note").inner_text().lower()
        assert page.locator("#email-request").get_attribute("href").startswith("mailto:hello@3dprint4.me")
        assert page.locator("#deposit-button").is_hidden()

        saved = json.loads(page.evaluate("localStorage.getItem('3dp-submitted-requests')"))
        assert saved[0]["id"] == request_id
        assert saved[0]["projectTitle"] == "PETG under-desk controller bracket"
        assert saved[0]["uploadedFiles"][0]["name"] == "controller-bracket.stl"

        with page.expect_download() as download_info:
            page.locator("#download-request").click()
        download = download_info.value
        assert download.suggested_filename == f"{request_id}-3dprint4me-request.json"
        output = tmp_path / download.suggested_filename
        download.save_as(output)
        exported = json.loads(output.read_text(encoding="utf-8"))
        assert exported["id"] == request_id

        site.assert_no_page_errors(
            allow_console_warnings=(
                "Backend unavailable; preserving a local request copy.",
                "Could not complete remote delivery; preserving locally.",
            )
        )


def test_supabase_mode_uses_signed_formdata_upload_and_completes_live_request() -> None:
    with SiteBrowser(viewport=(1365, 960)) as site:
        page = site.load("/order.html")
        page.evaluate(
            """() => {
              window.__uploadProbe = null;
              window.__completePayload = null;
              window.__checkoutPayload = null;
              window.fetch = async (url, options = {}) => {
                if (url === '/api/health') {
                  return new Response(JSON.stringify({ ok: true, integrations: { stripe: true } }), {
                    status: 200, headers: { 'content-type': 'application/json' }
                  });
                }
                if (url === '/api/request' && options.method === 'POST') {
                  return new Response(JSON.stringify({
                    id: '3DP-20260901-ABC123', mode: 'supabase', live: true
                  }), { status: 201, headers: { 'content-type': 'application/json' } });
                }
                if (url === '/api/upload-url') {
                  return new Response(JSON.stringify({
                    mode: 'signed',
                    method: 'PUT',
                    path: '3DP-20260901-ABC123/a1b2c3d4e5-test-part.stl',
                    uploadUrl: 'https://project.supabase.co/storage/v1/object/upload/sign/service-files/3DP-20260901-ABC123/a1b2c3d4e5-test-part.stl?token=example',
                    headers: { 'x-upsert': 'false' }
                  }), { status: 200, headers: { 'content-type': 'application/json' } });
                }
                if (String(url).startsWith('https://project.supabase.co/storage/v1/object/upload/sign/')) {
                  const entries = [];
                  for (const [key, value] of options.body.entries()) {
                    entries.push({
                      key,
                      value: value instanceof File ? null : String(value),
                      fileName: value instanceof File ? value.name : null,
                      fileSize: value instanceof File ? value.size : null,
                      fileType: value instanceof File ? value.type : null
                    });
                  }
                  window.__uploadProbe = {
                    method: options.method,
                    xUpsert: options.headers?.['x-upsert'],
                    isFormData: options.body instanceof FormData,
                    entries
                  };
                  return new Response(JSON.stringify({ Key: 'service-files/3DP-20260901-ABC123/a1b2c3d4e5-test-part.stl' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                  });
                }
                if (url === '/api/request' && options.method === 'PATCH') {
                  window.__completePayload = JSON.parse(options.body);
                  return new Response(JSON.stringify({
                    id: '3DP-20260901-ABC123',
                    mode: 'supabase',
                    live: true,
                    checkoutToken: 'signed-completion-proof',
                    integrations: { database: true, email: false, webhook: false }
                  }), { status: 200, headers: { 'content-type': 'application/json' } });
                }
                if (url === '/api/checkout') {
                  window.__checkoutPayload = JSON.parse(options.body);
                  return new Response(JSON.stringify({ error: 'Checkout is unavailable.' }), {
                    status: 503, headers: { 'content-type': 'application/json' }
                  });
                }
                throw new Error(`Unexpected fetch: ${url}`);
              };
            }"""
        )
        page.evaluate("refreshIntegrationState()")

        page.locator("#next-button").click()
        page.locator("#project-title").fill("Signed upload verification")
        page.locator("#description").fill("Verify that a selected STL uploads directly to the signed private object URL.")
        page.locator("#project-files").set_input_files(
            files=[{
                "name": "test-part.stl",
                "mimeType": "model/stl",
                "buffer": b"solid test\nendsolid test\n",
            }]
        )
        page.locator("#next-button").click()
        page.locator("#name").fill("Taylor Customer")
        page.locator("#email").fill("taylor@example.com")
        page.locator("#next-button").click()
        page.locator("#terms").check()
        page.locator("#submit-button").click()
        page.locator("#submission-state.visible").wait_for(state="visible")

        probe = page.evaluate("window.__uploadProbe")
        assert probe["method"] == "PUT"
        assert probe["xUpsert"] == "false"
        assert probe["isFormData"] is True
        assert probe["entries"][0] == {
            "key": "cacheControl",
            "value": "3600",
            "fileName": None,
            "fileSize": None,
            "fileType": None,
        }
        assert probe["entries"][1]["key"] == ""
        assert probe["entries"][1]["fileName"] == "test-part.stl"
        assert probe["entries"][1]["fileType"] == "model/stl"

        completed = page.evaluate("window.__completePayload")
        assert completed["uploadedFiles"] == [{
            "name": "test-part.stl",
            "size": 25,
            "type": "model/stl",
            "path": "3DP-20260901-ABC123/a1b2c3d4e5-test-part.stl",
            "mode": "signed",
        }]
        assert page.locator("#request-id").inner_text() == "3DP-20260901-ABC123"
        assert page.locator("#backend-note").is_hidden()
        assert "project request is in" in page.locator("#confirmation-title").inner_text().lower()
        assert page.locator("#deposit-button").is_visible()
        page.locator("#deposit-button").click()
        checkout = page.evaluate("window.__checkoutPayload")
        assert checkout["checkoutToken"] == "signed-completion-proof"
        assert checkout["requestId"] == "3DP-20260901-ABC123"
        site.assert_no_page_errors()
