import json,math
from pathlib import Path
import numpy as np
import pytest
from fastapi.testclient import TestClient
from api.app.main import app
from api.app import native_terrain as native
from api.app.operations import validate_request,validate_landing

ROOT=Path(__file__).resolve().parents[2]
@pytest.fixture
def site01():
 return json.loads((ROOT/'data/catalog/sites.json').read_text(encoding='utf-8'))['sites'][0]

@pytest.mark.skipif(not (ROOT/'data/raw/regional80m.tif').exists(),reason='Original NASA rasters must be acquired locally')
def test_real_height_specific_horizons_recompute_every_obstruction(site01):
 a=native.horizon_profile(site01['latitude_deg'],site01['longitude_deg'],2.,2.)
 b=native.horizon_profile(site01['latitude_deg'],site01['longitude_deg'],50.,38.)
 assert a['near_complete'] and b['near_complete']
 assert len(a['profiles']['sun'])==360
 assert np.all(np.asarray(b['profiles']['sun'])<=np.asarray(a['profiles']['sun'])+1e-10)
 assert np.any(np.asarray(b['profiles']['sun'])<np.asarray(a['profiles']['sun'])-.01)
 assert b['observer_heights_m']=={'sun':50.,'earth':38.}
 assert all(len(source['sha256'])==64 for source in b['sources'])

@pytest.mark.skipif(not (ROOT/'data/raw/site01.tif').exists(),reason='Original NASA rasters must be acquired locally')
def test_real_five_metre_footprints_cover_the_full_dispersion_ellipse(site01):
 result=native.native_footprint(site01['latitude_deg'],site01['longitude_deg'],validate_landing())
 assert result['source_resolution_m']==5 and result['footprint_resolved']
 assert sum(result['counts'].values())==result['sample_count']>1000
 assert result['counts']['1']>0 and result['counts']['3']>0
 assert not result['all_dispersion_centers_meet_nominal_model']
 assert result['max_height_uncertainty_m']>0 and len(result['sources'])==3

@pytest.mark.skipif(not (ROOT/'data/raw/regional80m.tif').exists(),reason='Original NASA rasters must be acquired locally')
def test_regional_eighty_metre_data_does_not_resolve_a_thirty_metre_footprint():
 result=native.native_footprint(-80.78121,-7.30576,validate_landing())
 assert result['source_resolution_m']==80 and not result['footprint_resolved']
 assert result['counts']['1']==0 and result['counts']['2']==0
 assert result['max_height_uncertainty_m'] is None

def test_local_coordinate_uses_its_actual_regional_cell_and_preserves_slope_limit(site01):
 value=validate_request({'mission':{'departure_utc':'2026-12-25T12:00:00Z','max_slope_deg':5},'cell_id':'polar:5:56','target_coordinates':{'latitude_deg':site01['latitude_deg'],'longitude_deg':site01['longitude_deg']},'landing':{'max_local_slope_deg':20}})
 assert value['cell']['id']!='polar:5:56'
 assert value['cell']['latitude_deg']==site01['latitude_deg']
 assert value['landing']['max_local_slope_deg']==5
 assert value['candidate_ids'][0]==value['cell']['id']

@pytest.mark.parametrize('body',[
 {},{'mission':{}},
 {'mission':{'departure_utc':'2026-12-25T12:00:00Z'},'cell_id':'unknown'},
 {'mission':{'departure_utc':'2026-12-25T12:00:00Z'},'cell_id':'polar:5:56','energy':{'solar_efficiency':True}},
 {'mission':{'departure_utc':'2026-12-25T12:00:00Z'},'cell_id':'polar:5:56','landing':{'semi_major_m':20,'semi_minor_m':100}},
])
def test_invalid_operations_fail_before_any_nasa_query(monkeypatch,body):
 async def forbidden(*args,**kwargs):pytest.fail('Invalid input must not query NASA')
 monkeypatch.setattr('api.app.operations.environment',forbidden)
 client=TestClient(app)
 assert client.post('/api/operations/analyze',json=body).status_code==422


def test_operations_request_size_is_bounded_before_parsing():
 client=TestClient(app)
 assert client.post('/api/operations/analyze',content=b' '*32769,headers={'content-type':'application/json'}).status_code==413
 assert client.post('/api/operations/analyze',content='{}').status_code==415


@pytest.mark.skipif(not (ROOT/'data/raw/site01.tif').exists(),reason='Original NASA rasters must be acquired locally')
def test_a_resolved_local_footprint_supersedes_the_coarse_regional_slope_proxy(site01):
 from api.app.operations import terrain_assessment
 coarse=validate_request({'mission':{'departure_utc':'2026-12-25T12:00:00Z'},'cell_id':'polar:5:56','target_coordinates':{'latitude_deg':site01['latitude_deg'],'longitude_deg':site01['longitude_deg']}})
 study=native.native_footprint(site01['latitude_deg'],site01['longitude_deg'],coarse['landing'])
 point=study['recommended_local_center'];assert point is not None
 cell=coarse['cell']|{'latitude_deg':point['latitude_deg'],'longitude_deg':point['longitude_deg']}
 result=terrain_assessment(cell,coarse['mission'],coarse['landing'])
 assert result['rule']=='native-footprint' and result['passes']
 assert result['center_footprint']['max_slope_deg']<=10
 # A nominal local pass does not assert that all dispersion centers pass.
 assert 'all_dispersion_centers_meet_nominal_model' not in result

def test_bundled_nasa_operations_example_reproduces_without_network(monkeypatch,tmp_path):
 import asyncio,shutil
 from api.app.operations import analyze
 from api.app.solar import horizons
 example=json.loads((ROOT/'data/prepared/operations_example.json').read_text(encoding='utf-8'))
 bundled=tmp_path/'prepared/ephemeris';bundled.mkdir(parents=True)
 for name in example['nasa_records']:shutil.copyfile(ROOT/'data/prepared/ephemeris'/name,bundled/name)
 monkeypatch.setattr(horizons,'DATA',tmp_path)
 def forbidden(*args,**kwargs):pytest.fail('Bundled operations example must not access the network')
 monkeypatch.setattr(horizons.httpx,'AsyncClient',forbidden)
 result=asyncio.run(analyze(validate_request(example['request'])))
 summary=result['affected']['budget']['summary']
 assert result['affected']['budget']['feasible']
 assert summary['minimum_soc']==pytest.approx(example['expected']['minimum_soc'],abs=1e-8)
 assert abs(summary['energy_balance_residual_wh'])<example['expected']['energy_balance_residual_tolerance_wh']
 assert result['local_study']['footprint_resolved'] is False


def test_a_known_native_slope_failure_never_becomes_a_regional_pass(monkeypatch):
 from api.app import operations
 monkeypatch.setattr(operations,'native_footprint',lambda *args:{'source_resolution_m':80,'center_footprint':{'risk':3,'max_slope_deg':30,'resolved':False}})
 result=operations.terrain_assessment({'latitude_deg':-85,'longitude_deg':0,'regional_slope_deg':3},{'effective_max_slope_deg':10},{})
 assert result['passes'] is False and result['rule']=='native-terrain-exclusion'
