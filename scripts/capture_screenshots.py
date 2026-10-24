from __future__ import annotations

import sys
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.support.browser_harness import ROOT, SiteBrowser
from tests.support.operator_harness import running_operator_workspace
from tests.support.server import json_request, running_server
from tests.e2e.test_api import project_request
from tests.support.print_seed import FIXTURES, fake_slicer_env, seed_print_request

OUTPUT = ROOT / "screenshots"


def capture(route: str, filename: str, *, viewport: tuple[int, int], scheme: str, full_page: bool = False, prepare=None, storage_denied: bool = False) -> Path:
    path = OUTPUT / filename
    with SiteBrowser(viewport=viewport, color_scheme=scheme, device_scale_factor=1) as site:
        page = site.load(route, storage_denied=storage_denied)
        if prepare:
            prepare(page)
        page.wait_for_timeout(120)
        site.screenshot(path, full_page=full_page)
        site.assert_no_page_errors()
    return path


def prepare_design_details(page) -> None:
    page.locator("#service-design").check()
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Custom electronics enclosure")
    page.locator("#description").fill("A fitted, printable case around an ESP32 display, battery, and side-mounted controls.")
    page.locator("#complexity").select_option("assembly")
    page.locator("#source-quality").select_option("dimensions")
    page.locator("#deliverable").select_option("source")
    page.locator("#include-print").select_option("yes")


def prepare_print_details(page) -> None:
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Palm-size PLA bracket")
    page.locator("#description").fill("A palm-size bracket; slicer weight and time are not known yet.")
    page.locator("#model-url").fill("https://example.com/bracket.stl")


def prepare_print_model(page) -> None:
    prepare_print_details(page)
    page.locator("#model-file").set_input_files(str(FIXTURES / "two-cubes.3mf"))
    page.locator("#model-card[data-state='analyzed']").wait_for()
    page.locator("#quantity").fill("4")
    page.locator("#model-intake").scroll_into_view_if_needed()


def prepare_consult_details(page) -> None:
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Printer setup consultation")
    page.locator("#description").fill("Review the current setup and recommend a calibration plan.")


def prepare_referral_contact(page) -> None:
    prepare_consult_details(page)
    page.locator('#next-button').click()
    page.locator('#name').fill('Synthetic Customer')
    page.locator('#email').fill('synthetic@example.test')
    page.locator('#referral-consent').check()
    page.locator('#referral-code').fill('AbCdEfGh1234_-xy')
    page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)')


def prepare_mobile_repair(page) -> None:
    page.locator("#next-button").click()
    page.locator("#project-title").fill("Voron print-quality diagnosis")
    page.locator("#description").fill("Layer shifts and inconsistent first layers after replacing the toolhead wiring.")
    page.locator("#printer-model").fill("Voron 2.4")
    page.locator("#repair-type").select_option("tune")


def prepare_storage_warning(page) -> None:
    page.evaluate("document.querySelector('#project-form').dispatchEvent(new Event('input', { bubbles: true }))")


def show_work_record(page) -> None:
    page.locator(".work-record").scroll_into_view_if_needed()


def show_project_cards(page) -> None:
    page.locator(".portfolio-grid.designed-work").scroll_into_view_if_needed()


def show_inquiry(page) -> None:
    page.locator(".hero-actions [data-ask]").click()
    page.locator("#ask-message").fill("The clip on my vacuum broke. Could you make a replacement?")
    page.locator("#ask-email").fill("customer@example.com")


def show_project_dialog(page) -> None:
    page.locator(".hero-project").click()


def build_preview_board(items: list[tuple[str, Path]]) -> Path:
    width = 1680
    margin = 56
    gap = 34
    card_width = (width - margin * 2 - gap) // 2
    rendered: list[tuple[str, Image.Image]] = []
    for label, path in items:
        image = Image.open(path).convert("RGB")
        ratio = card_width / image.width
        resized = image.resize((card_width, int(image.height * ratio)), Image.Resampling.LANCZOS)
        if resized.height > 820:
            resized = resized.crop((0, 0, resized.width, 820))
        rendered.append((label, resized))

    row_heights = []
    for index in range(0, len(rendered), 2):
        row_heights.append(max(image.height for _, image in rendered[index:index + 2]) + 86)
    height = margin + sum(row_heights) + gap * (len(row_heights) - 1) + margin
    board = Image.new("RGB", (width, height), "#edf0f3")
    draw = ImageDraw.Draw(board)
    font = ImageFont.load_default(size=24)
    x_positions = [margin, margin + card_width + gap]
    y = margin
    for row_index, row_height in enumerate(row_heights):
        for column, (label, image) in enumerate(rendered[row_index * 2:row_index * 2 + 2]):
            x = x_positions[column]
            draw.rounded_rectangle((x - 2, y - 2, x + card_width + 2, y + image.height + 2), radius=18, fill="#cfd5dc")
            board.paste(image, (x, y))
            draw.text((x, y + image.height + 22), label, fill="#11151b", font=font)
        y += row_height + gap

    output = OUTPUT / "preview-board.png"
    board.save(output, optimize=True)
    return output


GENERATOR_READY = "body[data-build-state='ready']"


def capture_customize_states() -> list[tuple[str, Path]]:
    """Vite-built /customize pages need real HTTP (WASM, module worker, CSP), so they use the dev server."""
    captured: list[tuple[str, Path]] = []
    with running_server() as base_url:
        for label, route, filename, viewport, scheme, ready, prepare in [
            ("Customize catalog · desktop · light", "/customize/", "customize-catalog-desktop-light.png", (1440, 1000), "light", None, None),
            ("Customize catalog · mobile · dark", "/customize/", "customize-catalog-mobile-dark.png", (390, 844), "dark", None, None),
            ("Route shield · desktop · light", "/customize/g/route-shield/", "customize-route-shield-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, None),
            ("Route shield · desktop · dark", "/customize/g/route-shield/", "customize-route-shield-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, None),
            ("Route shield 3D · desktop · dark", "/customize/g/route-shield/", "customize-route-shield-3d-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, show_3d_preview),
            ("Route shield · mobile · light", "/customize/g/route-shield/", "customize-route-shield-mobile-light.png", (390, 844), "light", GENERATOR_READY, None),
            ("Route shield facts · mobile · dark", "/customize/g/route-shield/", "customize-route-shield-facts-mobile-dark.png", (390, 844), "dark", GENERATOR_READY, show_facts),
            ("Wi-Fi placard · desktop · light", "/customize/g/wifi-tag/", "customize-wifi-placard-desktop-light.png", (1440, 1000), "light", None, wifi_tag("placard")),
            ("Wi-Fi keychain · desktop · dark", "/customize/g/wifi-tag/", "customize-wifi-keychain-desktop-dark.png", (1440, 1000), "dark", None, wifi_tag("keychain")),
            ("Wi-Fi card · desktop · light", "/customize/g/wifi-tag/", "customize-wifi-card-desktop-light.png", (1440, 1000), "light", None, wifi_tag("card")),
            ("Wi-Fi placard · mobile · light", "/customize/g/wifi-tag/", "customize-wifi-placard-mobile-light.png", (390, 844), "light", None, wifi_tag("placard", mobile=True)),
            ("Wi-Fi keychain · mobile · dark", "/customize/g/wifi-tag/", "customize-wifi-keychain-mobile-dark.png", (390, 844), "dark", None, wifi_tag("keychain", mobile=True)),
            ("Wi-Fi card · mobile · light", "/customize/g/wifi-tag/", "customize-wifi-card-mobile-light.png", (390, 844), "light", None, wifi_tag("card", mobile=True)),
            ("Wi-Fi form · mobile · dark", "/customize/g/wifi-tag/", "customize-wifi-form-mobile-dark.png", (390, 844), "dark", None, wifi_tag("placard", mobile=True, show="form")),
            ("Rating card · desktop · light", "/customize/g/rating-card/", "customize-rating-card-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, None),
            ("Rating card · mobile · dark", "/customize/g/rating-card/", "customize-rating-card-mobile-dark.png", (390, 844), "dark", GENERATOR_READY, rating_card()),
            ("Rating card own image · desktop · light", "/customize/g/rating-card/", "customize-rating-card-image-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, rating_card(image=True)),
            ("Rating card own image · mobile · light", "/customize/g/rating-card/", "customize-rating-card-image-mobile-light.png", (390, 844), "light", GENERATOR_READY, rating_card(image=True, mobile=True)),
            ("Name plate raised (Pacifico) · desktop · light", "/customize/g/name-plate/", "customize-name-plate-raised-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(font="pacifico", name="Jordan")),
            ("Name plate outline (Bebas Neue) · desktop · dark", "/customize/g/name-plate/", "customize-name-plate-outline-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, name_plate(font="bebas-neue", name="Jordan", style="outline")),
            ("Name plate shadow (Bangers) · desktop · light", "/customize/g/name-plate/", "customize-name-plate-shadow-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(font="bangers", name="Maya", style="shadow", plate="rect")),
            ("Name plate inlay (Lobster) 3D · desktop · light", "/customize/g/name-plate/", "customize-name-plate-inlay-3d-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(font="lobster", name="Alex", style="inlay", view="3D")),
            ("Name plate keychain (Titan One) · desktop · dark", "/customize/g/name-plate/", "customize-name-plate-keychain-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, name_plate(font="titan-one", name="Sam", plate="none", loop=True)),
            ("Name plate keychain Lily (block) · desktop · light", "/customize/g/name-plate/", "customize-name-plate-keychain-lily-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(name="Lily", plate="none", loop=True)),
            ("Name plate keychain Mary Ann (Pacifico) · desktop · dark", "/customize/g/name-plate/", "customize-name-plate-keychain-mary-ann-pacifico-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, name_plate(font="pacifico", name="Mary Ann", plate="none", loop=True)),
            ("Name plate keychain Mary Ann (Bangers) · desktop · light", "/customize/g/name-plate/", "customize-name-plate-keychain-mary-ann-bangers-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(font="bangers", name="Mary Ann", plate="none", loop=True)),
            ("Name plate font picker · desktop · light", "/customize/g/name-plate/", "customize-name-plate-picker-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, name_plate(font="caveat-brush", name="Jordan", open_picker=True)),
            ("Name plate font picker · mobile · dark", "/customize/g/name-plate/", "customize-name-plate-picker-mobile-dark.png", (390, 844), "dark", GENERATOR_READY, name_plate(font="righteous", name="Jordan", open_picker=True)),
            ("Pumpkin cute · desktop · light", "/customize/g/pumpkin/", "customize-pumpkin-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, pumpkin()),
            ("Pumpkin lantern advanced · desktop · dark", "/customize/g/pumpkin/", "customize-pumpkin-lantern-advanced-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, pumpkin("Jack-o'-lantern", advanced=True)),
            ("Pumpkin bowl · desktop · light", "/customize/g/pumpkin/", "customize-pumpkin-bowl-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, pumpkin("Pumpkin bowl")),
            ("Display sign starter · desktop · light", "/customize/g/display-sign/", "customize-display-sign-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, display_sign()),
            ("Display sign Chef Curt 3D · desktop · dark", "/customize/g/display-sign/", "customize-display-sign-chef-curt-3d-desktop-dark.png", (1440, 1000), "dark", GENERATOR_READY, display_sign("Chef Curt: sign", view="3D")),
            ("Display sign Bradley's holder 3D · desktop · light", "/customize/g/display-sign/", "customize-display-sign-bradleys-holder-3d-desktop-light.png", (1440, 1000), "light", GENERATOR_READY, display_sign("Bradley's Bakery: holder", view="3D")),
            ("Display sign Bradley's · mobile · light", "/customize/g/display-sign/", "customize-display-sign-bradleys-mobile-light.png", (390, 844), "light", GENERATOR_READY, display_sign("Bradley's Bakery: sign")),
            ("Pumpkin knitted · mobile · dark", "/customize/g/pumpkin/", "customize-pumpkin-knitted-mobile-dark.png", (390, 844), "dark", GENERATOR_READY, pumpkin("Knitted pumpkin")),
        ]:
            path = OUTPUT / filename
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
                page = site.goto(base_url + route, ready_selector=ready)
                if prepare:
                    prepare(page)
                page.wait_for_timeout(400)
                site.screenshot(path, full_page=False)
                site.assert_no_page_errors(allow_console_warnings=("GL Driver Message", "GPU stall"))
            captured.append((label, path))
    return captured


def show_3d_preview(page) -> None:
    page.get_by_role("tab", name="3D").click()
    page.wait_for_timeout(400)


def scroll_in_panel(page, selector: str) -> None:
    """Scrolls a control to the top of its settings window. (Element.scrollIntoView would also
    scroll the document itself, which a studio page never does for a visitor.)"""
    page.evaluate("""(selector) => {
      const el = document.querySelector(selector);
      const body = el.closest('.cz-win-body');
      const sticky = body.querySelector('.cz-win-tools')?.offsetHeight ?? 0;
      body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - sticky - 8;
    }""", selector)


def show_facts(page) -> None:
    # Narrow screens: the facts live on the bottom sheet's second tab. Wide screens show them beside the canvas.
    tab = page.get_by_role("button", name="Facts", exact=True)
    if tab.is_visible():
        tab.click()
    page.wait_for_timeout(300)


def wifi_tag(fmt: str, *, mobile: bool = False, show: str = "preview"):
    """The Wi-Fi page needs a password before it builds; type a sample one, pick the format, wait for the model."""
    def prepare(page) -> None:
        page.get_by_label("Tag format").select_option(fmt)
        page.get_by_label("Network name (SSID)", exact=True).fill("Cafe Guest")
        page.get_by_label("Network password", exact=True).fill("correct-horse-battery")
        page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if show == "form":
            scroll_in_panel(page, "[data-field='ssid']")
        page.wait_for_timeout(600)
    return prepare


def paw_png() -> bytes:
    """A small bold test image (a paw print) generated in memory; nothing is read from disk."""
    import io
    img = Image.new("RGB", (600, 520), "white")
    draw = ImageDraw.Draw(img)
    draw.ellipse((170, 230, 430, 470), fill="black")
    for cx, cy in [(130, 190), (230, 110), (370, 110), (470, 190)]:
        draw.ellipse((cx - 55, cy - 70, cx + 55, cy + 70), fill="black")
    buffer = io.BytesIO()
    img.save(buffer, "PNG")
    return buffer.getvalue()


def rating_card(*, image: bool = False, mobile: bool = False):
    """Optionally trace a generated image, then show the preview (or the image controls)."""
    def prepare(page) -> None:
        if image:
            page.get_by_label("Icon", exact=True).select_option("custom")
            page.locator("#cz-image-file").set_input_files({"name": "paw.png", "mimeType": "image/png", "buffer": paw_png()})
            page.locator("#cz-image-preview:not([hidden])").wait_for(timeout=30000)
            page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if image and mobile:
            # The controls live in the bottom sheet's scrolling body; the studio itself never scrolls.
            scroll_in_panel(page, "#cz-image-area")
        page.wait_for_timeout(600)
    return prepare


def name_plate(*, font: str = "block", name: str = "Alex", style: str = "raised", plate: str = "pill", loop: bool = False, view: str | None = None, open_picker: bool = False):
    """Pick a font from the picker, set the name, style and plate, wait for the model; optionally show 3D or the open picker."""
    def prepare(page) -> None:
        page.locator("#cz-font-toggle").click()
        page.locator(f"label[for='cz-font-{font}']").click()
        page.get_by_label("Name", exact=True).fill(name)
        page.get_by_label("Name", exact=True).press("Tab")
        page.get_by_label("Style", exact=True).select_option(style)
        page.get_by_label("Plate", exact=True).select_option(plate)
        if loop:
            page.get_by_label("Keychain loop on the left").check()
        page.wait_for_timeout(300)
        page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if view:
            page.get_by_role("tab", name=view).click()
        if open_picker:
            page.locator("#cz-font-toggle").click()
            scroll_in_panel(page, "[data-field='font']")
            page.evaluate("document.fonts.ready.then(() => true)")
        page.wait_for_timeout(600)
    return prepare


def pumpkin(design: str | None = None, *, advanced: bool = False):
    """Optionally start from a named design and switch to Advanced; wait for the model."""
    def prepare(page) -> None:
        page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if design:
            page.evaluate("""(label) => { const n = [...document.querySelectorAll('.cz-design-name')].find(e => e.textContent.trim() === label); n.closest('button').click(); }""", design)
            page.wait_for_timeout(400)
            page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if advanced:
            page.get_by_role("button", name="Advanced", exact=True).click()
        page.wait_for_timeout(700)
    return prepare


def display_sign(design: str | None = None, *, view: str | None = None):
    """Optionally start from a named design and switch the preview view; wait for the model."""
    def prepare(page) -> None:
        page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if design:
            page.evaluate("""(label) => { const n = [...document.querySelectorAll('.cz-design-name')].find(e => e.textContent.trim() === label); n.closest('button').click(); }""", design)
            page.wait_for_timeout(500)
            page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if view:
            page.locator(f'button[data-view="{view.lower()}"]').click()
        page.wait_for_timeout(900)
    return prepare


def capture_operator_states() -> list[tuple[str, Path]]:
    captured: list[tuple[str, Path]] = []
    slicer = fake_slicer_env()
    with running_operator_workspace(slicer) as (storefront, operator, store_path):
        seed_print_request(storefront, store_path, title="Alignment bracket, 4-up PLA", slice_env=slicer)
        payload = project_request()
        payload["projectTitle"] = "Replacement alignment bracket"
        status, _, created = json_request(storefront + "/api/request", method="POST", payload={"request": payload, "website": ""})
        assert status == 201
        status, _, _ = json_request(storefront + "/api/request", method="PATCH", payload={"id": created["id"], "request": payload, "uploadedFiles": []})
        assert status == 200
        for label, filename, viewport, scheme, open_detail in [
            ("Operator inbox · desktop · light", "operator-inbox-desktop-light.png", (1440, 1000), "light", False),
            ("Operator job sheet · desktop · dark", "operator-detail-desktop-dark.png", (1440, 1000), "dark", True),
            ("Operator job sheet · mobile · light", "operator-detail-mobile-light.png", (390, 844), "light", True),
            ("Operator print estimate · desktop · light", "operator-print-estimate-desktop-light.png", (1440, 1000), "light", "print"),
            ("Operator print estimate · mobile · dark", "operator-print-estimate-mobile-dark.png", (390, 844), "dark", "print"),
            ("Operator invoice draft · desktop · light", "operator-invoice-desktop-light.png", (1440, 1000), "light", "invoice"),
            ("Operator invoice form · mobile · dark", "operator-invoice-mobile-dark.png", (390, 844), "dark", "invoice-form"),
        ]:
            path = OUTPUT / filename
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce", service_workers="block" if str(open_detail).startswith("invoice") else "allow") as site:
                page = site.page
                assert page is not None
                if str(open_detail).startswith("invoice"):
                    operation = None if open_detail == "invoice-form" else {"state": "draft", "totals": {"subtotalCents": 14000, "taxCents": 1192, "totalCents": 15192}, "provider": {"number": "3DP-2026-example", "status": "draft", "balanceCents": 15192, "editorUrl": "https://app.invoicing.co/#/invoices/invoice123/edit"}}
                    def invoice_route(route):
                        route.fulfill(status=200, content_type="application/json", body=json.dumps({"configured": True, "operation": operation}), headers={"Access-Control-Allow-Origin": operator, "Access-Control-Allow-Credentials": "true"})
                    page.route("**/api/operator-work?resource=invoices*", invoice_route)
                page.goto(operator, wait_until="networkidle")
                page.locator("#workspace:not([hidden])").wait_for()
                if open_detail == "print":
                    page.locator("#work-list .work-row", has_text="4-up PLA").click()
                    page.locator(".print-sheet").wait_for()
                    page.evaluate("document.querySelector('.print-sheet').scrollIntoView({ block: 'start' })")
                elif open_detail:
                    page.locator("#work-list .work-row", has_text="Replacement alignment bracket").click()
                    page.locator("#detail-content:not([hidden])").wait_for()
                    if str(open_detail).startswith("invoice"):
                        panel = page.locator(".invoice-sheet")
                        if open_detail == "invoice-form":
                            panel.locator("summary").click()
                        else:
                            panel.get_by_text("Draft ready for review", exact=True).wait_for()
                        panel.scroll_into_view_if_needed()
                site.screenshot(path, full_page=False)
                site.assert_no_page_errors(allow_console_warnings=["Service Worker registration blocked by Playwright"] if str(open_detail).startswith("invoice") else [])
            captured.append((label, path))
    return captured


def capture_inquiry_workflow_states():
    captured = []
    for scheme in ['light', 'dark']:
        with running_operator_workspace() as (storefront, operator, _):
            key = 'a' * 64
            _, _, inquiry = json_request(storefront + '/api/inquiry', method='POST', payload={'submissionKey': key, 'inquiry': {'name': 'Example customer', 'replyEmail': 'customer@example.com', 'message': 'Can you help replace a broken desk knob?'}, 'files': []})
            json_request(storefront + '/api/inquiry', method='PATCH', payload={'id': inquiry['id'], 'submissionKey': key})
            with SiteBrowser(viewport=(390, 844), color_scheme=scheme, reduced_motion='reduce') as site:
                page = site.goto(operator)
                page.locator('#work-list button').first.click()
                page.get_by_role('button', name='Create project draft').wait_for()
                path = OUTPUT / f'operator-inquiry-detail-{scheme}.png'
                site.screenshot(path, full_page=True)
                captured.append((f'Inquiry needing response · mobile · {scheme}', path))
                page.get_by_label('Project service').select_option('design')
                page.get_by_label('Project title').fill('Replacement desk knob')
                page.get_by_label('I reviewed the copied contact and inquiry context.').check()
                page.get_by_role('button', name='Create project draft').click()
                page.locator('.draft-badge').wait_for()
                path = OUTPUT / f'operator-inquiry-{scheme}.png'
                site.screenshot(path, full_page=True)
                captured.append((f'Inquiry converted to incomplete project · mobile · {scheme}', path))
                site.assert_no_page_errors()
    return captured


def capture_filament_states() -> list[tuple[str, Path]]:
    from tests.e2e.test_operator_filament import seed_filament_work
    captured = []
    with running_operator_workspace({"RESEND_API_KEY": "", "REQUEST_FROM_EMAIL": "", "REQUEST_TO_EMAIL": ""}) as (storefront, operator, _):
        work_id = seed_filament_work(storefront, operator)
        for name, color in [("Violet blue", "#1000ff"), ("Deep blue", "#1500ff"), ("Further purple", "#5000ff")]:
            status, _, _ = json_request(storefront + "/api/operator-print", method="POST", headers={"Origin": operator}, payload={"action": "save-filament", "filament": {"material": "pla", "brandLine": "Workshop PLA", "color": name, "colorHex": color, "spoolNominalGrams": 1000, "onHandGrams": 500, "purchaseCostCents": 2200}})
            assert status == 200
        for state, viewport, scheme in [("inventory", (1440, 1000), "light"), ("inventory", (390, 844), "dark"), ("matching", (1440, 1000), "dark"), ("matching", (390, 844), "light"), ("proposal", (1440, 1000), "light")]:
            filename = f"operator-filament-{state}-{'mobile' if viewport[0] == 390 else 'desktop'}-{scheme}.png"
            path = OUTPUT / filename
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
                page = site.page
                page.goto(operator + f"/work/{work_id}", wait_until="networkidle")
                page.locator(".filament-sheet").wait_for()
                if state == "inventory":
                    page.get_by_role("button", name="Filament inventory", exact=True).click()
                    page.locator(".filament-inventory").wait_for()
                elif state == "proposal":
                    page.get_by_role("button", name="Create substitution proposal").click()
                    page.get_by_role("button", name="Preview customer approval email").click()
                    page.get_by_label("Customer approval message").wait_for()
                    page.evaluate("document.querySelector('.filament-proposal').scrollIntoView({block:'start'})")
                else:
                    page.evaluate("document.querySelector('.filament-sheet').scrollIntoView({block:'start'})")
                site.screenshot(path, full_page=False)
                site.assert_no_page_errors()
            captured.append((f"Filament {state} · {'mobile' if viewport[0] == 390 else 'desktop'} · {scheme}", path))
    return captured


def capture_spoolman_states() -> list[tuple[str, Path]]:
    from datetime import datetime, timezone
    captured = []
    with running_operator_workspace({"SPOOLMAN_UI_ORIGIN": "https://spoolman.example.test"}) as (_, operator, store_path):
        stamp = datetime.now(timezone.utc).isoformat()
        source = {"instanceId": "example", "spoolId": 7, "rawMaterial": "PLA", "materialKnown": True, "remainingGrams": 800.9, "initialGrams": 1000, "nominalGrams": 1000, "priceBasisGrams": 1000, "currency": "USD", "appearanceReview": False, "colors": []}
        row = {"id": "fil_example0007", "revision": 1, "material": "pla", "brandLine": "Example filament", "color": "Blue", "colorHex": "#0044ff", "spoolNominalGrams": 1000, "purchaseCostCents": None, "freightFeeCents": 0, "costOverrideCents": None, "onHandGrams": 800, "active": True, "estimateDefault": False, "notes": None, "createdAt": stamp, "updatedAt": stamp, "source": source}
        state = {"version": 1, "filament": [row], "spoolman": {"configured": True, "instanceId": "example", "lastSuccessAt": stamp, "lastAttemptAt": stamp, "count": 1, "currency": "USD"}}
        (store_path.parent / "print-estimation-dev.json").write_text(json.dumps(state), encoding="utf-8")
        for viewport, scheme in [((1440, 1000), "light"), ((390, 844), "dark")]:
            path = OUTPUT / f"operator-spoolman-{'mobile' if viewport[0] == 390 else 'desktop'}-{scheme}.png"
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
                page = site.page
                page.goto(operator, wait_until="networkidle")
                page.get_by_role("button", name="Filament inventory", exact=True).click()
                page.get_by_text("Spoolman sync", exact=True).wait_for()
                site.screenshot(path, full_page=False)
                site.assert_no_page_errors()
            captured.append((f"Spoolman inventory · {'mobile' if viewport[0] == 390 else 'desktop'} · {scheme}", path))
    return captured


def capture_partner_states() -> list[tuple[str, Path]]:
    from tests.support.partner_harness import running_partner_shell
    from tests.e2e.test_partner_shell import install_partner_fixture, install_offer_fixture, install_referral_fixture, GIG_ID
    from tests.e2e.test_partner_visits import visit_fixture, GIG
    captured = []
    with running_partner_shell() as origin:
        for state, viewport, scheme in [("sign-in", (390, 844), "light"), ("overview", (390, 844), "dark"), ("agreement", (1440, 1000), "light"), ("visit", (390, 844), "light"), ("visit-contact", (390, 844), "dark"), ("drafts", (390, 844), "dark"), ("counteroffer", (390, 844), "dark"), ("counteroffer", (320, 844), "light"), ("referrals", (390, 844), "dark"), ("referrals", (320, 844), "light")]:
            path = OUTPUT / f"partner-{state}-{scheme}.png"
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
                visit_state = state in ["visit", "visit-contact", "drafts"]
                if state == "referrals":
                    data = install_referral_fixture(site.page)
                    data["items"][0]["bonusRules"][0]["criteria"] = "An independent purchase with full settlement verified by the owner."
                elif state == "counteroffer":
                    _, negotiation = install_offer_fixture(site.page)
                    negotiation[0]["message"] = "Revised fee for the additional materials; please review before accepting."
                elif visit_state:
                    visit_fixture(site.page)
                else:
                    install_partner_fixture(site.page, signed_in=state != "sign-in")
                site.page.goto(origin + ('/referrals' if state == 'referrals' else '/gigs/' + GIG_ID if state == 'counteroffer' else '/visits/new?gig=' + GIG if visit_state else '/agreements' if state == 'agreement' else '/'))
                site.page.get_by_role('heading', level=1).wait_for()
                if visit_state:
                    site.page.get_by_label('Business name', exact=True).fill('Synthetic Coffee')
                    if state == 'visit-contact':
                        site.page.get_by_label('This person explicitly agreed to project follow-up.', exact=True).check()
                        site.page.get_by_label('Project follow-up purpose', exact=True).fill('Requested discussion about a printed shop sign')
                        site.page.get_by_label('Contact email', exact=True).fill('synthetic@example.test')
                    if state == 'drafts':
                        site.page.get_by_label('I understand this business-only draft stays on this device and is deleted when I sign out.', exact=True).check()
                        site.page.get_by_role('button', name='Save business draft on this device', exact=True).click()
                        site.page.get_by_role('link', name='Device drafts', exact=True).click()
                        site.page.get_by_role('heading', name='Device drafts').wait_for()
                if state == 'counteroffer':
                    site.page.get_by_label('Proposed fee (USD)', exact=True).fill('12.34')
                    site.page.get_by_label('Message to the owner', exact=True).fill('Could this fee cover the additional materials?')
                if visit_state or state in ['counteroffer', 'referrals']:
                    site.page.evaluate("document.activeElement?.blur(); window.scrollTo(0, 0)")
                site.screenshot(path, full_page=visit_state or state in ["counteroffer", "referrals"])
                site.console = [e for e in site.console if 'status of 401 (Unauthorized)' not in e.text]
                site.assert_no_page_errors()
            captured.append((f"Partner {state} · {scheme}", path))
    return captured


def capture_partner_owner_states() -> list[tuple[str, Path]]:
    from tests.e2e.test_partner_owner import install_owner_fixture, install_access_fixture
    from tests.e2e.test_partner_owner_referrals import install_review_fixture
    from tests.e2e.test_partner_owner_finance import install_finance_fixture, BATCH
    from tests.e2e.test_partner_owner_legal import install_legal_fixture, VERSION
    from tests.e2e.test_partner_owner_review import review_fixture, PACKAGE, FEEDBACK
    from tests.e2e.test_partner_shell import GIG_ID, PARTNER
    captured=[]
    with running_operator_workspace() as (_,origin,_):
        for state,viewport,scheme in [('programs',(320,844),'light'),('programs',(390,844),'dark'),('campaigns',(390,844),'dark'),('gig',(1440,1000),'light'),('accounts',(390,844),'dark'),('accounts',(320,844),'light'),('leads',(390,844),'dark'),('leads',(320,844),'light'),('leads-suppressed',(390,844),'dark'),('referrals',(390,844),'dark'),('referrals',(320,844),'light'),('finance',(390,844),'dark'),('finance',(320,844),'light'),('accounting-export',(390,844),'dark'),('accounting-export',(320,844),'light'),('legal',(390,844),'dark'),('legal',(320,844),'light'),('legal-version',(390,844),'dark'),('legal-version',(320,844),'light'),('review-create',(390,844),'dark'),('review-create',(320,844),'light'),('review-package',(390,844),'dark'),('review-package',(320,844),'light'),('review-feedback',(390,844),'dark'),('review-feedback',(320,844),'light')]:
            path=OUTPUT/f'operator-partners-{state}-{scheme}.png'
            with SiteBrowser(viewport=viewport,color_scheme=scheme,reduced_motion='reduce') as site:
                page=site.page
                if state=='accounts':install_access_fixture(page)
                elif state in ['legal','legal-version']:install_legal_fixture(page)
                elif state.startswith('review-'):review_fixture(page)
                elif state in ['finance','accounting-export']:install_finance_fixture(page)
                elif state in ['leads','leads-suppressed','referrals']:install_review_fixture(page,withdrawn=state=='leads-suppressed')
                else:install_owner_fixture(page)
                if state=='gig':
                    item={'id':GIG_ID,'partnerId':PARTNER['id'],'status':'submitted','revision':3,'feeCents':4000,'maximumBonusCents':0,
                          'terms':{'title':'Synthetic permitted introductions','feeCents':4000,'maximumBonusCents':0,'area':'Tulsa permitted business areas',
                                   'deadline':'2026-12-01','tasks':['Respect no-soliciting signs','Ask before leaving materials'],'materials':['Owner-provided sample kit'],'bonusRules':[]}}
                    def detail(route):
                        if 'resource=gig&' in route.request.url:
                            route.fulfill(status=200,content_type='application/json',body=json.dumps({'item':item,'events':[],'negotiations':[]}))
                        else:route.fallback()
                    page.route('**/api/operator-partners*',detail)
                page.goto(origin+'/partners#'+('legal/package/'+PACKAGE if state=='review-package' else 'legal/feedback/'+FEEDBACK if state=='review-feedback' else 'legal' if state=='review-create' else 'gig/'+GIG_ID if state=='gig' else 'partners' if state=='accounts' else 'leads' if state=='leads-suppressed' else 'finance/export/'+BATCH if state=='accounting-export' else 'legal/version/'+VERSION if state=='legal-version' else state))
                page.get_by_role('heading',level=1).wait_for()
                if state=='accounts':
                    page.get_by_label('I verified the identity of this partner and understand that issuing a code replaces all unused codes.',exact=True).check()
                    page.get_by_role('button',name='Issue recovery code',exact=True).click()
                    page.get_by_label('One-time recovery code',exact=True).wait_for()
                if state=='review-create':
                    page.get_by_text('Create professional review package',exact=True).click()
                    form=page.locator('[data-review-package-create]');form.locator('[name=versionIds]').check()
                    for reviewer,role,scopes in [('Synthetic professional counsel','attorney',['Agreement language','Classification']),('Synthetic accountant','cpa',['Accounting'])]:
                        form.get_by_role('button',name='Add named reviewer',exact=True).click();row=form.locator('[data-reviewer]').last
                        row.get_by_label('Reviewer name',exact=True).fill(reviewer);row.get_by_role('combobox',name='Professional role',exact=True).select_option(role)
                        for scope in scopes:row.get_by_label(scope,exact=True).check()
                    form.get_by_label('Grant expires at (ISO 8601 with timezone)',exact=True).fill('2026-11-01T10:00:00Z')
                    form.get_by_label('Private factual brief and review questions',exact=True).fill('Synthetic review questions only. Please identify conditions and re-review triggers.')
                if state=='review-package':
                    form=page.locator('[data-record-review]');form.get_by_role('combobox',name='Reviewed source version',exact=True).select_option(VERSION)
                    form.get_by_role('combobox',name='Named reviewer and scope',exact=True).select_option('0')
                    form.get_by_role('combobox',name='Professional decision',exact=True).select_option('changes_requested')
                if state=='legal-version' and scheme=='light':page.get_by_text('Typed variables and required reviews',exact=True).click()
                if state=='finance' and scheme=='light':page.locator('main details').evaluate_all('(xs)=>xs.forEach(x=>x.open=true)')
                if state=='leads' and scheme=='light':page.get_by_text('Correct contact or purpose',exact=True).click()
                if state=='campaigns':
                    page.get_by_label('Offer title',exact=True).fill('Permitted business introductions')
                    page.get_by_label('Offered fee (USD)',exact=True).fill('40.00')
                    page.get_by_label('Permitted area',exact=True).fill('Tulsa permitted business areas')
                    page.get_by_label('Completion deadline',exact=True).fill('2026-12-01')
                    page.get_by_label('Objective tasks (one per line)',exact=True).fill('Ask permission before leaving materials\nRecord consenting introductions')
                    page.get_by_role('button',name='Add conditional bonus',exact=True).click()
                    page.get_by_label('Bonus reference',exact=True).fill('settled-sale')
                    page.get_by_role('combobox',name='Qualifying event',exact=True).select_option('verified_sale')
                    page.get_by_label('Bonus per award (USD)',exact=True).fill('20.00')
                    page.get_by_label('Maximum awards',exact=True).fill('2')
                    page.get_by_label('Objective qualification criteria',exact=True).fill('Independent full settlement and customer opt-in verified by the owner.')
                    page.get_by_label('Qualify by (Central date)',exact=True).fill('2026-12-31')
                    page.get_by_label('Refund treatment for a paid-sale bonus',exact=True).fill('Owner reviews refunds separately; no automatic clawback.')
                page.evaluate('document.activeElement?.blur();window.scrollTo(0,0)')
                site.screenshot(path,full_page=True)
                assert not site.page_errors
            captured.append((f'Owner partners {state} · {scheme}',path))
    return captured


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cases = [
        ("Home · desktop · light", capture("/", "home-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("Home · desktop · dark", capture("/", "home-desktop-dark.png", viewport=(1440, 1000), scheme="dark")),
        ("Home · mobile · light", capture("/", "home-mobile-light.png", viewport=(390, 844), scheme="light")),
        ("Home · mobile · dark", capture("/", "home-mobile-dark.png", viewport=(390, 844), scheme="dark")),
        ("Quick inquiry · desktop · light", capture("/", "inquiry-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=show_inquiry)),
        ("Quick inquiry · mobile · dark", capture("/", "inquiry-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=show_inquiry)),
        ("Project detail · desktop · dark", capture("/", "project-dialog-desktop-dark.png", viewport=(1440, 1000), scheme="dark", prepare=show_project_dialog)),
        ("Project detail · mobile · light", capture("/", "project-dialog-mobile-light.png", viewport=(390, 844), scheme="light", prepare=show_project_dialog)),
        ("Services · desktop · light", capture("/services.html", "services-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("Portfolio · desktop · dark", capture("/portfolio.html", "portfolio-desktop-dark.png", viewport=(1440, 1000), scheme="dark")),
        ("Portfolio cards · desktop · light", capture("/portfolio.html", "portfolio-cards-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=show_project_cards)),
        ("Portfolio cards · mobile · dark", capture("/portfolio.html", "portfolio-cards-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=show_project_cards)),
        ("About · desktop · light", capture("/about.html", "about-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("About work record · desktop · dark", capture("/about.html", "about-work-desktop-dark.png", viewport=(1440, 1000), scheme="dark", prepare=show_work_record)),
        ("About work record · mobile · dark", capture("/about.html", "about-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=show_work_record)),
        ("Print intake · desktop · light", capture("/order.html?service=print", "order-print-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_print_details)),
        ("Print model estimate · desktop · light", capture("/order.html?service=print", "order-print-model-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_print_model)),
        ("Print model estimate · mobile · dark", capture("/order.html?service=print", "order-print-model-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=prepare_print_model)),
        ("Design intake · desktop · light", capture("/order.html?service=design", "order-design-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_design_details)),
        ("Repair intake · mobile · dark", capture("/order.html?service=repair", "order-repair-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=prepare_mobile_repair)),
        ("Consult intake · desktop · light", capture("/order.html?service=consult", "order-consult-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_consult_details)),
        ("Storage warning · mobile · dark", capture("/order.html?service=consult", "order-storage-warning-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=prepare_storage_warning, storage_denied=True)),
    ]
    cases.extend([
        ("Referral permission · mobile · dark", capture('/order.html?service=consult', 'order-referral-contact-dark.png', viewport=(390,844), scheme='dark', full_page=True, prepare=prepare_referral_contact)),
        ("Referral permission · narrow · light", capture('/order.html?service=consult', 'order-referral-contact-light.png', viewport=(320,844), scheme='light', full_page=True, prepare=prepare_referral_contact)),
        ("Privacy · referral notice · light", capture('/privacy.html', 'privacy-referral-light.png', viewport=(1280,1000), scheme='light', full_page=True)),
    ])
    cases.extend(capture_customize_states())
    cases.extend(capture_operator_states())
    cases.extend(capture_inquiry_workflow_states())
    cases.extend(capture_filament_states())
    cases.extend(capture_spoolman_states())
    cases.extend(capture_partner_states())
    cases.extend(capture_partner_owner_states())
    capture("/", "home-full-page-light.png", viewport=(1440, 1000), scheme="light", full_page=True)
    board = build_preview_board(cases)
    print(f"Captured {len(cases) + 1} screenshots and {board.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
