from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.support.browser_harness import ROOT, SiteBrowser

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


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cases = [
        ("Home · desktop · light", capture("/", "home-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("Home · desktop · dark", capture("/", "home-desktop-dark.png", viewport=(1440, 1000), scheme="dark")),
        ("Services · desktop · light", capture("/services.html", "services-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("Portfolio · desktop · dark", capture("/portfolio.html", "portfolio-desktop-dark.png", viewport=(1440, 1000), scheme="dark")),
        ("Portfolio cards · desktop · light", capture("/portfolio.html", "portfolio-cards-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=show_project_cards)),
        ("Portfolio cards · mobile · dark", capture("/portfolio.html", "portfolio-cards-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=show_project_cards)),
        ("About · desktop · light", capture("/about.html", "about-desktop-light.png", viewport=(1440, 1000), scheme="light")),
        ("About work record · desktop · dark", capture("/about.html", "about-work-desktop-dark.png", viewport=(1440, 1000), scheme="dark", prepare=show_work_record)),
        ("About work record · mobile · dark", capture("/about.html", "about-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=show_work_record)),
        ("Print intake · desktop · light", capture("/order.html?service=print", "order-print-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_print_details)),
        ("Design intake · desktop · light", capture("/order.html?service=design", "order-design-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_design_details)),
        ("Repair intake · mobile · dark", capture("/order.html?service=repair", "order-repair-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=prepare_mobile_repair)),
        ("Consult intake · desktop · light", capture("/order.html?service=consult", "order-consult-desktop-light.png", viewport=(1440, 1000), scheme="light", prepare=prepare_consult_details)),
        ("Storage warning · mobile · dark", capture("/order.html?service=consult", "order-storage-warning-mobile-dark.png", viewport=(390, 844), scheme="dark", prepare=prepare_storage_warning, storage_denied=True)),
    ]
    capture("/", "home-full-page-light.png", viewport=(1440, 1000), scheme="light", full_page=True)
    board = build_preview_board(cases)
    print(f"Captured {len(cases) + 1} screenshots and {board.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
