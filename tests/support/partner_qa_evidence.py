from functools import lru_cache
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

@lru_cache(maxsize=4)
def source_fingerprint(root=ROOT):
    root=Path(root);digest=hashlib.sha256();paths=[]
    suffixes={'.js','.mjs','.py','.html','.css','.sql','.json','.md','.yml','.yaml','.svg','.webmanifest','.png','.woff2'}
    for folder in ['lib','contracts/partner','partner/public','operator','scripts','tests','deploy/platform','neon/migrations']:
        paths.extend(p for p in (root/folder).rglob('*') if p.is_file() and p.suffix in suffixes and not any(x in p.parts for x in ['__pycache__','node_modules','dist','.vercel']))
    paths.extend(root/p for p in ['partner/vercel.json','package.json','package-lock.json'] if (root/p).is_file())
    for p in sorted(set(paths),key=lambda p:p.relative_to(root).as_posix()):
        data=p.read_bytes()
        if p.suffix not in {'.png','.woff2'}:data=data.decode('utf-8-sig').replace('\r\n','\n').encode('utf-8')
        digest.update(p.relative_to(root).as_posix().encode());digest.update(b'\0');digest.update(data);digest.update(b'\0')
    return digest.hexdigest()


def set_capture_theme(page,scheme):
    selector=page.locator('select#theme, select#owner-theme')
    if selector.count():selector.select_option(scheme)


def capture_partner_qa_step(page, *, scenario_id, step_id, run=None, theme=None, viewport=None):
    run=run or os.environ.get('PARTNER_QA_EVIDENCE_RUN')
    if not run:return
    for value in [scenario_id,step_id,run]:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}',value):raise ValueError('Unsafe evidence identifier')
    target=ROOT/'docs/partner-qa';(target/'screenshots').mkdir(parents=True,exist_ok=True);(target/'evidence').mkdir(exist_ok=True)
    start_path=target/'evidence/runs'/f'{run}.start.json'
    start=json.loads(start_path.read_text(encoding='utf-8'))
    if start['runId']!=run or start['environment']!='native' or start['sourceFingerprint']!=source_fingerprint():raise ValueError('Capture source does not match native run start')
    original=page.viewport_size
    for width,height,scheme in ([(*viewport,theme)] if viewport and theme else [(1440,960,'light'),(390,844,'dark')]):
        page.set_viewport_size({'width':width,'height':height});page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
        # Page theme selectors take precedence over system theme; set the actual UI.
        set_capture_theme(page,scheme)
        page.wait_for_timeout(100)
        name=f'{scenario_id}-{step_id}-{width}-{scheme}'
        path=target/'screenshots'/f'{name}.png'
        # Mask secrets before pixels are captured, including revealable owner codes.
        mask=page.locator('input,textarea,.owner-access-code,[data-secret],code')
        page.screenshot(path=str(path),full_page=False,animations='disabled',mask=[mask])
        metadata={'schemaVersion':1,'scenarioId':scenario_id,'stepId':step_id,'runId':run,'environment':'native','result':'observed','sourceCommit':start['sourceCommit'],'sourceFingerprint':start['sourceFingerprint'],'startSha256':hashlib.sha256(start_path.read_bytes()).hexdigest(),'testNodeId':os.environ.get('PYTEST_CURRENT_TEST','').split(' (')[0].replace('\\','/'),'viewport':{'width':width,'height':height},'theme':scheme,'screenshot':f'../screenshots/{name}.png','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'description':'Observed rendered state after the documented step; not evidence for unpictured earlier actions.'}
        (target/'evidence'/f'{name}.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    if original:page.set_viewport_size(original)


def capture_final_partner_state(site):
    if not os.environ.get('PARTNER_QA_EVIDENCE_RUN'):return
    node=os.environ.get('PYTEST_CURRENT_TEST','').split(' (')[0].replace('\\','/')
    catalog=ROOT/'docs/partner-qa/scenarios.json'
    if not catalog.exists():return
    items=json.loads(catalog.read_text(encoding='utf-8'))['scenarios']
    scenario=next((x for x in items if x['testNodeId']==node),None)
    if not scenario:return
    pages=[p for context in site.browser.contexts for p in context.pages if not p.is_closed() and p.url.startswith('http')]
    for index,page in enumerate(pages):capture_partner_qa_step(page,scenario_id=scenario['id'],step_id=f'final-{index+1}')
