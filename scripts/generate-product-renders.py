"""One-command local render pipeline. Requires Blender 5.2 and Pillow."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
blender = os.environ.get('BLENDER_BIN') or shutil.which('blender')
if not blender:
    candidate = Path('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe')
    blender = str(candidate) if candidate.is_file() else None
if not blender:
    raise SystemExit('Install Blender 5.2, add it to PATH or set BLENDER_BIN to its executable.')
subprocess.run(['node', 'scripts/export-product-render-meshes.mjs'], cwd=ROOT, check=True)
subprocess.run([blender, '--background', '--python', 'scripts/render-products.py'], cwd=ROOT, check=True)
subprocess.run([sys.executable, 'scripts/finish-product-renders.py'], cwd=ROOT, check=True)
