"""Render actual original/adapted face geometry for visual review (no browser needed)."""
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
NODE = r"""
import { loadEngine } from './customizer/framework/engine.js';
import { buildFace, FACE_PRESETS } from './customizer/generators/pumpkin/faces.js';
const { CrossSection } = await loadEngine();
const results = [];
for (const [name, spec] of Object.entries(FACE_PRESETS)) {
  const temps = [], t = x => { if(x) temps.push(x); return x; };
  try {
    const original = buildFace(CrossSection, spec, 60, t).main;
    const adapted = buildFace(CrossSection, spec, 60, t, {optimize:true}).main;
    const supports = t(original.subtract(adapted));
    results.push({name, original:original.toPolygons(), adapted:adapted.toPolygons(), supports:supports.toPolygons()});
  } finally { for(const x of temps) x.delete(); }
}
console.log(JSON.stringify(results));
"""


def main():
    result = subprocess.run(["node", "--input-type=module", "-e", NODE], cwd=ROOT,
                            capture_output=True, text=True, encoding="utf-8", check=True)
    faces = json.loads(result.stdout)
    scale = 2
    image = Image.new("RGB", (1600 * scale, 1120 * scale), "#f1f5f6")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=28 * scale)
    font = ImageFont.load_default(size=17 * scale)
    small = ImageFont.load_default(size=13 * scale)
    draw.text((24 * scale, 20 * scale), "Pumpkin faces - original / bridge-first", font=title_font, fill="#133b48")
    draw.text((24 * scale, 62 * scale), "Dark = opening. Coral = designed break-away material. Actual geometry at a 60 mm face width.", font=font, fill="#395966")

    def polygons(contours, center, fill):
        for points in contours:
            area = sum(x * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * y
                       for i, (x, y) in enumerate(points))
            mapped = [((center[0] + x * 3) * scale, (center[1] - y * 3) * scale) for x, y in points]
            draw.polygon(mapped, fill=fill if area > 0 else "#f3ae51")

    for i, face in enumerate(faces):
        x, y = (i % 4) * 400, 100 + (i // 4) * 250
        draw.rounded_rectangle((scale*(x+10), scale*(y+5), scale*(x+390), scale*(y+240)), radius=scale*12, fill="#ffffff")
        draw.text((scale*(x+24), scale*(y+16)), face["name"].capitalize(), font=font, fill="#133b48")
        for offset, key, label in [(104, "original", "Original"), (294, "adapted", "Bridge-first")]:
            center = (x + offset, y + 125)
            draw.ellipse((scale*(center[0]-83), scale*(center[1]-78), scale*(center[0]+83), scale*(center[1]+78)), fill="#f3ae51")
            polygons(face[key], center, "#163943")
            if key == "adapted":
                polygons(face["supports"], center, "#d54d56")
            draw.text((scale*(x+offset-42), scale*(y+212)), label, font=small, fill="#395966")
    output = ROOT / "screenshots/pumpkin-bridge-faces.png"
    image.resize((1600, 1120), Image.Resampling.LANCZOS).save(output)
    print(output)


if __name__ == "__main__":
    main()
