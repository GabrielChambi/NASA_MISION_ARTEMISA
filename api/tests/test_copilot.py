"""Copilot responses never replace numerical tools or expose provider credentials."""
import copy
import json
import pytest
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app import copilot as module

app=FastAPI()
app.include_router(module.router)
client=TestClient(app)
CONTEXT={
    'selected':{'id':'local:one','name':'Connecting ridge','lat':-89.4,'lon':-137.5,'slopeDeg':4.2,'resolutionM':5,'coverage':'local'},
    'regional':{'scope':'80S–90S','sourceResolutionM':80,'totalCells':16000,'knownCells':11000,'evaluated':True},
    'simulation':{'status':'ready','risk':'red','reasons':['Pendiente excesiva'],'sunHours':72,'earthHours':26},
    'alternatives':[{'id':'polar:1','name':'Candidato regional','lat':-88,'lon':10,'slopeDeg':2,'resolutionM':80}]
}
INPUT={'message':'¿Por qué ese cuadrado pequeño?','context':CONTEXT}
REPLY={'explanation':'La vista regional preselecciona terreno; revisa el detalle antes de evaluar un aterrizaje.','intent':'find_sites','action':{'type':'select_cell','target_id':'polar:1'}}

@pytest.fixture(autouse=True)
def clear_config(monkeypatch):
    for name in ('AI_PROVIDER','AI_MODEL','AI_API_KEY','AI_BASE_URL','GEMINI_API_KEY'):
        monkeypatch.delenv(name,raising=False)

def gemini(monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','gemini')
    monkeypatch.setenv('GEMINI_API_KEY','test-only-secret')
    monkeypatch.setenv('AI_MODEL','gemini-3.5-flash-lite')

def test_no_key_guide_mode_is_explicit_and_numerical_facts_remain_sourced():
    r=client.post('/api/copilot',json=INPUT)
    assert r.status_code==200
    result=r.json()
    assert result['mode']=='guide'
    assert result['reason']=='model_not_configured'
    assert result['intent']=='why_square'
    assert result['action']=={'type':'polar_view'}
    assert next(f for f in result['evidence'] if f['id']=='sun-hours')['value']==72
    assert result['sources'][0]['url']=='https://pgda.gsfc.nasa.gov/products/78'
    assert client.get('/api/copilot/status').json()['available'] is False

def test_gemini_native_inference_uses_schema_and_known_actions(monkeypatch):
    gemini(monkeypatch)
    async def fake(url,config,body=None,timeout=45):
        assert url=='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
        assert 'test-only-secret' not in url
        assert config['key']=='test-only-secret'
        assert body['generationConfig']['responseMimeType']=='application/json'
        assert 'No escribas números' in body['systemInstruction']['parts'][0]['text']
        return {'candidates':[{'content':{'parts':[{'text':json.dumps(REPLY)}]}}]}
    monkeypatch.setattr(module,'provider_json',fake)
    result=client.post('/api/copilot',json=INPUT).json()
    assert result['mode']=='ai'
    assert result['action']==REPLY['action']
    assert 'test-only-secret' not in json.dumps(result)

@pytest.mark.parametrize('patch',[
    {'explanation':'Tendrás 100 horas de luz para tu misión.'},
    {'explanation':'Es un aterrizaje seguro y aprobado por NASA.'},
    {'action':{'type':'select_cell','target_id':'invented'}},
    {'action':{'type':'execute_code'}},
    {'explanation':'Consulta https://untrusted.example para continuar.'},
])
def test_invalid_model_output_falls_back_to_labelled_guide(monkeypatch,patch):
    gemini(monkeypatch)
    async def fake(*args,**kwargs):
        return {'candidates':[{'content':{'parts':[{'text':json.dumps({**REPLY,**patch})}]}}]}
    monkeypatch.setattr(module,'provider_json',fake)
    result=client.post('/api/copilot',json=INPUT).json()
    assert result['mode']=='guide'
    assert result['reason']=='invalid_model_reply'
    assert result['action']=={'type':'polar_view'}

def test_status_metadata_probe_and_failures_are_honest(monkeypatch):
    gemini(monkeypatch)
    async def fake(url,config,body=None,timeout=45):
        assert body is None
        assert timeout==2
        return {'name':'models/gemini-3.5-flash-lite','supportedGenerationMethods':['generateContent']}
    monkeypatch.setattr(module,'provider_json',fake)
    assert client.get('/api/copilot/status').json()['available'] is True
    async def failure(*args,**kwargs):raise RuntimeError('secret diagnostic')
    monkeypatch.setattr(module,'provider_json',failure)
    result=client.get('/api/copilot/status').json()
    assert result['mode']=='guide'
    assert 'secret diagnostic' not in json.dumps(result)
    assert client.post('/api/copilot',json=INPUT).json()['mode']=='guide'

def test_numeric_context_is_bounded_and_stale_data_is_not_evidence():
    context=copy.deepcopy(CONTEXT)
    context['selected']['slopeDeg']=float('inf')
    context['selected']['secret']='must be removed'
    context['simulation']['status']='stale'
    clean=module.validate_input({'message':'Ayuda','context':context})
    assert 'slopeDeg' not in clean['context']['selected']
    assert 'secret' not in clean['context']['selected']
    assert not any(f['id']=='sun-hours' for f in module.evidence(clean['context']))

@pytest.mark.parametrize('body,status',[
    ({'message':''},422),({'message':'x'*1300},422),({'message':'x'*13000},413),
])
def test_input_limits(body,status):
    assert client.post('/api/copilot',json=body).status_code==status

def test_malformed_json_and_content_type():
    assert client.post('/api/copilot',content='invalid',headers={'Content-Type':'application/json'}).status_code==422
    assert client.post('/api/copilot',content='text').status_code==415

def test_config_does_not_allow_remote_plaintext_or_credential_urls():
    assert module.configuration({'AI_PROVIDER':'gemini','GEMINI_API_KEY':'key','AI_BASE_URL':'http://remote.test/v1beta'}) is None
    assert module.configuration({'AI_PROVIDER':'gemini','GEMINI_API_KEY':'key','AI_BASE_URL':'https://user:pass@remote.test/v1beta'}) is None
    assert module.configuration({'AI_PROVIDER':'gemini','GEMINI_API_KEY':'key','AI_MODEL':'../other/path'}) is None
    assert module.configuration({'AI_PROVIDER':'gemini','GEMINI_API_KEY':'key'})['model']=='gemini-3.5-flash-lite'


@pytest.mark.parametrize('status_code,reason',[
    (401,'invalid_api_key'),(403,'permission_denied'),(404,'model_not_available'),
    (429,'quota_exceeded'),(500,'provider_unavailable'),(502,'provider_unavailable'),
])
def test_provider_status_diagnostics_are_bounded_and_never_expose_keys(monkeypatch,status_code,reason):
    gemini(monkeypatch)
    async def failure(*args,**kwargs):
        request=httpx.Request('POST','https://generativelanguage.googleapis.com/v1beta/models/test:generateContent')
        response=httpx.Response(status_code,request=request,json={'error':{'message':'test-only-secret private diagnostic'}})
        raise httpx.HTTPStatusError('test-only-secret private diagnostic',request=request,response=response)
    monkeypatch.setattr(module,'provider_json',failure)
    for result in (client.get('/api/copilot/status').json(),client.post('/api/copilot',json=INPUT).json()):
        assert result['mode']=='guide'
        assert result['reason']==reason
        assert 'test-only-secret' not in json.dumps(result)
        assert 'private diagnostic' not in json.dumps(result)


@pytest.mark.parametrize('payload,reason',[
    ({'error':{'details':[{'reason':'API_KEY_INVALID','metadata':{'key':'test-only-secret'}}]}},'invalid_api_key'),
    ({'error':{'details':[{'reason':'API_KEY_EXPIRED'}]}},'invalid_api_key'),
    ({'error':{'details':[{'reason':'INVALID_ARGUMENT'}],'message':'test-only-secret'}},'provider_unavailable'),
    ({'error':{'details':'API_KEY_INVALID'}},'provider_unavailable'),
    ({'error':['API_KEY_INVALID']},'provider_unavailable'),
])
def test_gemini_400_known_error_info_is_classified_without_leaking_payload(monkeypatch,payload,reason):
    gemini(monkeypatch)
    original=httpx.AsyncClient
    transport=httpx.MockTransport(lambda request:httpx.Response(400,json=payload))
    monkeypatch.setattr(module.httpx,'AsyncClient',lambda **kwargs:original(transport=transport,**kwargs))
    for result in (client.get('/api/copilot/status').json(),client.post('/api/copilot',json=INPUT).json()):
        assert result['mode']=='guide'
        assert result['reason']==reason
        assert 'test-only-secret' not in json.dumps(result)
        assert 'API_KEY_INVALID' not in json.dumps(result)
