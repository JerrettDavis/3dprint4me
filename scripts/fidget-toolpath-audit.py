"""Inspect actual default-cube extrusion around designed support starts.

Usage: python scripts/fidget-toolpath-audit.py <Bambu slice output directory>
Reports evidence only; does not suppress or reinterpret a slicer warning.
"""
import json
import math
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
result = json.loads((root / 'result.json').read_text())
box = result['sliced_plates'][0]['objects'][0]['bbox']
offset = (box['x'], box['y'])
regions = {
    'side_strip': (41.5, 4),
    'down_pin_A': (37, 4),
    'down_pin_B': (46, 4),
    'top_post_A': (10, 19),
    'top_post_B': (10, 22),
}
counts = {name: {} for name in regions}
layer = None
x = y = e = 0.0
relative_e = True
feature = ''


def distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = dx * dx + dy * dy
    t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / den)) if den else 0
    return math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)


for line in (root / 'plate_1.gcode').read_text().splitlines():
    if line.startswith('; Z_HEIGHT:'):
        layer = round(float(line.split(':')[1]), 3)
    if line.startswith('; FEATURE:'):
        feature = line.split(':', 1)[1].strip()
    code = line.split(';', 1)[0].strip()
    if not code:
        continue
    command = code.split()[0]
    if command == 'M83':
        relative_e = True
    elif command == 'M82':
        relative_e = False
    values = {key: float(value) for key, value in re.findall(r'([XYE])([-+]?(?:\d*\.\d+|\d+))', code)}
    if command == 'G92' and 'E' in values:
        e = values['E']
    if command not in ('G0', 'G1', 'G2', 'G3'):
        continue
    nx, ny = values.get('X', x), values.get('Y', y)
    extrusion = values.get('E', 0) if relative_e else values.get('E', e) - e
    if extrusion > 0 and layer is not None and ('X' in values or 'Y' in values or command in ('G2', 'G3')):
        a, b = (x - offset[0], y - offset[1]), (nx - offset[0], ny - offset[1])
        for name, point in regions.items():
            if distance(point, a, b) <= 0.35 and 5 <= layer <= 12.6:
                counts[name][layer] = counts[name].get(layer, 0) + 1
    if 'E' in values:
        e = e + values['E'] if relative_e else values['E']
    x, y = nx, ny

print(json.dumps({'offset': offset, 'extrusion_segments_near_supports': counts}, indent=2))
