"""No browser: validate actual disposable application inputs against published JSON schemas."""
import json
import subprocess
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT=Path(__file__).resolve().parents[2]


def test_template_defaults_and_optional_text_match_static_validators():
    document=json.loads((ROOT/'docs/partner-openapi.json').read_text(encoding='utf-8'))
    components=document['components']
    def validator(name):
        return Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':components},format_checker=FormatChecker())
    variables=validator('TemplateVariables')
    for kind,value in [('string',42),('date',42),('integer','42'),('money','42'),('multiline','   ')]:
        assert not variables.is_valid({'example_value':{'type':kind,'default':value}}),(kind,value)
    for kind,value in [('string','Example'),('date','2026-10-24'),('integer',42),('money',42),('multiline','Example\nText')]:
        assert variables.is_valid({'example_value':{'type':kind,'default':value}}),(kind,value)
    profile=validator('CommandInput_profile_update')
    for value in [None,'','Example']:
        assert profile.is_valid({'expectedRevision':1,'accessibility':value})
    assert not profile.is_valid({'expectedRevision':1,'accessibility':'   '})


def test_documented_command_inputs_match_real_synthetic_application_examples():
    document=json.loads((ROOT/'docs/partner-openapi.json').read_text(encoding='utf-8'))
    Draft202012Validator.check_schema({'$defs':document['components']['schemas']})
    result=subprocess.run(['node','tests/support/partner-api-examples.mjs'],cwd=ROOT,capture_output=True,text=True,timeout=60)
    assert result.returncode==0,result.stderr
    examples=json.loads(result.stdout)
    assert len(examples)>=30
    observed=set()
    for example in examples:
        path='/api/operator-partners' if example['role']=='OWNER' else '/api/partner/v1/commands'
        schema=document['paths'][path]['post']['requestBody']['content']['application/json']['schema']
        # Local references are resolved against this in-memory schema resource;
        # no schema/validator network access is required.
        validator=Draft202012Validator({**schema,'components':document['components']},format_checker=FormatChecker())
        payload={key:example[key] for key in ['action','input']}
        payload['key']='10000000-0000-4000-8000-000000000001'
        errors=list(validator.iter_errors(payload))
        if example['status']==200:
            assert not errors,f"{example['action']}: {[error.message for error in errors]}"
            observed.add(example['action'])
        elif example['status'] in [400,422]:
            assert errors,f"Schema missed invalid structural input for {example['action']}"
        else:
            assert example['status']==409
            assert not errors,'A state-dependent rejection is not a structural schema failure'
    assert {'visit.record','material.record','payment.record','payment.reverse','legal.save','partner.invite','partner.revoke','statement.export','profile.export'}<=observed
