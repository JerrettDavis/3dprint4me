"""Synthetic owner catalogue states for repeatable visual review; no provider writes."""
import base64
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def owner_catalogue_fixture():
    script = """import {PRODUCTS} from './public/assets/js/catalogue/products.js';
import {getGenerator} from './public/assets/js/customize/registry.js';
const p=PRODUCTS.find(p=>p.id==='name-plate-office');
console.log(JSON.stringify({product:{...p,revision:5,status:'approved',permissionNote:'Original house design with generic demonstration text.',
render:{outcome:'ready',images:p.images},published:null},fields:Object.entries(getGenerator(p.generatorId).schema).filter(([,f])=>!f.sensitive).map(([key,f])=>({key,...f}))}));"""
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, check=True, capture_output=True, text=True).stdout)

def install_owner_catalogue_fixture(page, operator, fixture):
    headers = {'access-control-allow-origin': operator, 'access-control-allow-credentials': 'true',
               'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
    def handle(route):
        if 'resource=catalogue' not in route.request.url:
            return route.fallback()
        product = fixture['product']
        if '&preview=' in route.request.url:
            index = int(route.request.url.split('&preview=')[1])
            path = ROOT / 'public' / product['render']['images'][index]['src'].split('?')[0].lstrip('/')
            return route.fulfill(headers=headers, json={'mime': 'image/webp', 'base64': base64.b64encode(path.read_bytes()).decode()})
        if '&id=' in route.request.url:
            return route.fulfill(headers=headers, json={'configured': True, 'renderConfigured': True, 'publishConfigured': True, **fixture})
        route.fulfill(headers=headers, json={'configured': True, 'renderConfigured': True, 'publishConfigured': True, 'products': [product]})
    page.route('**/api/operator-work?**', handle)
