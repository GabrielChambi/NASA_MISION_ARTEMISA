import math
from datetime import datetime,timedelta,timezone
import pytest
from api.app.energy_model import DEFAULT_ENERGY,simulate_energy,solar_power,validate_energy,validate_fault,occulted_sun_fraction,AU_KM
from api.app.launch_context import local_to_utc

def samples(hours=8,step=1,sun=False):
 begin=datetime(2026,12,25,tzinfo=timezone.utc)
 return [{'t_utc':(begin+timedelta(hours=i*step)).strftime('%Y-%m-%dT%H:%M:%SZ'),'sun_azimuth_deg':90.,'sun_elevation_deg':30.,'sun_horizon_deg':0. if sun else 90.,'earth_azimuth_deg':270.,'earth_elevation_deg':20.,'earth_horizon_deg':0.,'sun_range_km':AU_KM,'earth_range_km':384400.} for i in range(round(hours/step)+1)]

def config(**kw):
 return DEFAULT_ENERGY|{'solar_area_m2':1.,'solar_efficiency':.3,'solar_derate':1.,'battery_capacity_wh':100.,'initial_soc':1.,'reserve_soc':.2,'essential_load_w':25.,'optional_load_w':0.,'science_load_w':0.,'radio_load_w':0.,'science_duration_hours':0.,'charge_efficiency':1.,'discharge_efficiency':1.}|kw

def test_darkness_depletion_and_unserved_energy_are_not_hidden():
 r=simulate_energy(samples(),config())
 assert r['summary']['battery_empty_hour']==pytest.approx(4)
 assert r['summary']['essential_unserved_wh']==pytest.approx(100)
 assert r['summary']['energy_balance_residual_wh']==pytest.approx(0,abs=1e-8)
 assert not r['feasible']

def test_discharge_efficiency_splits_depletion_inside_an_hour():
 r=simulate_energy(samples(),config(discharge_efficiency=.8))
 assert r['summary']['battery_empty_hour']==pytest.approx(3.2)
 assert r['summary']['essential_unserved_wh']==pytest.approx(120)
 assert r['summary']['discharge_loss_wh']==pytest.approx(20)
 assert r['summary']['energy_balance_residual_wh']==pytest.approx(0,abs=1e-7)

def test_reserve_is_distinct_from_empty_and_final_sample_adds_no_hour():
 r=simulate_energy(samples(5),config(initial_soc=.5,essential_load_w=10))
 assert r['summary']['reserve_crossing_hour']==pytest.approx(3)
 assert r['summary']['battery_empty_hour']==pytest.approx(5)
 assert r['summary']['load_served_wh']==pytest.approx(50)

def test_incidence_distance_and_eclipse_use_geometry():
 s=samples(1,sun=True)[0];q=config();f=validate_fault(None,1)
 assert solar_power(s,q,f,0)==pytest.approx(408.3)
 assert solar_power(s,q|{'panel_mode':'fixed','panel_tilt_deg':0},f,0)==pytest.approx(204.15)
 assert solar_power(s|{'sun_range_km':2*AU_KM},q,f,0)==pytest.approx(408.3/4)
 assert occulted_sun_fraction(s|{'earth_azimuth_deg':90.,'earth_elevation_deg':30.})==pytest.approx(1)
 assert solar_power(s|{'earth_azimuth_deg':90.,'earth_elevation_deg':30.},q,f,0)==0

def test_charge_efficiency_excess_and_balance():
 r=simulate_energy(samples(1,sun=True),config(initial_soc=.5,essential_load_w=20,charge_efficiency=.9))
 assert r['summary']['final_soc']==pytest.approx(1)
 assert r['summary']['battery_charge_wh']==pytest.approx(50)
 assert r['summary']['curtailed_wh']>0
 assert r['summary']['charge_loss_wh']==pytest.approx(50/.9-50)
 assert r['summary']['energy_balance_residual_wh']==pytest.approx(0,abs=1e-8)

def test_fault_at_half_hour_does_not_apply_to_the_full_hour():
 q=config(battery_capacity_wh=1000,initial_soc=0,essential_load_w=0)
 r=simulate_energy(samples(1,sun=True),q,{'solar_loss_fraction':1.,'solar_fault_start_hour':.5})
 assert r['summary']['solar_generated_wh']==pytest.approx(408.3*.5)

def test_missing_horizon_keeps_energy_unknown():
 s=samples(1,sun=True);s[0]['sun_horizon_deg']=None
 r=simulate_energy(s,config())
 assert r['status']=='unknown' and r['summary']['final_soc'] is None and not r['feasible']

@pytest.mark.parametrize('bad',[True,float('nan'),-1,2])
def test_fraction_inputs_reject_invalid_values(bad):
 with pytest.raises(ValueError):validate_energy({'solar_efficiency':bad})

def test_activity_suspension_is_reported_and_not_counted_as_science():
 r=simulate_energy(samples(2),config(battery_capacity_wh=1,essential_load_w=0,science_load_w=60,science_duration_hours=2))
 assert r['summary']['science_completed_hours']<2
 assert any(e['type']=='science_suspended' for e in r['events'])
 assert not r['feasible']

def test_memory_overflow_persists_even_after_later_downlink():
 s=samples(2,sun=True)
 for row in s[:1]:row['earth_horizon_deg']=90
 q=config(battery_capacity_wh=10000,essential_load_w=0,science_load_w=0,science_duration_hours=2,science_data_mbps=1,downlink_mbps=10,storage_gb=.1)
 r=simulate_energy(s,q)
 assert r['summary']['data_lost_gb']>.3 and not r['feasible']

@pytest.mark.parametrize('tz,local,expected',[
 ('America/New_York','2026-12-01T10:00','2026-12-01T15:00:00+00:00'),
 ('America/New_York','2026-07-01T10:00','2026-07-01T14:00:00+00:00'),
 ('America/Los_Angeles','2026-12-01T10:00','2026-12-01T18:00:00+00:00'),
 ('America/Los_Angeles','2026-07-01T10:00','2026-07-01T17:00:00+00:00')])
def test_launch_timezones_observe_seasonal_offsets(tz,local,expected):assert local_to_utc(local,tz).isoformat()==expected

@pytest.mark.parametrize('local',['2026-03-08T02:30','2026-11-01T01:30'])
def test_ambiguous_and_nonexistent_launch_times_require_clarification(local):
 with pytest.raises(ValueError):local_to_utc(local,'America/New_York')


def test_radio_duty_cycle_cannot_hide_an_impossible_peak_power():
 q=config(battery_capacity_wh=100,initial_soc=1,reserve_soc=0,max_discharge_w=10,essential_load_w=0,science_load_w=0,science_duration_hours=1,radio_load_w=100,science_data_mbps=.1,downlink_mbps=1)
 r=simulate_energy(samples(1),q)
 assert r['summary']['data_generated_gb']==pytest.approx(.045)
 assert r['summary']['data_sent_gb']==0
 assert r['summary']['buffer_final_gb']==pytest.approx(.045)
 assert not r['feasible']
