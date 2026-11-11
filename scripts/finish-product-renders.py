"""Optimize Blender outputs and record provenance; also make a visual review board."""
import hashlib
import json
import re
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
recipes = json.loads((ROOT / '.private/product-renders/recipes.json').read_text())
entries = []
media = {}
board = Image.new('RGB', (1280, ((len(recipes['renders']) + 2) // 3) * 350 + 10), '#f5f1e9')
draw = ImageDraw.Draw(board)
for index, recipe in enumerate(recipes['renders']):
    source = ROOT / f'.private/product-renders/{recipe["id"]}.png'
    image = Image.open(source).convert('RGB')
    output_name = recipe.get('output', f'{recipe["id"]}.webp')
    if not re.fullmatch(r'(?:catalogue/)?[a-z0-9-]+\.webp', output_name):
        raise ValueError('Invalid public render output path')
    output = ROOT / 'public/assets/images/products' / output_name
    output.parent.mkdir(parents=True, exist_ok=True)
    image.resize((960, 720), Image.Resampling.LANCZOS).save(output, quality=88, method=6)
    entries.append({'id': recipe['id'], 'recipe': recipe, 'renderer': 'Blender Cycles',
                    'meshSha256': hashlib.sha256((ROOT / f'.private/product-renders/{recipe["id"]}.json').read_bytes()).hexdigest(),
                    'studioSha256': hashlib.sha256((ROOT / 'scripts/render-products.py').read_bytes()).hexdigest(),
                    'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    parts = json.loads((ROOT / f'.private/product-renders/{recipe["id"]}.json').read_text())['parts']
    points = [point for part in parts for point in part['mesh']['vertices']]
    media[recipe['id']] = {'dimensionsMm': [round(max(p[axis] for p in points) - min(p[axis] for p in points), 3) for axis in range(3)],
                           'configurationSha256': recipe.get('configurationSha256'),
                           'imageSha256': entries[-1]['sha256']}
    x, y = (index % 3) * 425, (index // 3) * 350
    board.paste(image.resize((420, 315), Image.Resampling.LANCZOS), (x, y))
    draw.text((x + 12, y + 320), recipe['id'], fill='#252525')
(ROOT / 'scripts/product-render-manifest.json').write_text(json.dumps({'version': 1,
    'inputSha256': (ROOT / '.private/product-renders/input-hash.txt').read_text(), 'renders': entries}, indent=2) + '\n')
(ROOT / 'scripts/catalogue-media.json').write_text(json.dumps(media, indent=2) + '\n')
for filename in ['public/index.html', 'public/assets/js/customize/product-media.js', 'public/assets/js/catalogue/products.js']:
    path = ROOT / filename
    text = path.read_text(encoding='utf-8')
    for entry in entries:
        output_name = entry['recipe'].get('output', f'{entry["id"]}.webp')
        pattern = r'(/assets/images/products/' + re.escape(output_name) + r')(?:\?v=[a-f0-9]+)?'
        text = re.sub(pattern, lambda match: match.group(1) + '?v=' + entry['sha256'][:16], text)
    path.write_text(text, encoding='utf-8')
board.save(ROOT / 'screenshots/product-render-board.png')
