"""Orthographic review of the actual cap mesh and pumpkin-fitted seat."""
import json
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
NODE = """
import { loadEngine } from './customizer/framework/engine.js';
import { buildTopper } from './customizer/generators/pumpkin/toppers/index.js';
import { manifoldToMesh } from './customizer/framework/model.js';
const cap = buildTopper(await loadEngine(), 'baseball');
try { console.log(JSON.stringify(manifoldToMesh(cap))); } finally { cap.delete(); }
"""


def main():
    result = subprocess.run(['node', '--input-type=module', '-e', NODE], cwd=ROOT,
                            capture_output=True, text=True, encoding='utf-8', check=True)
    mesh = json.loads(result.stdout)
    base = min(v[2] for v in mesh['vertices'])
    vertices = [[x, y, z-base] for x, y, z in mesh['vertices']]
    triangles = [[vertices[v] for v in face] for face in mesh['triangles']]
    image = Image.new('RGB', (1600, 650), '#eef3f6')
    draw = ImageDraw.Draw(image)
    title = ImageFont.load_default(size=28)
    font = ImageFont.load_default(size=19)
    draw.text((30, 24), 'Baseball cap: actual exported geometry', fill='#183444', font=title)
    views = [('Front', (0, 2, 1)), ('Side: curved shoulder profile', (1, 2, 0)), ('Underside: moulded seat and pin socket', (0, 1, 2))]
    for i, (label, axes) in enumerate(views):
        x0 = 20 + i * 530
        draw.rounded_rectangle((x0, 88, x0+510, 595), radius=12, fill='white')
        draw.text((x0+15, 105), label, font=font, fill='#183444')
        projected = [[[v[a] for a in axes] for v in face] for face in triangles]
        depth = [sum(v[2] for v in face)/3 for face in projected]
        scale = 10
        for j in sorted(range(len(depth)), key=depth.__getitem__, reverse=True):
            face = triangles[j]
            a = [face[1][k]-face[0][k] for k in range(3)]
            b = [face[2][k]-face[0][k] for k in range(3)]
            normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
            norm = max(math.sqrt(sum(v*v for v in normal)), 1e-10)
            light = max(.3, min(1, .65+.3*sum(n*l/norm for n, l in zip(normal, [.3, -.5, .8]))))
            points = [(x0+255+x*scale, 440-y*scale if i < 2 else 350-y*scale) for x, y, _ in projected[j]]
            base = (45, 118, 172)
            draw.polygon(points, fill=tuple(int(c*light) for c in base))
        if i < 2:
            draw.line((x0+20, 442, x0+490, 442), fill='#d65c2f', width=3)
            draw.text((x0+25, 463), 'Print bed: Z=0 mm', font=font, fill='#a44422')
    draw.text((30, 615), '36 mm crown. Contoured seat; print with supports and the separate mounting pin.', font=font, fill='#183444')
    output = ROOT / 'screenshots/pumpkin-cap-fitted-seat.png'
    image.save(output)
    print(output)


if __name__ == '__main__':
    main()
