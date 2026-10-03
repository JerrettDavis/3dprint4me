from __future__ import annotations

import sys
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
    page.locator(".cz-preview").scroll_into_view_if_needed()


def show_facts(page) -> None:
    page.evaluate("document.querySelector('.cz-summary').scrollIntoView({ block: 'start' })")


def wifi_tag(fmt: str, *, mobile: bool = False, show: str = "preview"):
    """The Wi-Fi page needs a password before it builds; type a sample one, pick the format, wait for the model."""
    def prepare(page) -> None:
        page.get_by_label("Tag format").select_option(fmt)
        page.get_by_label("Network name (SSID)", exact=True).fill("Cafe Guest")
        page.get_by_label("Network password", exact=True).fill("correct-horse-battery")
        page.locator(GENERATOR_READY).wait_for(state="attached", timeout=30000)
        if show == "form":
            page.evaluate("document.querySelector('[data-field=\"ssid\"]').scrollIntoView({ block: 'start' })")
        elif mobile:
            page.evaluate("document.querySelector('.cz-preview').scrollIntoView({ block: 'start' })")
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
        target = "#cz-image-area" if image and mobile else ".cz-preview"
        if mobile or image:
            page.evaluate(f"document.querySelector('{target}').scrollIntoView({{ block: 'start' }})")
        page.wait_for_timeout(600)
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
        ]:
            path = OUTPUT / filename
            with SiteBrowser(viewport=viewport, color_scheme=scheme, reduced_motion="reduce") as site:
                page = site.page
                assert page is not None
                page.goto(operator, wait_until="networkidle")
                page.locator("#workspace:not([hidden])").wait_for()
                if open_detail == "print":
                    page.locator("#work-list .work-row", has_text="4-up PLA").click()
                    page.locator(".print-sheet").wait_for()
                    page.evaluate("document.querySelector('.print-sheet').scrollIntoView({ block: 'start' })")
                elif open_detail:
                    page.locator("#work-list .work-row", has_text="Replacement alignment bracket").click()
                    page.locator("#detail-content:not([hidden])").wait_for()
                site.screenshot(path, full_page=False)
                site.assert_no_page_errors()
            captured.append((label, path))
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
    cases.extend(capture_customize_states())
    cases.extend(capture_operator_states())
    capture("/", "home-full-page-light.png", viewport=(1440, 1000), scheme="light", full_page=True)
    board = build_preview_board(cases)
    print(f"Captured {len(cases) + 1} screenshots and {board.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
