"""Production-origin and pinned-data checks without external service mocks for success."""
import hashlib,io
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app.web_hosting import attach_frontend
from api.scripts import acquire_runtime_data as data
@pytest.fixture
def client(tmp_path):
 (tmp_path/'index.html').write_text('<html>Production Lunar Oracle</html>',encoding='utf-8')
 (tmp_path/'assets').mkdir();(tmp_path/'assets/app-a1b2.js').write_text('window.LUNAR=true',encoding='utf-8')
 (tmp_path/'.env').write_text('must-not-be-served',encoding='utf-8')
 app=FastAPI()
 @app.get('/api/health')
 def health():return {'status':'ok'}
 attach_frontend(app,tmp_path)
 return TestClient(app)
def test_frontend_and_real_api_share_one_public_origin(client):
 assert client.get('/').status_code==200 and 'Production Lunar' in client.get('/').text
 assert client.get('/api/health').json()=={'status':'ok'}
 assert client.get('/a/deep/link').status_code==200
@pytest.mark.parametrize('path',['/api','/api/missing','/api/engineering/missing'])
def test_missing_api_never_returns_the_frontend_html(client,path):
 response=client.get(path)
 assert response.status_code==404 and response.json()['status']=='unavailable'
def test_versioned_assets_cache_but_html_is_revalidated(client):
 assert 'immutable' in client.get('/assets/app-a1b2.js').headers['cache-control']
 assert client.get('/').headers['cache-control']=='no-cache'
 assert client.get('/assets/missing.js').status_code==404
@pytest.mark.parametrize('path',['/.env','/%2eenv','/api/../.env'])
def test_dotfiles_cannot_be_downloaded(client,path):
 response=client.get(path)
 assert response.status_code==404 and 'must-not-be-served' not in response.text
def test_missing_frontend_fails_instead_of_publishing_an_empty_shell(tmp_path):
 with pytest.raises(RuntimeError):attach_frontend(FastAPI(),tmp_path)
def test_runtime_has_all_thirteen_original_pinned_sources():
 assert len(data.sources())==13
def test_verification_failure_does_not_download_or_repin_a_file(monkeypatch,tmp_path):
 path=tmp_path/'source.tif';path.write_bytes(b'bad')
 monkeypatch.setattr(data,'sources',lambda root:[(path,'https://example.invalid/',hashlib.sha256(b'good').hexdigest())])
 monkeypatch.setattr(data.urllib.request,'urlopen',lambda *args,**kwargs:pytest.fail('Verification cannot download.'))
 with pytest.raises(RuntimeError):data.acquire(True,tmp_path)
 assert path.read_bytes()==b'bad'
def test_acquisition_rejects_unexpected_original_bytes(monkeypatch,tmp_path):
 path=tmp_path/'source.tif';path.write_bytes(b'old')
 monkeypatch.setattr(data,'sources',lambda root:[(path,'https://example.invalid/',hashlib.sha256(b'expected').hexdigest())])
 monkeypatch.setattr(data.urllib.request,'urlopen',lambda *args,**kwargs:io.BytesIO(b'wrong-source'))
 with pytest.raises(RuntimeError):data.acquire(False,tmp_path)
 assert path.read_bytes()==b'old' and not path.with_suffix('.tif.part').exists()


def test_acquisition_recovers_from_a_corrupt_cached_download(monkeypatch,tmp_path):
 path=tmp_path/'source.tif';expected=hashlib.sha256(b'original').hexdigest();requests=[]
 monkeypatch.setattr(data,'sources',lambda root:[(path,'https://example.invalid/source',expected)])
 def deliver(request,**kwargs):
  requests.append(request.full_url)
  return io.BytesIO(b'corrupt' if len(requests)==1 else b'original')
 monkeypatch.setattr(data.urllib.request,'urlopen',deliver)
 data.acquire(False,tmp_path)
 assert path.read_bytes()==b'original' and len(requests)==2
 assert requests[0]=='https://example.invalid/source' and '?retry=' in requests[1]

def test_partial_http_source_is_rejected_even_when_its_hash_matches(monkeypatch,tmp_path):
 path=tmp_path/'source.tif'
 monkeypatch.setattr(data,'sources',lambda root:[(path,'https://example.invalid/source',hashlib.sha256(b'original').hexdigest())])
 class Partial(io.BytesIO):
  status=206
  headers={'Content-Range':'bytes 0-7/100'}
 monkeypatch.setattr(data.urllib.request,'urlopen',lambda *args,**kwargs:Partial(b'original'))
 with pytest.raises(RuntimeError):data.acquire(False,tmp_path)
 assert not path.exists() and not path.with_suffix('.tif.part').exists()
