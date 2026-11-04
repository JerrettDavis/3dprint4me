import subprocess,unittest,runpy,json,sys
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
class DocsSiteBuild(unittest.TestCase):
 def test_guides_publish_paired_bounded_screenshots(self):
  from PIL import Image
  assets=ROOT/'docs-site/src/assets/guides'
  desktop=list(assets.glob('*-desktop.png'))
  self.assertGreaterEqual(len(desktop),18)
  for p in desktop:
   with Image.open(p) as image:self.assertEqual(image.size,(1440,810))
   with Image.open(p.with_name(p.name.replace('-desktop','-mobile'))) as image:self.assertEqual(image.size,(390,520))
  html=(ROOT/'public/handbook/guides/partner/index.html').read_text(encoding='utf-8')
  self.assertIn('screenshot-pair',html)
  self.assertIn('Mobile · 3:4',html)
 def test_curated_site_and_local_links(self):
  subprocess.run([sys.executable,'scripts/build-docs.py'],cwd=ROOT,check=True)
  out=ROOT/'public/handbook'
  self.assertTrue((out/'index.html').exists())
  self.assertTrue((out/'guides/qa/index.html').exists())
  self.assertTrue((out/'reference/partner-qa/flows/QA-060/index.html').exists())
  self.assertTrue((out/'search/search_index.json').exists())
  self.assertFalse(any(p.name.startswith('.env') or p.suffix in {'.py','.mjs','.docx'} for p in out.rglob('*')))
  self.assertFalse((out/'reference/portal-polish/hosted').exists())
  subprocess.run([sys.executable,'scripts/validate-docs.py'],cwd=ROOT,check=True)
 def test_manifest_rejects_unreviewed_source_bytes(self):
  module=runpy.run_path(str(ROOT/'scripts/build-docs.py'))
  manifest=json.loads((ROOT/'docs-site/publication-manifest.json').read_text(encoding='utf-8'))
  manifest['files'][0]['sha256']='0'*64
  with patch.object(module['json'],'loads',return_value=manifest):
   with self.assertRaisesRegex(AssertionError,'Unreviewed public change'):
    module['prepare']()
if __name__=='__main__':unittest.main()
