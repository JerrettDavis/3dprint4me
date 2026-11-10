"""Render actual extruding G-code paths at base/body/mouth for release review."""
from pathlib import Path
import re
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / '.superpowers/vase-fixtures'
latest = {}
for candidate in sorted(ROOT.glob('*-slice*/plate_1.gcode'), key=lambda p: p.stat().st_mtime):
    latest[candidate.parent.name.split('-slice')[0]] = candidate
files = [latest[key] for key in sorted(latest)]
tiles = []
for path in files:
    moves = []
    x = y = z = e = 0.0
    relative_e = False
    for raw in path.read_text(errors='replace').splitlines():
        line = raw.split(';')[0].strip()
        if line == 'M83': relative_e = True
        if line == 'M82': relative_e = False
        if line.startswith('G92 '):
            match = re.search(r'\bE(-?[\d.]+)', line)
            if match: e = float(match[1])
        if not line.startswith(('G0 ', 'G1 ', 'G2 ', 'G3 ')): continue
        values = {k: float(v) for k, v in re.findall(r'\b([XYZEIJ])(-?[\d.]+)', line)}
        nx, ny, nz = values.get('X', x), values.get('Y', y), values.get('Z', z)
        ne = values.get('E', 0 if relative_e else e)
        if 'E' in values and (ne > 0 if relative_e else ne > e) and (nx != x or ny != y):
            if line.startswith(('G2 ', 'G3 ')) and ('I' in values or 'J' in values):
                cx, cy = x + values.get('I', 0), y + values.get('J', 0)
                start = math.atan2(y-cy, x-cx)
                end = math.atan2(ny-cy, nx-cx)
                sweep = (end-start) % math.tau
                if line.startswith('G2 '): sweep -= math.tau
                radius = math.hypot(x-cx, y-cy)
                count = max(2, math.ceil(abs(sweep)*radius/0.25))
                ax, ay = x, y
                for step in range(1, count+1):
                    angle = start+sweep*step/count
                    bx, by = (nx, ny) if step == count else (cx+radius*math.cos(angle), cy+radius*math.sin(angle))
                    moves.append((ax, ay, bx, by, nz))
                    ax, ay = bx, by
            else:
                moves.append((x, y, nx, ny, nz))
        x, y, z, e = nx, ny, nz, ne
    assert moves, f'No extrusion: {path}'
    top = max(m[4] for m in moves)
    tile = Image.new('RGB', (800, 255), '#f5f4ef')
    draw = ImageDraw.Draw(tile)
    draw.text((12, 8), path.parent.name.split('-slice')[0], fill='#202c32')
    for index, fraction in enumerate((0.001, 0.1, 0.5, 0.99)):
        target = top * fraction
        nearest = min(moves, key=lambda m: abs(m[4] - target))[4]
        selected = [m for m in moves if abs(m[4] - nearest) < 0.21]
        points = [(m[k], m[k+1]) for m in selected for k in (0, 2)]
        left, right = min(p[0] for p in points), max(p[0] for p in points)
        low, high = min(p[1] for p in points), max(p[1] for p in points)
        scale = 165 / max(right-left, high-low, 1)
        def pixel(px, py): return (index*200+100+(px-(left+right)/2)*scale, 137-(py-(low+high)/2)*scale)
        for a,b,c,d,_ in selected: draw.line([pixel(a,b), pixel(c,d)], fill='#16766d', width=1)
        draw.text((index*200+16, 231), f'Z {nearest:.2f} mm', fill='#202c32')
    tiles.append(tile)
assert tiles, 'No sliced fixtures'
board = Image.new('RGB', (1600, ((len(tiles)+1)//2)*255), '#ffffff')
for i,tile in enumerate(tiles): board.paste(tile, ((i%2)*800, (i//2)*255))
board.save(ROOT/'vase-toolpath-board.png')
print(f'Rendered {len(tiles)} sliced fixtures: {ROOT / "vase-toolpath-board.png"}')
