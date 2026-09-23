"""Render the shipped Lovelace Markdown template for feed states."""

from pathlib import Path

import jinja2
import yaml


ROOT = Path(__file__).resolve().parents[2]
CARD = yaml.safe_load((ROOT / "integrations/home-assistant/dashboard.yaml").read_text())["views"][0]["cards"][1]
TEMPLATE = jinja2.Environment().from_string(CARD["content"])


def render(state, attributes=None):
    return TEMPLATE.render(
        has_value=lambda entity: state not in (None, "unknown", "unavailable"),
        state_attr=lambda entity, attribute: (attributes or {}).get(attribute),
    )


def test_unavailable_feed_reports_unavailable_and_keeps_queue_link():
    for state in (None, "unknown", "unavailable"):
        output = render(state)
        assert "unavailable" in output.lower()
        assert "No active work" not in output
        assert "https://work.3dprint4.me/" in output


def test_missing_items_attribute_is_unavailable_even_with_valid_sensor_state():
    output = render("2026-09-23T00:00:00Z", {})
    assert "unavailable" in output.lower()
    assert "No active work" not in output
    assert "https://work.3dprint4.me/" in output


def test_available_empty_feed_reports_no_active_work():
    output = render("2026-09-23T00:00:00Z", {"items": []})
    assert "No active work" in output
    assert "unavailable" not in output.lower()
    assert "https://work.3dprint4.me/" in output


def test_available_populated_feed_links_to_canonical_item():
    output = render("2026-09-23T00:00:00Z", {"items": [{
        "id": "work_example123", "url": "https://work.3dprint4.me/work/work_example123",
        "service": "print", "status": "submitted", "priority": "normal", "acknowledged": False,
    }]})
    assert "https://work.3dprint4.me/work/work_example123" in output
    assert "https://work.3dprint4.me/" in output
    assert "No active work" not in output
    assert "unavailable" not in output.lower()
