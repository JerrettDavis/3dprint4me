"""Prepare an explicit public documentation set; build only public/handbook."""
from pathlib import Path
from urllib.parse import urlsplit,unquote,quote
import json,os,re,shutil,subprocess,sys,hashlib
ROOT=Path(__file__).resolve().parents[1]
STAGE=ROOT/'.docs-source'

def prepare():
 STAGE.mkdir(exist_ok=True)
 # This fixed staging path contains generated files only. Check before replacing.
 assert STAGE.resolve()==ROOT/'.docs-source' and not STAGE.is_symlink()
 shutil.rmtree(STAGE);STAGE.mkdir()
 mapping={}
 manifest=json.loads((ROOT/'docs-site/publication-manifest.json').read_text(encoding='utf-8'))
 for entry in manifest['files']:
  p=(ROOT/entry['file']).resolve()
  assert p.is_relative_to(ROOT) and not p.is_symlink(),entry['file']
  data=p.read_bytes()
  if p.suffix in {'.md','.css'}:data=data.replace(b'\r\n',b'\n')
  assert hashlib.sha256(data).hexdigest()==entry['sha256'],f"Unreviewed public change: {entry['file']}"
  output=Path(entry['output'])
  assert not output.is_absolute() and '..' not in output.parts and not any(x.startswith('.') for x in output.parts),output
  assert p.suffix in {'.md','.css','.png'},p
  assert p.is_relative_to(ROOT/'docs-site/src') or p.is_relative_to(ROOT/'docs'),p
  assert 'hosted' not in p.parts and 'evidence' not in p.parts,p
  mapping[p]=output
 # Canonical QA landing page includes hosted captures; use the new public QA guide instead.
 mapping[(ROOT/'docs/partner-qa/README.md').resolve()]=Path('guides/qa.md')
 for src,dest in mapping.items():
  if src== (ROOT/'docs/partner-qa/README.md').resolve():continue
  target=STAGE/dest;target.parent.mkdir(parents=True,exist_ok=True)
  if src.suffix!='.md':shutil.copyfile(src,target);continue
  text=src.read_text(encoding='utf-8-sig')
  def rewrite(m):
   if m.group(1):return m.group(0)  # fenced/inline code is never a Markdown link
   url=m.group(2);u=urlsplit(url.strip('<>'))
   if u.scheme or u.netloc or not u.path:return m.group(0)
   resolved=(src.parent/unquote(u.path)).resolve()
   if resolved in mapping:
    relative=os.path.relpath(mapping[resolved],dest.parent).replace(chr(92),'/')
    return ']('+quote(relative,safe='/._-')+('#'+u.fragment if u.fragment else '')+')'
   try:repo_path=resolved.relative_to(ROOT).as_posix()
   except ValueError:raise ValueError(f'Link leaves repository: {src}: {url}')
   if not resolved.exists():raise ValueError(f'Missing source link: {src}: {url}')
   return '](https://github.com/JerrettDavis/3dprint4me/blob/docs-source/'+quote(repo_path,safe='/._-')+('#'+u.fragment if u.fragment else '')+')'
  text=re.sub(r'(```[\s\S]*?```|`[^`\n]*`)|\]\(([^)\n]+)\)',rewrite,text)
  target.write_text(text,encoding='utf-8')
 return mapping

if __name__=='__main__':
 prepare()
 subprocess.run([sys.executable,'-m','mkdocs','build','--strict','--clean'],cwd=ROOT,check=True)
 sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 (ROOT/'public/handbook/build-info.json').write_text(json.dumps({'sourceCommit':sha,'hosting':'GitHub Pages','sourceBranch':'docs-source'},indent=2)+'\n',encoding='utf-8')
