"""Optimize trusted worker results privately; publication is a separate reviewed step."""
import hashlib
import json
import os
import re
from pathlib import Path
from PIL import Image

work = Path(os.environ['PRODUCT_RENDER_WORK_DIR']).resolve()
private = Path(os.environ['PRODUCT_RENDER_PRIVATE_ROOT']).resolve()
if not work.is_relative_to(private) or work == private:
    raise ValueError('Invalid private render directory')
recipes = json.loads((work / 'recipes.json').read_text())['renders']
receipt = json.loads((work / 'mesh-receipt.json').read_text())
images = []
image_hashes = []
for index, recipe in enumerate(recipes):
    if not re.fullmatch(r'[a-z0-9-]{1,160}', recipe['id']) or not re.fullmatch(r'catalogue/[a-z0-9-]+\.webp', recipe['output']):
        raise ValueError('Invalid preview recipe')
    image = Image.open(work / f'{recipe["id"]}.png').convert('RGB')
    output = work / f'preview-{index}.webp'
    image.resize((960, 720), Image.Resampling.LANCZOS).save(output, quality=88, method=6)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    image_hashes.append(digest)
    images.append({'src': f'/assets/images/products/{recipe["output"]}?v={digest[:16]}',
                   'alt': 'Product studio render' if index == 0 else 'Alternate product studio view', 'kind': 'render'})
(work / 'result.json').write_text(json.dumps({**receipt, 'renderer': 'Blender Cycles', 'images': images, 'imageSha256s': image_hashes}) + '\n')
