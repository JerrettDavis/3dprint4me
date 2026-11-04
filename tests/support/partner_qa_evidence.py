from functools import lru_cache
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

@lru_cache(maxsize=1)
def source_fingerprint():
    digest=hashlib.sha256()
    paths=[]
    for folder in ['lib','contracts/partner','partner/public','operator/assets','scripts','tests','deploy/platform','neon/migrations']:
        paths.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in {'.js','.mjs','.py','.html','.css','.sql','.json'} and not any(x in p.parts for x in ['__pycache__','node_modules','dist']))
    paths.extend(ROOT/p for p in ['operator/partners.html','operator/sw.js','operator/vercel.json','partner/vercel.json'])
    for p in sorted(set(paths),key=lambda p:p.relative_to(ROOT).as_posix()):
        digest.update(p.relative_to(ROOT).as_posix().encode());digest.update(b'\0');digest.update(p.read_bytes());digest.update(b'\0')
    return digest.hexdigest()


def capture_partner_qa_step(page, *, scenario_id, step_id, run=None, theme=None, viewport=None):
    run=run or os.environ.get('PARTNER_QA_EVIDENCE_RUN')
    if not run:return
    for value in [scenario_id,step_id,run]:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,160}',value):raise ValueError('Unsafe evidence identifier')
    target=ROOT/'docs/partner-qa';(target/'screenshots').mkdir(parents=True,exist_ok=True);(target/'evidence').mkdir(exist_ok=True)
    original=page.viewport_size
    for width,height,scheme in ([(*viewport,theme)] if viewport and theme else [(1440,960,'light'),(390,844,'dark')]):
        page.set_viewport_size({'width':width,'height':height});page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
        # Page theme selectors take precedence over system theme; set the actual UI.
        selector=page.locator('#theme, #owner-theme')
        if selector.count():selector.select_option(scheme)
        page.wait_for_timeout(100)
        name=f'{scenario_id}-{step_id}-{width}-{scheme}'
        path=target/'screenshots'/f'{name}.png'
        # Mask secrets before pixels are captured, including revealable owner codes.
        mask=page.locator('input,textarea,.owner-access-code,[data-secret],code')
        page.screenshot(path=str(path),full_page=False,animations='disabled',mask=[mask])
        metadata={'schemaVersion':1,'scenarioId':scenario_id,'stepId':step_id,'runId':run,'environment':'native','result':'observed','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'sourceFingerprint':source_fingerprint(),'viewport':{'width':width,'height':height},'theme':scheme,'screenshot':f'../screenshots/{name}.png','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'description':'Observed rendered state after the documented step; not evidence for unpictured earlier actions.'}
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
