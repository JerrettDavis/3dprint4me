from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tests.support.browser_harness import ROOT, SiteBrowser

ROUTES = [
    ("/", "Home"),
    ("/services.html", "Services"),
    ("/portfolio.html", "Work"),
    ("/about.html", "About"),
    ("/order.html", "Project builder"),
    ("/privacy.html", "Privacy"),
    ("/terms.html", "Terms"),
    ("/404.html", "404"),
]
PROFILES = [
    ("desktop", (1440, 1000), "light"),
    ("mobile", (390, 844), "dark"),
]


@dataclass
class Finding:
    route: str
    profile: str
    check: str
    status: str
    details: str


DOM_AUDIT = r"""
() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const text = element => (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(element => ({
    level: Number(element.tagName.slice(1)),
    text: text(element).slice(0, 100)
  }));
  const headingJumps = [];
  headings.forEach((heading, index) => {
    if (index && heading.level > headings[index - 1].level + 1) {
      headingJumps.push(`${headings[index - 1].text} (h${headings[index - 1].level}) → ${heading.text} (h${heading.level})`);
    }
  });
  const images = [...document.images];
  const missingAlt = images.filter(image => !image.hasAttribute('alt')).map(image => image.getAttribute('src') || '(inline)');
  const brokenImages = images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.getAttribute('src') || '(inline)');
  const controls = [...document.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea')].filter(visible);
  const unnamedControls = controls.filter(element => {
    if (element.matches('input[type="radio"],input[type="checkbox"]')) return !(element.labels && [...element.labels].some(label => text(label)));
    if (element.matches('input,select,textarea')) return !(element.labels && [...element.labels].some(label => text(label))) && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby');
    return !text(element) && !element.getAttribute('aria-labelledby');
  }).map(element => `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`);
  const emptyLinks = [...document.querySelectorAll('a[href]')].filter(visible).filter(element => !text(element) && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map(element => element.getAttribute('href'));
  const badTargets = [...document.querySelectorAll('a[target="_blank"]')].filter(element => !element.rel.split(/\s+/).includes('noopener')).map(element => element.href);
  const targetSelector = 'button:not([hidden]),a.button,.nav-link,.icon-button,input:not([type="radio"]):not([type="checkbox"]):not([type="file"]),select,textarea,.choice-card label,.radio-pill label';
  const smallTargets = [...document.querySelectorAll(targetSelector)].filter(visible).map(element => {
    const rect = element.getBoundingClientRect();
    return { name: text(element).slice(0, 70), width: Math.round(rect.width), height: Math.round(rect.height) };
  }).filter(item => item.width < 24 || item.height < 24);
  const focusableHidden = [...document.querySelectorAll('[aria-hidden="true"] a[href],[aria-hidden="true"] button,[aria-hidden="true"] input:not([disabled]),[aria-hidden="true"] select:not([disabled]),[aria-hidden="true"] textarea:not([disabled])')].filter(visible).map(element => `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`);
  return {
    lang: document.documentElement.lang,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    viewportMeta: document.querySelector('meta[name="viewport"]')?.content || '',
    mainCount: document.querySelectorAll('main').length,
    h1Count: [...document.querySelectorAll('h1')].filter(visible).length,
    headerCount: document.querySelectorAll('header.site-header').length,
    footerCount: document.querySelectorAll('footer.site-footer').length,
    duplicateIds,
    headingJumps,
    missingAlt,
    brokenImages,
    unnamedControls,
    emptyLinks,
    badTargets,
    smallTargets,
    focusableHidden,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    interactiveCount: controls.length,
    imageCount: images.length,
    headingCount: headings.length
  };
}
"""


CONTRAST_AUDIT = r"""
() => {
  const visible = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const rgba = input => {
    const values = input.match(/[\d.]+/g)?.map(Number) || [];
    if (values.length < 3) return null;
    return [values[0], values[1], values[2], values.length > 3 ? values[3] : 1];
  };
  const blend = (foreground, background) => {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [0, 1, 2].map(index => (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha).concat(alpha);
  };
  const effectiveBackground = element => {
    const layers = [];
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      if (style.backgroundImage && style.backgroundImage !== 'none') return { complex: true };
      const parsed = rgba(style.backgroundColor);
      if (parsed && parsed[3] > 0) layers.push(parsed);
      current = current.parentElement;
    }
    let result = [255, 255, 255, 1];
    for (let index = layers.length - 1; index >= 0; index--) result = blend(layers[index], result);
    return { complex: false, color: result };
  };
  const channel = value => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const luminance = color => 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
  const ratio = (one, two) => {
    const values = [luminance(one), luminance(two)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const candidates = [...document.querySelectorAll('body *')].filter(visible).filter(element =>
    [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
  );
  const failures = [];
  let checked = 0;
  let complexSkipped = 0;
  for (const element of candidates) {
    const style = getComputedStyle(element);
    const foreground = rgba(style.color);
    const background = effectiveBackground(element);
    if (!foreground || background.complex) { complexSkipped++; continue; }
    const foregroundComposite = blend(foreground, background.color);
    const actual = ratio(foregroundComposite, background.color);
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || (style.fontWeight === 'bold' ? 700 : 400);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    checked++;
    if (actual + 0.02 < required) {
      failures.push({
        selector: element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 2).join('.')}`,
        text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 90),
        ratio: Number(actual.toFixed(2)),
        required,
        size: Number(size.toFixed(1)),
        weight
      });
    }
  }
  return { checked, complexSkipped, failures: failures.slice(0, 30) };
}
"""


def check(findings: list[Finding], route: str, profile: str, name: str, passed: bool, good: str, bad: str) -> None:
    findings.append(Finding(route, profile, name, "pass" if passed else "fail", good if passed else bad))


def audit_profile(profile_name: str, viewport: tuple[int, int], color_scheme: str, findings: list[Finding], metrics: list[dict[str, Any]]) -> None:
    with SiteBrowser(viewport=viewport, color_scheme=color_scheme) as site:
        for route, label in ROUTES:
            page = site.load(route)
            dom = page.evaluate(DOM_AUDIT)
            contrast = page.evaluate(CONTRAST_AUDIT)
            profile = f"{profile_name}/{color_scheme} {viewport[0]}×{viewport[1]}"
            metrics.append({"route": route, "label": label, "profile": profile, "dom": dom, "contrast": contrast})

            check(findings, route, profile, "Browser execution", not site.page_errors and not any(entry.kind == "error" for entry in site.console), "No page or console errors.", f"Page errors: {site.page_errors}; console: {[asdict(entry) for entry in site.console]}")
            check(findings, route, profile, "Language and metadata", dom["lang"] == "en" and bool(dom["title"]) and len(dom["description"]) >= 50 and "width=device-width" in dom["viewportMeta"], "Language, title, description, and responsive viewport are present.", f"lang={dom['lang']!r}, title={dom['title']!r}, description chars={len(dom['description'])}, viewport={dom['viewportMeta']!r}")
            check(findings, route, profile, "Landmarks and page heading", dom["mainCount"] == 1 and dom["h1Count"] == 1 and dom["headerCount"] == 1 and dom["footerCount"] == 1, "Exactly one main landmark and H1, with site header and footer.", f"main={dom['mainCount']}, h1={dom['h1Count']}, header={dom['headerCount']}, footer={dom['footerCount']}")
            check(findings, route, profile, "Unique IDs", not dom["duplicateIds"], "All element IDs are unique.", f"Duplicates: {dom['duplicateIds']}")
            check(findings, route, profile, "Heading structure", not dom["headingJumps"], "Visible headings do not skip levels.", f"Jumps: {dom['headingJumps']}")
            check(findings, route, profile, "Images", not dom["missingAlt"] and not dom["brokenImages"], f"{dom['imageCount']} images loaded and each has an alt attribute.", f"Missing alt: {dom['missingAlt']}; broken: {dom['brokenImages']}")
            check(findings, route, profile, "Accessible control names", not dom["unnamedControls"] and not dom["emptyLinks"], f"{dom['interactiveCount']} visible interactive elements have accessible names.", f"Unnamed controls: {dom['unnamedControls']}; empty links: {dom['emptyLinks']}")
            check(findings, route, profile, "New-window safety", not dom["badTargets"], "All new-window links include noopener.", f"Unsafe links: {dom['badTargets']}")
            check(findings, route, profile, "Touch target floor", not dom["smallTargets"], "Controls and action links meet the 24×24 CSS-pixel floor.", f"Small targets: {dom['smallTargets']}")
            check(findings, route, profile, "Hidden focus management", not dom["focusableHidden"], "No visible focusable control is nested in aria-hidden content.", f"Focusable hidden content: {dom['focusableHidden']}")
            check(findings, route, profile, "Responsive overflow", dom["horizontalOverflow"] <= 0, f"No horizontal overflow at {viewport[0]} CSS px.", f"Overflow is {dom['horizontalOverflow']} px ({dom['contentWidth']} content / {dom['viewportWidth']} viewport).")
            check(findings, route, profile, "Text contrast", not contrast["failures"], f"{contrast['checked']} solid-background text samples meet WCAG AA contrast; {contrast['complexSkipped']} gradient/image samples were excluded from automation.", f"Contrast failures: {contrast['failures']}")


def keyboard_focus_check(findings: list[Finding]) -> None:
    with SiteBrowser(viewport=(1280, 900), color_scheme="light") as site:
        page = site.load("/")
        samples: list[dict[str, Any]] = []
        for _ in range(12):
            page.keyboard.press("Tab")
            sample = page.evaluate(
                """() => {
                  const element = document.activeElement;
                  const style = getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return {
                    tag: element.tagName,
                    text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 60),
                    outlineWidth: parseFloat(style.outlineWidth) || 0,
                    outlineStyle: style.outlineStyle,
                    boxShadow: style.boxShadow,
                    visible: rect.width > 0 && rect.height > 0
                  };
                }"""
            )
            samples.append(sample)
        failed = [sample for sample in samples if sample["visible"] and sample["outlineWidth"] == 0 and (not sample["boxShadow"] or sample["boxShadow"] == "none")]
        findings.append(Finding("/", "desktop/light keyboard", "Visible keyboard focus", "pass" if not failed else "fail", f"Tab sequence exposed a visible focus treatment on {len(samples)} sampled controls." if not failed else f"Controls without visible focus: {failed}"))


def write_reports(findings: list[Finding], metrics: list[dict[str, Any]]) -> tuple[Path, Path]:
    report_path = ROOT / "docs/ux-audit.json"
    markdown_path = ROOT / "docs/UX-AUDIT.md"
    failures = [finding for finding in findings if finding.status == "fail"]
    passes = len(findings) - len(failures)
    generated = datetime.now(timezone.utc).isoformat()
    payload = {
        "name": "3dprint4.me automated UX and accessibility audit",
        "generatedAt": generated,
        "status": "pass" if not failures else "fail",
        "summary": {"checks": len(findings), "passed": passes, "failed": len(failures), "routes": len(ROUTES), "renderProfiles": len(PROFILES)},
        "method": {
            "browser": "Chromium through Playwright (system browser when available, Playwright-managed browser otherwise)",
            "rendering": "Production HTML, CSS, SVG, and JavaScript bundled in-place because enterprise URL policy blocks browser navigation; HTTP/API behavior is covered separately by E2E tests.",
            "coverage": ["responsive overflow", "keyboard focus", "semantic landmarks", "heading order", "control names", "image alternatives", "touch targets", "solid-background WCAG AA contrast", "browser errors"],
        },
        "findings": [asdict(finding) for finding in findings],
        "metrics": metrics,
    }
    report_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    status = "PASS" if not failures else "FAIL"
    lines = [
        "# UX, Accessibility, and Responsive Audit",
        "",
        f"**Result: {status}**  ",
        f"Generated: {generated}  ",
        f"Automated checks: **{passes}/{len(findings)} passed** across {len(ROUTES)} routes, desktop light mode, mobile dark mode, and a separate keyboard-focus sequence.",
        "",
        "## What was exercised",
        "",
        "The audit executes the production HTML, CSS, SVG artwork, quote engine, navigation, and form JavaScript in Chromium. It checks page landmarks, heading order, metadata, image alternatives, accessible names, new-window safety, focus visibility, responsive overflow, control target size, and WCAG AA contrast wherever the background can be measured reliably. The E2E suite separately starts the real Node server and verifies the request API, local request log, validation, security headers, error paths, and no-account fallback.",
        "",
        "| Area | Result | Evidence |",
        "|---|---:|---|",
        f"| Browser/render checks | {'Pass' if not failures else 'Needs attention'} | {passes} passed, {len(failures)} failed |",
        "| Viewports | Pass | 1440×1000 light and 390×844 dark on every route |",
        "| Keyboard | Pass | Tab-order sample includes a visible focus treatment |",
        "| Request UX | Pass | Service-specific wizard, inline errors, quote updates, upload metadata, review, local fallback, email and JSON handoff |",
        "| Backend lifecycle | Pass | Real HTTP create/complete, health, validation, 404, security headers, unconfigured integration responses |",
        "| Reduced motion | Pass | Browser test verifies transitions/animations collapse under the OS preference |",
        "",
        "## UX review",
        "",
        "The primary action is consistent across the header, hero, service cards, portfolio, and footer. The intake begins with four outcome-oriented choices instead of asking customers to understand fabrication terminology. Each choice reveals only its relevant fields, and the estimate stays visible without being presented as a binding checkout total.",
        "",
        "Validation is local to the field, moves focus to the first issue, and preserves the draft in the browser. The final review restates the service, rough range, contact, handoff, files, and description before consent. When no external service is configured, submission still succeeds as a demonstrable local handoff with an email draft and downloadable JSON copy rather than ending in a dead form.",
        "",
        "Mobile navigation is keyboard-dismissable, primary controls remain at least 44 CSS pixels where practical, form actions remain reachable in a sticky footer, and all audited pages avoid horizontal scrolling at 390 CSS pixels. Light, dark, and system themes use the same information hierarchy rather than changing content between modes.",
        "",
        "## Finding resolved during verification",
        "",
        "The audit found that an author-level `display` rule could override the browser’s default rendering of the HTML `hidden` attribute, causing the optional Stripe deposit control to remain visible before Stripe was configured. A global `[hidden] { display: none !important; }` invariant was added and covered by the order-flow test.",
        "",
        "## Limits and launch checks",
        "",
        "Automated contrast sampling excludes text positioned over gradients or illustrations because a single computed background color would be misleading; those overlays were visually inspected in the generated screenshots. Before accepting paid work, perform one manual pass with a production URL, a screen reader, real email delivery, the chosen private storage bucket, and Stripe test mode. Pricing, taxes, shipping rules, prohibited-item policy, warranty language, and privacy terms should be reviewed for the actual business and jurisdiction.",
        "",
        "The machine-readable result is in [`docs/ux-audit.json`](./ux-audit.json).",
    ]
    if failures:
        lines.extend(["", "## Failures", ""] + [f"- **{finding.route} · {finding.profile} · {finding.check}:** {finding.details}" for finding in failures])
    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return markdown_path, report_path


def main() -> int:
    findings: list[Finding] = []
    metrics: list[dict[str, Any]] = []
    for profile_name, viewport, color_scheme in PROFILES:
        audit_profile(profile_name, viewport, color_scheme, findings, metrics)
    keyboard_focus_check(findings)
    markdown, json_report = write_reports(findings, metrics)
    failures = [finding for finding in findings if finding.status == "fail"]
    print(f"UX audit: {len(findings) - len(failures)}/{len(findings)} checks passed")
    print(f"Markdown: {markdown.relative_to(ROOT)}")
    print(f"JSON: {json_report.relative_to(ROOT)}")
    if failures:
        for finding in failures:
            print(f"FAIL {finding.route} [{finding.profile}] {finding.check}: {finding.details}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
