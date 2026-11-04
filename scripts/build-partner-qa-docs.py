"""Build readable BDD inventory from the maintained native acceptance tests."""
import ast
import json
import re
import subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/partner-qa'


def describe_call(call):
    if not isinstance(call.func,ast.Attribute):return None
    name=call.func.attr
    if name not in ['goto','fill','click','check','select_option','reload']:return None
    text=ast.unparse(call)
    labels=re.findall(r"(?:name=|get_by_label\()(['\"])(.*?)\1",text)
    label=next((x[1] for x in reversed(labels)),None)
    if name=='goto':return 'Open '+ast.unparse(call.args[0]) if call.args else None
    if name=='reload':return 'Reload the current page and revalidate its session'
    target=label or ast.unparse(call.func.value)
    value=' '+ast.unparse(call.args[0]) if call.args else ''
    return {'fill':'Enter','click':'Activate','check':'Confirm','select_option':'Select'}[name]+' '+target+value


def explicit_evidence_steps(fn):
    return sorted({keyword.value.value for call in ast.walk(fn) if isinstance(call,ast.Call) and isinstance(call.func,ast.Name) and call.func.id=='capture_partner_qa_step' for keyword in call.keywords if keyword.arg=='step_id' and isinstance(keyword.value,ast.Constant) and isinstance(keyword.value.value,str)})


def build():
    files=sorted((ROOT/'tests/integration').glob('test_partner_*browser.py'))
    collect=subprocess.run(['python','-m','pytest',*[str(p.relative_to(ROOT)) for p in files],'--collect-only','-q'],cwd=ROOT,capture_output=True,text=True,check=True)
    nodes=[line.strip().replace('\\','/') for line in collect.stdout.splitlines() if line.startswith('tests/') and '::test_' in line]
    source={}
    for path in files:
        text=path.read_text(encoding='utf-8-sig')
        for fn in ast.parse(text).body:
            if isinstance(fn,ast.FunctionDef) and fn.name.startswith('test_'):source[(path.name,fn.name)]=(fn,text,path)
    scenarios=[];number=0
    for node in nodes:
        file,fnname=node.split('::');base=fnname.split('[')[0];fn,text,path=source[(Path(file).name,base)]
        if base.startswith('test_production_portal_qa'):sid='QA-060'
        else:number+=1;sid=f'QA-{number:03}'
        title=re.sub(r'^test_(native_|production_portal_)?','',fnname).replace('_',' ')
        group=path.stem.removeprefix('test_partner_').removesuffix('_browser')
        steps=[]
        for item in sorted((n for n in ast.walk(fn) if isinstance(n,ast.Call)),key=lambda n:(n.lineno,n.col_offset)):
            desc=describe_call(item)
            if desc and desc not in steps:steps.append(desc)
        expected=[ast.unparse(n.test) for n in ast.walk(fn) if isinstance(n,ast.Assert)]
        nonvisual=not steps
        item={'id':sid,'title':title,'feature':f'features/{group}.feature','testNodeId':node,'source':file,'actor':'Owner and/or scoped partner as specified in each step','prerequisites':'Disposable PostgreSQL fixture and real browser HTTP boundaries; synthetic review evidence only. Production-portal QA uses the isolated QA realm.','inputs':'Fictional fixture businesses/participants and bounded amounts from the linked native test. No real work, consent or funds.','steps':[{'id':f'action-{i+1:02}','description':s[:400]} for i,s in enumerate(steps)],'expected':expected,'retry':'Use the same command identity for uncertain committed responses; other tests assert explicit conflict/replay behavior as named. Never automatically replay into another realm.','cleanup':'Context managers close browsers and remove disposable containers; hosted QA retires only the selected run and preserves history.','evidenceRequirement':'nonvisual' if nonvisual else 'browser-final','status':'not-run'}
        item['evidenceSteps']=explicit_evidence_steps(fn)
        scenarios.append(item)
    OUT.mkdir(parents=True,exist_ok=True);(OUT/'features').mkdir(exist_ok=True);(OUT/'flows').mkdir(exist_ok=True)
    for group in sorted({x['feature'] for x in scenarios}):
        rows=[x for x in scenarios if x['feature']==group]
        feature='Feature: '+Path(group).stem.replace('_',' ')+'\n  Synthetic acceptance evidence; no actual professional approval or payment.\n\n  Background:\n    Given an isolated PostgreSQL fixture and authenticated scoped actors\n    And only synthetic participants, business records and simulation evidence\n\n'
        for x in rows:
            feature+=f'  @{x["id"]}\n  Scenario: {x["title"]}\n'
            if x['steps']:
                for step in x['steps']:feature+='    When '+json.dumps(step['description'],ensure_ascii=False)+'\n'
            else:feature+='    When the documented infrastructure or API operation runs\n'
            feature+='    Then the linked native assertions confirm the expected persisted and access-control effects\n    And no actual clearance, work or funds are represented by the test\n\n'
        (OUT/group).write_text(feature,encoding='utf-8')
    (OUT/'scenarios.json').write_text(json.dumps({'schemaVersion':1,'scenarios':scenarios},indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    render(scenarios)
    print(f'Documented {len(scenarios)} native cases, including parameterized variants.')


def render(scenarios):
    for x in scenarios:
        body=f'# {x["id"]}: {x["title"]}\n\nStatus: **{x.get("status","not-run")}**. Environment: native disposable browser/API/PostgreSQL fixture; hosted observations are separate.\n\n'
        body+=f'Automation: `{x["testNodeId"]}`. [Maintained native source](../../../{x["source"]}). [Gherkin](../{x["feature"]}).\n\n'
        for label,key in [('Actor','actor'),('Prerequisites','prerequisites'),('Inputs','inputs')]:body+=f'**{label}:** {x[key]}\n\n'
        body+='## Given / When\n\n'
        for step in x['steps']:body+=f'- **{step["id"]}:** {step["description"]}\n'
        if not x['steps']:body+='Nonvisual infrastructure/API case; use assertions and run result, not a fabricated UI image.\n'
        body+='\n## Then: exact observable and persisted checks\n\n'
        for expectation in x['expected']:body+='- `'+expectation.replace('`','\\`').replace('\n',' ')+'`\n'
        body+=f'\n**Retry/failure behavior:** {x["retry"]}\n\n**Cleanup:** {x["cleanup"]}\n\n## Screenshot evidence\n\n'
        images=sorted((OUT/'evidence').glob(x['id']+'-*.json')) if (OUT/'evidence').exists() else []
        if not images:body+='No screenshot captured yet. This does not indicate a passing UI run.\n'
        for path in images:
            m=json.loads(path.read_text(encoding='utf-8'));caption=f'{m["stepId"]}, {m["viewport"]["width"]} px {m["theme"]}; {m["environment"]} run {m["runId"]}'
            body+=f'**{caption}.** {m["description"]}\n\n![{caption}]({m["screenshot"]})\n\n'
        (OUT/'flows'/f'{x["id"]}.md').write_text(body,encoding='utf-8')


if __name__=='__main__':build()
