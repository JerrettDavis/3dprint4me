"""Add the application-only network to the owned Spoolman Compose source.

Pure transformation; the caller validates Compose in memory before persisting
to the private source and connects the already-running application container.
No environment, labels, image, existing network, or provider route is changed.
"""
import re


def wire_source_network(source):
    text = source.replace("\r\n", "\n")
    start = text.find("\n  spoolman:\n")
    if start < 0:
        raise ValueError("Expected a standalone Spoolman application service")
    start += 1
    end_match = re.search(r"(?m)^(?:  [A-Za-z0-9_-]+:|[A-Za-z][A-Za-z0-9_-]*:)", text[start + len("  spoolman:\n"):])
    if not end_match:
        raise ValueError("Expected a service boundary")
    end = start + len("  spoolman:\n") + end_match.start()
    block = text[start:end]
    if "    networks:\n      - " not in block:
        raise ValueError("Expected a list of existing service networks")
    if "      - print4me-spoolman\n" not in block:
        block = block.replace("    networks:\n", "    networks:\n      - print4me-spoolman\n", 1)
    candidate = text[:start] + block + text[end:]
    declaration = "  print4me-spoolman:\n    external: true\n    name: 3dprint4me-spoolman\n"
    if "\nnetworks:\n" not in candidate:
        raise ValueError("Expected top-level networks")
    if declaration not in candidate:
        if "  print4me-spoolman:" in text:
            raise ValueError("Conflicting source network declaration")
        candidate = candidate.replace("\nnetworks:\n", "\nnetworks:\n" + declaration, 1)
    return candidate
