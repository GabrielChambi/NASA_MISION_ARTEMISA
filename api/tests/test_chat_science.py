import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app import copilot
from api.app.chat_science import validate_chat,baseline_chat,validate_chat_reply

def context():
 return {'message':'¿Cuántos candidatos hay?','context':{'counts':{'green':0,'yellow':0,'red':12797,'unknown':95},'regional':{'totalCells':12892},'best':None,'alternatives':[],'selected':{'id':'polar:5:56','lat':-80.78,'lon':-7.3,'slopeDeg':9.48,'sunHours':None,'earthHours':None}}}

@pytest.fixture
def client(monkeypatch):
 for name in ('AI_PROVIDER','AI_MODEL','AI_API_KEY','AI_BASE_URL','GEMINI_API_KEY'):monkeypatch.delenv(name,raising=False)
 app=FastAPI();app.include_router(copilot.router);return TestClient(app)

def test_missing_facts_never_default_to_twenty_four_greens_or_four_candidates():
 a=baseline_chat(validate_chat(context()))
 assert '0 candidatos' in a and '0 sectores favorables' in a
 b=baseline_chat(validate_chat({'message':'cuántos lugares','context':{}}))
 assert '24' not in b and '4 candidatos' not in b and 'primero' in b

def test_operational_budget_is_separate_from_the_regional_site():
 v=context();v['message']='¿Cómo está mi batería?';v['context']['operations']={'status':'ok','feasible':False,'summary':{'minimum_soc':.125,'science_completed_hours':4}}
 out=baseline_chat(validate_chat(v))
 assert '12.5%' in out and '4 h' in out and 'necesita ajustes' in out

def test_hardware_unknowns_and_uncomputed_digits_cannot_become_ai_facts():
 facts=validate_chat(context())['facts']
 with pytest.raises(ValueError):validate_chat_reply('Dispones de 24 sectores favorables y puedes alunizar.',facts)
 with pytest.raises(ValueError):validate_chat_reply('La zona segura garantiza el éxito de la misión.',facts)
 assert validate_chat_reply('Hay 0 sectores favorables en el contexto actual.',facts)

def test_grounded_chat_is_bounded_and_handles_missing_configuration(client):
 value=client.post('/api/copilot/chat',json=context())
 assert value.status_code==200 and value.json()['mode']=='guide'
 assert '0 candidatos' in value.json()['explanation']
 assert client.post('/api/copilot/chat',content=b' '*32769,headers={'content-type':'application/json'}).status_code==413
 assert client.post('/api/copilot/chat',json={'message':'a'*1601}).status_code==422

def test_provider_output_with_new_numbers_falls_back_without_losing_evidence(client,monkeypatch):
 monkeypatch.setattr(copilot,'configuration',lambda:{'provider':'gemini','base':'https://provider.test','model':'test','key':'private-test-only'})
 async def response(*args,**kwargs):return {'candidates':[{'content':{'parts':[{'text':'Hay 24 zonas y son lugares seguros.'}]}}]}
 monkeypatch.setattr(copilot,'provider_json',response)
 result=client.post('/api/copilot/chat',json=context()).json()
 assert result['mode']=='guide' and result['evidence']['counts']['green']==0
 assert '0 candidatos' in result['explanation'] and '24 zonas' not in result['explanation']

def test_launch_location_comes_from_the_authoritative_catalogue():
 value=context();value['message']='¿Desde dónde lanzamos?';value['context']['launch_site']={'id':'ksc-39b','name':'Invented facility'};value['context']['mission_time_zone']='UTC'
 out=baseline_chat(validate_chat(value))
 assert 'Kennedy Space Center' in out and 'Invented facility' not in out and 'UTC' in out

@pytest.mark.parametrize('slope',[None,15.2])
def test_pinned_location_does_not_invent_a_season_or_a_temporal_result(slope):
 value={'message':'¿Qué días puedo visitar este lugar?','context':{'pinned_target':{'id':'polar:5:56','lat':-80.78,'lon':-7.3,'slopeDeg':slope}}}
 parsed=validate_chat(value);out=baseline_chat(parsed)
 assert parsed['facts']['total_cells'] is None and parsed['facts']['candidate_count']==0
 assert 'Indica una fecha' in out and 'no hay condiciones temporales calculadas' in out
 assert not any(word in out.lower() for word in ('noviembre','febrero','2026','2027','ventana recomendada'))
 assert ('sin determinar' in out) is (slope is None)

def test_operations_routes_are_registered_once():
 from api.app.main import app
 import warnings
 app.openapi_schema=None
 with warnings.catch_warnings(record=True) as caught:
  warnings.simplefilter('always')
  schema=app.openapi()
 assert '/api/operations/analyze' in schema['paths'] and '/api/operations/replan' in schema['paths']
 assert not any('Duplicate Operation ID' in str(w.message) for w in caught)
