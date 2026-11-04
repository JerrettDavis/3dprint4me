"""Check every local HTML link, fragment and asset in the Pages artifact."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json

ROOT = Path(__file__).resolve().parents[1] / 'public/handbook'
PREFIX = '/3dprint4me/'

class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids, self.links = set(), []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.add(attrs['id'])
        for key in ('href', 'src'):
            if key in attrs:
                self.links.append(attrs[key])

def validate():
    documents = {p: Document(p.read_text(encoding='utf-8')) for p in ROOT.rglob('*.html')}
    errors = []
    for path, doc in documents.items():
        for link in doc.links:
            url = urlsplit(link)
            if url.scheme or url.netloc:
                continue
            relative = unquote(url.path)
            if relative.startswith('/'):
                if not relative.startswith(PREFIX):
                    errors.append(f'{path.relative_to(ROOT)}: path escapes Pages prefix: {link}')
                    continue
                target = ROOT / relative[len(PREFIX):]
            else:
                target = path.parent / relative if relative else path
            target = target.resolve()
            if not target.is_relative_to(ROOT.resolve()):
                errors.append(f'{path}: link escapes artifact: {link}')
                continue
            if target.is_dir():
                target /= 'index.html'
            if not target.is_file():
                errors.append(f'{path.relative_to(ROOT)}: missing {link}')
            elif url.fragment and target in documents and unquote(url.fragment) not in documents[target].ids:
                errors.append(f'{path.relative_to(ROOT)}: missing fragment {link}')
    forbidden = [p for p in ROOT.rglob('*') if p.is_file() and
                 (p.name.startswith('.env') or p.suffix in {'.py', '.mjs', '.docx', '.sql'} or
                  'hosted' in p.parts or 'runs' in p.parts)]
    errors.extend(f'Forbidden artifact: {p}' for p in forbidden)
    search = json.loads((ROOT / 'search/search_index.json').read_text(encoding='utf-8'))
    assert len(search['docs']) >= 100, 'Search index is incomplete'
    assert len(list((ROOT / 'reference/partner-qa/flows').glob('QA-*/index.html'))) == 60
    assert len(list((ROOT / 'reference/partner-qa/screenshots').glob('*.png'))) == 142
    if errors:
        raise SystemExit('\n'.join(errors))
    print(json.dumps({'htmlPages': len(documents), 'localLinksAndAssets': 'passed',
                      'bddScenarios': 60, 'bddScreenshots': 142,
                      'screenshots': len(list(ROOT.rglob('*.png'))), 'searchEntries': len(search['docs'])}))

if __name__ == '__main__':
    validate()
