"""Analytical and boundary checks. Synthetic fixtures below are not physical telemetry."""
import math
from datetime import datetime,timedelta,timezone
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app.engineering_models import *
from api.app.energy_model import DEFAULT_ENERGY,simulate_energy
from api.app.telemetry import validate_telemetry,compare_telemetry
from api.app.rover_route import route
from api.app.trajectory_design import lambert,propagate,MU_E,third_body_acceleration
def rows(hours=2,step=.25,sun=True):
 start=datetime(2026,12,25,tzinfo=timezone.utc)
 return [{'t_utc':(start+timedelta(hours=i*step)).isoformat().replace('+00:00','Z'),'sun_azimuth_deg':90.,'sun_elevation_deg':30.,'sun_horizon_deg':0. if sun else 90.,'sun_range_km':AU_KM,'earth_azimuth_deg':270.,'earth_elevation_deg':20.,'earth_horizon_deg':0.,'earth_range_km':384400.} for i in range(round(hours/step)+1)]
def energy(**kw):
 return DEFAULT_ENERGY|{'science_duration_hours':0.,'essential_load_w':10.,'optional_load_w':0.,'science_load_w':0.,'battery_capacity_wh':1000.,'initial_soc':1.}|kw
def test_thermal_constant_power_exact_solution():
 q=THERMAL_DEFAULT|{'emissivity':0.,'capacity_j_k':2000.}
 assert thermal_step(290.,30.,q,20.,40.,10.)==pytest.approx(291.05,abs=1e-12)
def test_radiative_cooling_matches_analytic_solution_and_step_refinement():
 q=THERMAL_DEFAULT|{'ground_view_factor':0.,'space_temperature_k':0.}
 initial=300.;duration=7200.
 exact=(initial**-3+3*q['emissivity']*SIGMA*q['radiating_area_m2']*duration/q['capacity_j_k'])**(-1/3)
 errors=[]
 for step in (60,30,15):
  t=initial
  for _ in range(int(duration/step)):t=thermal_step(t,step,q,0,0,0)
  errors.append(abs(t-exact))
 assert errors[-1]<1e-8 and errors[-1]<errors[0]/20
def test_radiative_equilibrium_is_stationary():
 q=THERMAL_DEFAULT|{'ground_view_factor':0.,'space_temperature_k':0.};power=100.
 t=(power/(q['emissivity']*SIGMA*q['radiating_area_m2']))**.25
 assert thermal_step(t,30,q,0,power,0)==pytest.approx(t,abs=1e-12)
def test_nasa_rf_published_example_margin():
 # NASA NTRS 19970017397, table 2: 19 GHz, 1002.5 km, EIRP 37.8,
 # G/T 20.6, extra losses 4.5, implementation 2, 622 Mbps, required Eb/N0 7.2.
 cfg={'frequency_hz':19e9,'tx_power_w':1.,'tx_gain_dbi':37.8,'rx_gain_dbi':20.6+10*math.log10(30.),'system_noise_k':30.,'loss_db':6.5,'required_ebn0_db':7.2,'required_margin_db':0.,'rate_bps':622e6}
 result=link_budget(1002.5,cfg)
 assert result['free_space_loss_db']==pytest.approx(178.05,abs=.06)
 assert result['margin_db']==pytest.approx(7.4,abs=.15)
def test_friis_distance_power_and_bitrate_invariants():
 a=link_budget(384400.);b=link_budget(768800.)
 assert b['margin_db']-a['margin_db']==pytest.approx(-20*math.log10(2))
 assert link_budget(384400.,{'tx_power_w':10})['margin_db']-a['margin_db']==pytest.approx(10*math.log10(2))
 assert link_budget(384400.,{'rate_bps':200000})['margin_db']-a['margin_db']==pytest.approx(-10*math.log10(2))
 assert link_budget(384400.,{'system_noise_k':60})['margin_db']-a['margin_db']==pytest.approx(-10*math.log10(2))
def test_rf_does_not_create_contacts_through_the_terrain():
 s=rows();s[0]['earth_horizon_deg']=90.
 result=rf_scenario(s)
 assert not result['states'][0]['link_model_pass']
 assert result['summary']['link_model_hours']==pytest.approx(1.75)
def test_battery_curve_interpolates_and_never_extrapolates():
 f=battery_factors(283.15,BATTERY_CURVE)
 assert f['capacity_factor']==pytest.approx(.95)
 assert battery_factors(200.,BATTERY_CURVE) is None
 with pytest.raises(ValueError):battery_factors(280.,list(reversed(BATTERY_CURVE)))
def test_temperature_unavailability_locks_stored_energy_without_deleting_it():
 samples=rows(hours=1,sun=False);q=energy(essential_load_w=100,battery_capacity_wh=100,discharge_efficiency=1.)
 conditions=[{'capacity_factor':.5,'charge_factor':1.,'discharge_factor':1.,'heater_w':0.,'rf_rate_bps':0.} for _ in samples[:-1]]
 out=simulate_energy(samples,q,interval_conditions=conditions)
 assert out['summary']['final_soc']==pytest.approx(.5)
 assert out['summary']['essential_unserved_wh']==pytest.approx(50)
 assert abs(out['summary']['energy_balance_residual_wh'])<1e-8
 assert not out['feasible']
def test_causal_coupling_consumes_heater_energy_and_counts_rf_amplifier_power():
 q=energy(essential_load_w=5.,radio_load_w=0.)
 out=coupled_scenario(rows(hours=1,sun=False),q,None,{}, {'initial_k':270.,'heater_w':50.,'radiating_area_m2':.2}, {'tx_power_w':10.,'pa_efficiency':.2,'electronics_w':3.})
 assert out['status']=='ok' and out['converged']
 assert out['effective_radio_electrical_w']==pytest.approx(53)
 assert out['budget']['summary']['heater_served_wh']>0
 assert out['thermal']['summary']['heater_demand_wh']==pytest.approx(out['budget']['summary']['heater_served_wh'])
 assert abs(out['budget']['summary']['energy_balance_residual_wh'])<1e-7
def test_outside_battery_curve_is_unresolved_not_favorable():
 out=coupled_scenario(rows(1),energy(),None,{}, {'initial_k':200.})
 assert out['status']=='unknown' and out['budget'] is None
def test_missing_rf_station_geometry_blocks_coupled_prediction():
 out=coupled_scenario(rows(1),energy(),None,{},stations={'status':'unknown','states':[]})
 assert out['status']=='unknown' and out['budget'] is None
@pytest.mark.parametrize('raw',[{'initial_k':float('nan')},{'capacity_j_k':False},{'heater_on_k':300,'heater_off_k':290},{'unexpected':2}])
def test_thermal_settings_reject_invalid_numbers(raw):
 with pytest.raises(ValueError):thermal_config(raw)
def test_zero_revolution_lambert_matches_independent_circular_arc():
 radius=7000.;angle=math.pi/2;duration=angle*math.sqrt(radius**3/MU_E)
 v1,v2=lambert([radius,0,0],[0,radius,0],duration)
 circular=math.sqrt(MU_E/radius)
 assert v1==pytest.approx([0,circular,0],abs=1e-9)
 assert v2==pytest.approx([-circular,0,0],abs=1e-9)
def test_third_body_acceleration_vanishes_at_geocentric_origin():
 assert third_body_acceleration(np.zeros(3),np.array([384400.,0,0]),4902.8)==pytest.approx([0,0,0])
def grid(slope=False):
 w=7
 return {'footprint_resolved':True,'source_resolution_m':5.,'sources':[{'name':'synthetic-test-terrain'}],'grid':{'width':w,'height':w,'xmin':-17.5,'ymax':17.5,'spacing_m':5.,'risk':[1]*49,'elevations_m':[0.]*49}}
def test_flat_rover_roundtrip_distance_and_energy_are_physical():
 study=grid();goal=26
 out=route(study,goal_index=goal)
 assert out['status']=='found' and out['roundtrip_distance_m']==pytest.approx(20.,abs=1e-4)
 assert out['roundtrip_hours']==pytest.approx(20/.05/3600,abs=1e-6)
 assert out['energy_wh']>15*out['roundtrip_hours'] and out['points'][0]['index']==out['points'][-1]['index']==24
 assert out['goal_selection']=='explicit_cell'
def test_rover_cannot_jump_unknown_cells_or_cut_diagonal_corners():
 study=grid();study['grid']['risk']=[0]*49;study['grid']['risk'][24]=study['grid']['risk'][32]=1
 out=route(study,goal_index=32)
 assert out['status']=='blocked' and out['points']==[]
def test_rover_insufficient_energy_does_not_return_a_safe_claim():
 out=route(grid(),{'battery_wh':.01},goal_index=26)
 assert out['status']=='insufficient_energy' and out['energy_wh']>out['available_above_reserve_wh']
 assert out['final_soc']>=0
def test_rover_refuses_unresolved_footprints_and_known_failures():
 study=grid();study['footprint_resolved']=False
 assert route(study)['status']=='unknown'
 study['footprint_resolved']=True;study['grid']['risk'][24]=3
 assert route(study)['status']=='blocked'
def mission():return {'arrival_utc':'2026-12-25T00:00:00Z','surface_hours':2}
def record():return {'asset_id':'TEST-ASSET','source':'Synthetic fixture','mode':'replay','kind':'synthetic_test','uncertainty':{'temperature_k':1.,'soc':.02},'samples':[{'t_utc':mission()['arrival_utc'],'temperature_k':293.15,'soc':.85}]}
def test_telemetry_requires_provenance_and_keeps_synthetic_identity():
 q=validate_telemetry(record(),mission())
 assert len(q['sha256'])==64 and q['kind']=='synthetic_test'
 assert compare_telemetry(None,{})['physical_asset_connected'] is False
@pytest.mark.parametrize('change',[{'source':''},{'asset_id':None},{'kind':'live_nasa'},{'mode':'live'},{'uncertainty':{}},{'samples':[{'t_utc':'2026-12-25T00:00:00Z','temperature_k':float('nan'),'soc':1.}]}])
def test_invalid_telemetry_cannot_silently_initialize_a_twin(change):
 with pytest.raises(ValueError):validate_telemetry(record()|change,mission())
def test_telemetry_out_of_order_or_out_of_mission_is_rejected():
 q=record();q['samples']*=2
 with pytest.raises(ValueError):validate_telemetry(q,mission())
 q=record();q['samples'][0]['t_utc']='2026-12-24T23:59:00Z'
 with pytest.raises(ValueError):validate_telemetry(q,mission())
def test_missing_original_data_stays_an_unavailable_engineering_study(monkeypatch):
 import json
 from pathlib import Path
 from api.app import engineering
 from api.app import operations
 async def unavailable(*args):raise FileNotFoundError('NASA raster missing')
 monkeypatch.setattr(operations,'analyze',unavailable)
 app=FastAPI();app.include_router(engineering.router)
 payload=json.loads((Path(__file__).resolve().parents[2]/'data/prepared/operations_example.json').read_text(encoding='utf-8'))['request']
 result=TestClient(app).post('/api/engineering/analyze',json=payload)
 assert result.status_code==503 and result.json()['status']=='unavailable' and 'engineering' not in result.json()

def test_reserve_event_uses_temperature_limited_capacity():
 samples=rows(hours=1,sun=False);q=energy(battery_capacity_wh=100,initial_soc=.55,reserve_soc=.2,essential_load_w=0)
 cond=[{'capacity_factor':.5,'charge_factor':1.,'discharge_factor':1.,'heater_w':0.,'rf_rate_bps':0.} for _ in samples[:-1]]
 out=simulate_energy(samples,q,interval_conditions=cond)
 assert out['summary']['reserve_crossing_hour']==0 and out['summary']['minimum_usable_soc']==pytest.approx(.1)
def test_optional_load_respects_radio_peak_power_and_duty():
 s=rows(1);q=energy(solar_area_m2=.01,solar_efficiency=.001,solar_derate=1.,max_discharge_w=100,essential_load_w=0.,radio_load_w=80.,optional_load_w=80.,science_duration_hours=1.,science_data_mbps=.05,downlink_mbps=.1,science_load_w=0.)
 out=simulate_energy(s,q);pv=.01361
 # Half the interval transmits at 80 W. Optional power is limited to 20 W then, 80 W otherwise.
 assert out['summary']['load_served_wh']==pytest.approx(40+.5*(20+pv)+.5*80)
 assert abs(out['summary']['energy_balance_residual_wh'])<1e-7

def test_rover_automatically_prefers_a_goal_with_an_affordable_return():
 out=route(grid(),{'battery_wh':1.5})
 assert out['status']=='found' and out['energy_wh']<=out['available_above_reserve_wh']
 assert out['goal_selection']=='farthest_affordable_roundtrip_in_window'

def test_variational_propagator_stops_at_a_detected_earth_collision():
 moon=lambda t:np.array([384400.,0,0]);sun=lambda t:np.array([149597870.,0,0])
 out=propagate(np.array([7000.,0,0]),np.array([-1.,0,0]),2000,moon,sun,strength=0.,detect_collision=True)
 assert out.t[-1]<2000 and np.linalg.norm(out.y[:3,-1])==pytest.approx(6378.1366,abs=1e-5)
def test_hardware_provenance_is_bounded_and_never_self_certifies():
 from api.app.hardware_profile import validate_hardware
 raw={'asset_id':'TEST-ASSET','name':'Synthetic configuration','revision':'test-1','references':[{'url':'https://www.nasa.gov/','kind':'design_assumption'}],'calibrated':True}
 out=validate_hardware(raw)
 assert not out['calibrated'] and not out['independently_authenticated']
 with pytest.raises(ValueError):validate_hardware(raw|{'references':[{'url':'https://user:secret@example.com/','kind':'test_report'}]})
def test_copilot_uses_bounded_engineering_measurements_without_claiming_a_real_twin():
 from api.app.chat_science import engineering_facts,baseline_chat,validate_chat_reply
 raw={'status':'ok','physical_calibrated':True,'temperature_min_k':270.,'temperature_max_k':280.,'outside_temperature_limits_hours':1.,'minimum_usable_soc':.4,'rf_minimum_margin_db':3.,'rf_model_hours':10.,'spice_status':'pass','rover_status':'blocked','telemetry_status':'unconnected','trajectory_status':'not_calculated'}
 facts={'operations':None,'engineering':engineering_facts(raw)}
 assert facts['engineering']['physical_calibrated'] is False
 reply=baseline_chat({'facts':facts,'question':'What is the temperature?','language':'en'})
 assert '-3.1' in reply and 'measured battery' in reply
 assert validate_chat_reply(reply,facts)==reply

def test_unresolved_prediction_does_not_erase_synthetic_record_identity():
 q=validate_telemetry(record(),mission());out=compare_telemetry(q,{'budget':None,'thermal':{'status':'unknown'}})
 assert out['status']=='synthetic_test' and out['comparison_status']=='unresolved'
 assert out['record']['kind']=='synthetic_test' and not out['physical_asset_connected']
