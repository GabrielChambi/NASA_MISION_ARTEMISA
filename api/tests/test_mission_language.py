import json
from pathlib import Path
from unittest.mock import AsyncMock
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app import mission_intent as module
from api.app.text_normalization import normalize_mission_text
from api.app.semantic_command import validate_rewrite,router as command_router
CASES=json.loads((Path(__file__).resolve().parents[2]/'data/fixtures/mission-language.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('case',CASES,ids=[c['message'] for c in CASES])
def test_shared_typing_and_calendar_corpus(case):
 value=module.parse_mission_intent({'message':case['message'],'timezone':case['timezone']})
 if 'utc' in case:
  assert value['needs_clarification'] is False
  assert value['intent']['departure_utc']==case['utc']
  assert value['intent']['date_kind']==case['date_kind']
 else:
  assert value['needs_clarification'] is True
  assert 'departure_utc' not in value['intent']
  assert case['clarify_contains'] in value['question'].lower()

def test_exact_screenshot_works_when_gemini_fails(monkeypatch):
 monkeypatch.setenv('GEMINI_API_KEY','test-server-only')
 monkeypatch.setattr(module,'infer',AsyncMock(side_effect=RuntimeError('provider unavailable')))
 app=FastAPI();app.include_router(module.router)
 result=TestClient(app).post('/api/mission-intent',json={'message':CASES[0]['message'],'timezone':'America/New_York'}).json()
 assert result['needs_clarification'] is False and result['intent']['departure_utc']=='2026-12-01T15:00:00Z'
 assert result['mode']=='parser'

def test_normalization_preserves_numbers_units_and_calendar_errors():
 text=normalize_mission_text('Batería 1000 Wh; solar20% menos; 30de febrerode2026')
 assert '1000 wh' in text and '20%' in text and '30 de febrero de 2026' in text
 assert 'un viaje' in normalize_mission_text('un viaje')

@pytest.mark.parametrize('rewritten',[
 'Batería de 2000 Wh','Batería de 100 Wh','Batería de 1000 Wh y reserva del20%',
])
def test_semantic_commands_cannot_add_or_drop_numbers(rewritten):
 with pytest.raises(ValueError):validate_rewrite('Batería de 1000 Wh',{'normalized_message':rewritten,'needs_clarification':False,'question':''})

def test_semantic_command_preserves_negative_instruction():
 with pytest.raises(ValueError):validate_rewrite('No cambies la batería de1000 Wh',{'normalized_message':'Batería de1000 Wh','needs_clarification':False,'question':''})

def test_command_endpoint_limits_input_and_does_not_claim_ai_without_a_model(monkeypatch):
 from api.app import semantic_command
 monkeypatch.setattr(semantic_command,'configuration',lambda:None)
 app=FastAPI();app.include_router(command_router);client=TestClient(app)
 assert client.post('/api/copilot/command',content='{}').status_code==415
 assert client.post('/api/copilot/command',content=b' '*12289,headers={'content-type':'application/json'}).status_code==413
 result=client.post('/api/copilot/command',json={'message':'Quiero hacerlo de otra forma'}).json()
 assert result['needs_clarification'] is True and result['mode']=='guide'
 assert 'normalized_message' not in result
