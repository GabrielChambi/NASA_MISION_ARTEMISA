import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app.mission_intent import parse_mission_intent,router as intent_router
from api.app.localization import localize_payload
from api.app import copilot
from api.app.chat_science import validate_chat,baseline_chat,validate_chat_reply
CASES=json.loads((Path(__file__).resolve().parents[2]/'data/fixtures/mission-english.json').read_text(encoding='utf-8'))
@pytest.mark.parametrize('case',CASES)
def test_english_calendar_and_time_parity(case):
 r=parse_mission_intent({**case,'language':'en'})
 assert r['needs_clarification'] is bool(case.get('invalid'))
 if not case.get('invalid'):assert r['intent']['departure_utc']==case['utc'] and r['intent']['date_kind']==case['date_kind']
 else:assert not any(w in (r.get('question') or '').lower() for w in ('fecha','año','hora'))
def test_localization_preserves_machine_fields_and_scientific_values():
 value={'question':'Reconocí el día y el mes. ¿De qué año es la misión?','intent':{'departure_utc':'2026-12-25T13:00:00Z','date_kind':'departure','surface_hours':72},'counts':{'green':9},'id':'polar:29:26','user_request':'Tierra'}
 r=localize_payload(value,'en')
 assert 'year' in r['question'].lower()
 for k in ('intent','counts','id','user_request'):assert r[k]==value[k]
def test_english_header_localizes_the_actual_intent_http_response(monkeypatch):
 from api.app import mission_intent
 monkeypatch.setattr(mission_intent,'configuration',lambda:None)
 app=FastAPI();app.include_router(intent_router)
 result=TestClient(app).post('/api/mission-intent',headers={'X-Lunar-Language':'en'},json={'message':'Travel on December 25 at 8am'}).json()
 assert result['needs_clarification'] is True and 'year' in result['question'].lower()

def visibility_context():
 return {'message':'Why is Earth blocked in the view?','context':{'visibility':{'t_utc':'2026-12-06T13:00:00Z','earth':{'elevation_deg':-1.884,'horizon_deg':-1.47,'azimuth_deg':11,'observer_height_m':2},'sun':{'elevation_deg':1.2,'horizon_deg':.8,'azimuth_deg':115,'observer_height_m':2}}}}
def test_explanation_uses_actual_angles_and_never_invents_an_obstacle_distance():
 value=validate_chat(visibility_context());v=value['facts']['visibility']['earth']
 assert abs(v['clearance_deg']+.414)<1e-12 and v['state']=='occluded'
 explanation=localize_payload({'explanation':baseline_chat(value)},'en')['explanation']
 assert '-1.884' in explanation and '-1.47' in explanation and '-0.414' in explanation and 'hidden' in explanation
 assert 'camera' in explanation.lower() and 'radio' in explanation.lower() and 'does not calculate' in explanation.lower()
@pytest.mark.parametrize('e,h,state',[(-.4,-1,'clear'),(.1,0,'limited'),(1.3,1,'limited')])
def test_geometric_visibility_and_required_margin_remain_distinct(e,h,state):
 value=visibility_context();value['context']['visibility']['earth'].update(elevation_deg=e,horizon_deg=h)
 assert validate_chat(value)['facts']['visibility']['earth']['state']==state
def test_absent_angles_are_unresolved_and_do_not_become_flat_terrain():
 value=validate_chat({'message':'Why is Earth blocked?','context':{}})
 assert 'No hay ángulos' in baseline_chat(value)
 value=visibility_context();value['context']['visibility']['earth']['horizon_deg']=None
 with pytest.raises(ValueError):validate_chat(value)
@pytest.mark.parametrize('reply',['NASA guarantees a safe landing here.','There are twenty favorable sites.','The spacecraft will survive.'])
def test_english_ai_output_obeys_the_same_scientific_limits(reply):
 with pytest.raises(ValueError):validate_chat_reply(reply,validate_chat(visibility_context())['facts'])
def test_lander_explanation_accepts_grounded_english_but_rejects_guarantees():
 reply={'summary':'This is regional screening with limited evidence.','risk_alert':'The local footprint remains unknown and has not been certified.','site_recommendation':'No verified alternative is available in this context.','hardware_recommendation':'Any height change requires recalculation of the local horizons.'}
 # Use an uncertainty statement without an approval term, even in the negative.
 reply['risk_alert']='The local footprint remains unknown and needs further study.'
 assert copilot.validate_lander_review_reply(reply,{'alternative':None})==reply
 with pytest.raises(copilot.CopilotError):copilot.validate_lander_review_reply({**reply,'summary':'Sufficient energy and a safe landing are guaranteed.'},{'alternative':None})

def test_fragment_translation_preserves_word_boundaries_and_embedded_quantities():
 from api.app.localization import translate_text
 out=translate_text('Solar production. Estancia declarada: 72 h. Centro regional: 82.3°S, 47.3°O.','en')
 assert out.startswith('Solar production.') and '72 h' in out and 'Declared surface stay:' in out and 'Regional center:' in out and '47.3°W' in out
