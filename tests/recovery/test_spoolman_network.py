import importlib.util
from pathlib import Path
import pytest

path = Path(__file__).resolve().parents[2] / "deploy/platform/spoolman-network.py"
spec = importlib.util.spec_from_file_location("spoolman_network", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_source_patch_preserves_services_and_is_idempotent():
    source = "services:\n  other:\n    image: other\n  spoolman:\n    image: pinned\n    networks:\n      - spoolman-private\n      - traefik\n    labels:\n      secret-label: unchanged\nnetworks:\n  spoolman-private:\n    internal: true\n  traefik:\n    external: true\n"
    candidate = module.wire_source_network(source)
    assert "      - print4me-spoolman\n" in candidate
    assert "  print4me-spoolman:\n    external: true\n    name: 3dprint4me-spoolman\n" in candidate
    assert module.wire_source_network(candidate) == candidate
    assert candidate.replace("      - print4me-spoolman\n", "").replace("  print4me-spoolman:\n    external: true\n    name: 3dprint4me-spoolman\n", "") == source


def test_unrecognized_source_shape_is_refused():
    with pytest.raises(ValueError):
        module.wire_source_network("services:\n  spoolman:\n    networks: [private]\nnetworks:\n  private: {}\n")
