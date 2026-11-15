"""Native NASA LOLA local terrain and height-specific spherical horizons.

The 80 m raster remains regional. Five-metre spacing is available only inside
actual downloaded Site01/Site04 footprints; no visual mesh is used for science.
"""
import hashlib,json,math
from functools import lru_cache
from pathlib import Path
import numpy as np
import rasterio
from rasterio.windows import Window
from .core.sites import DATA
from .automatic_plan import frame,R

REGIONAL_URL='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
SOURCES_URL='https://pgda.gsfc.nasa.gov/products/78'
AZIMUTHS=np.deg2rad(np.arange(360,dtype=np.float64))
DISTANCES=np.concatenate((np.arange(5,2001,5,dtype=np.float64),np.arange(2080,20001,80,dtype=np.float64),np.arange(20250,250001,250,dtype=np.float64)))

def xy(lat,lon):
 rho=2*R*np.tan((np.pi/2+np.asarray(lat))/2)
 return rho*np.sin(lon),rho*np.cos(lon)

def coordinates(x,y):
 return math.degrees(2*math.atan2(math.hypot(x,y),2*R)-math.pi/2),math.degrees(math.atan2(x,y))

@lru_cache(maxsize=7)
def verified_path(name):
 if name not in ('regional80m.tif','site01.tif','site04.tif','site01-slp.tif','site04-slp.tif','site01-toterr.tif','site04-toterr.tif'):raise ValueError('Producto NASA desconocido.')
 p=DATA/'raw'/name
 if not p.exists():raise FileNotFoundError('Falta el raster NASA nativo '+name+'. Ejecuta la adquisición de datos local.')
 expected=json.loads((DATA/'prepared/landing_surface.json').read_text(encoding='utf-8'))['source_sha256'][name]
 digest=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):digest.update(block)
 if digest.hexdigest()!=expected:raise ValueError('La integridad del raster NASA no coincide: '+name)
 return p,expected

@lru_cache(maxsize=2)
def native_array(name):
 p,_=verified_path(name)
 with rasterio.open(p) as ds:return ds.read(1,masked=True).filled(np.nan).astype(np.float32),ds.transform

def nearest(array,tr,x,y):
 x,y=np.broadcast_arrays(x,y);col=np.floor((x-tr.c)/tr.a).astype(np.int32);row=np.floor((y-tr.f)/tr.e).astype(np.int32)
 good=(row>=0)&(col>=0)&(row<array.shape[0])&(col<array.shape[1]);out=np.full(x.shape,np.nan,dtype=np.float64)
 out[good]=array[row[good],col[good]]
 return out

def local_source(lat,lon):
 x,y=xy(math.radians(lat),math.radians(lon))
 for name in ('site01','site04'):
  p,_=verified_path(name+'.tif')
  with rasterio.open(p) as ds:
   if ds.bounds.left<=x<ds.bounds.right and ds.bounds.bottom<y<=ds.bounds.top:return name
 return None

def point_height(lat,lon):
 source=local_source(lat,lon);a,tr=native_array((source+'.tif') if source else 'regional80m.tif')
 x,y=xy(math.radians(lat),math.radians(lon));height=float(nearest(a,tr,x,y))
 if not math.isfinite(height):raise ValueError('No hay elevación NASA válida en el destino.')
 return height,source

@lru_cache(maxsize=24)
def horizon_profile(lat,lon,solar_height,antenna_height):
 height,local=point_height(lat,lon)
 latitude,longitude=math.radians(lat),math.radians(lon);arc=DISTANCES[None,:]/R;az=AZIMUTHS[:,None]
 lat2=np.arcsin(np.clip(math.sin(latitude)*np.cos(arc)+math.cos(latitude)*np.sin(arc)*np.cos(az),-1,1))
 lon2=longitude+np.arctan2(np.sin(az)*np.sin(arc)*math.cos(latitude),np.cos(arc)-math.sin(latitude)*np.sin(lat2))
 x,y=xy(lat2,lon2);array,tr=native_array('regional80m.tif');elev=nearest(array,tr,x,y)
 source_resolution=80
 if local:
  a,at=native_array(local+'.tif');near=nearest(a,at,x,y);use=np.isfinite(near);elev=np.where(use,near,elev);source_resolution=5
 valid=np.isfinite(elev);near_complete=bool(valid[:,DISTANCES<=2000].all());maxdist=np.max(np.where(valid,DISTANCES[None,:],0),axis=1)
 output={}
 for key,observer_h in (('sun',solar_height),('earth',antenna_height)):
  vertical=(R+elev)*np.cos(arc)-(R+height+observer_h);horizontal=(R+elev)*np.sin(arc)
  angles=np.degrees(np.arctan2(vertical,horizontal));angles[~valid]=-np.inf
  # Include the spherical tangent. Unknown sampled terrain is still reported.
  profile=np.max(angles,axis=1)
  output[key]=profile.tolist() if near_complete and np.isfinite(profile).all() else None
 paths=['regional80m.tif']+([local+'.tif'] if local else [])
 return {'elevation_m':height,'source_resolution_m':source_resolution,'local_region':local,'profiles':output,
  'observer_heights_m':{'sun':solar_height,'earth':antenna_height},'azimuth_step_deg':1,'maximum_distance_m':250000,
  'near_complete':near_complete,'valid_to_min_m':float(np.min(maxdist)),'minimum_ray_coverage':float(np.min(np.mean(valid,axis=1))),
  'sources':[{'name':name,'sha256':verified_path(name)[1],'url':REGIONAL_URL if name=='regional80m.tif' else 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/'+local.title()+'/'+local.title()+'_final_adj_5mpp_surf.tif'} for name in paths],
  'limitations':['Horizontes propios del punto y de cada altura; geometría esférica y norte local verdadero.',
   'Muestreo finito: 1° en azimut, 5 m radial hasta 2 km, 80 m hasta 20 km y 250 m hasta 250 km; el raster regional conserva 80 m nativos.',
   'Cobertura lejana parcial, obstáculos entre rayos y errores de altura no acotados. No certifica ausencia de obstrucciones.',
   'No se rellena terreno ausente con una esfera ni con un horizonte plano.']}

def interpolate_horizon(values,azimuth):
 if values is None:return None
 position=azimuth%360;i=int(position);fraction=position-i
 return values[i]*(1-fraction)+values[(i+1)%360]*fraction

def _native_footprint(lat,lon,settings):
 a,b,heading,radius,limit,roughness=(settings[k] for k in ('semi_major_m','semi_minor_m','heading_deg','footprint_radius_m','max_local_slope_deg','max_roughness_m'))
 source=local_source(lat,lon);fine=bool(source);name=source+'.tif' if fine else 'regional80m.tif'
 p,sha=verified_path(name);cx,cy=xy(math.radians(lat),math.radians(lon));theta=math.radians(heading)
 # A bounding square encloses the rotated ellipse plus footprint and pixel buffer.
 with rasterio.open(p) as ds:
  spacing=abs(ds.transform.a);half=max(a,b)+radius+3*spacing;col=int((cx-ds.transform.c)/spacing);row=int((ds.transform.f-cy)/spacing);n=int(math.ceil(half/spacing))
  window=Window(col-n,row-n,2*n+1,2*n+1);dem=ds.read(1,window=window,boundless=True,masked=True).filled(np.nan).astype(np.float64);tr=ds.window_transform(window)
 if max(dem.shape)>301:raise ValueError('La huella de estudio excede el límite de 301 píxeles nativos por eje.')
 ys=tr.f+(np.arange(dem.shape[0])+.5)*tr.e;xs=tr.c+(np.arange(dem.shape[1])+.5)*tr.a
 x,y=np.meshgrid(xs,ys);dx=x-cx;dy=y-cy
 # Heading relative to true north: convert map basis at this longitude.
 basis=frame(lat,lon);east=np.asarray(basis[0]);north=np.asarray(basis[1])
 # Projection is conformal, grid rotation is longitude; ground scale below.
 k=1+(math.hypot(cx,cy)/(2*R))**2;ground_spacing=spacing/k
 east_dx=(dx*math.cos(math.radians(lon))-dy*math.sin(math.radians(lon)))/k
 north_dy=(dx*math.sin(math.radians(lon))+dy*math.cos(math.radians(lon)))/k
 major=east_dx*math.sin(theta)+north_dy*math.cos(theta);minor=east_dx*math.cos(theta)-north_dy*math.sin(theta)
 inside=(major/a)**2+(minor/b)**2<=1
 if fine:
  with rasterio.open(verified_path(source+'-slp.tif')[0]) as ds:slopes=ds.read(1,window=window,boundless=True,masked=True).filled(np.nan).astype(np.float64)
  with rasterio.open(verified_path(source+'-toterr.tif')[0]) as ds:errors=ds.read(1,window=window,boundless=True,masked=True).filled(np.nan).astype(np.float64)
 else:
  gy,gx=np.gradient(dem,ground_spacing);slopes=np.degrees(np.arctan(np.hypot(gx,gy)));errors=np.full(dem.shape,np.nan)
 # Neighbouring pixel footprints intersecting the circular support region.
 offsets=[];reach=int(math.ceil(radius/ground_spacing+math.sqrt(2)/2));shape=dem.shape
 for iy in range(-reach,reach+1):
  for ix in range(-reach,reach+1):
   if math.hypot(ix,iy)*ground_spacing<=radius+ground_spacing*math.sqrt(2)/2:offsets.append((iy,ix))
 known=np.ones(shape,dtype=bool);maxslope=np.full(shape,-np.inf);maxerr=np.full(shape,-np.inf)
 sums=np.zeros(shape);sum2=np.zeros(shape);sumx=np.zeros(shape);sumy=np.zeros(shape);sx2=sy2=0.
 for iy,ix in offsets:
  sh=np.full(shape,np.nan);sl=np.full(shape,np.nan);er=np.full(shape,np.nan)
  r0,r1=max(0,-iy),min(shape[0],shape[0]-iy);c0,c1=max(0,-ix),min(shape[1],shape[1]-ix)
  sh[r0:r1,c0:c1]=dem[r0+iy:r1+iy,c0+ix:c1+ix];sl[r0:r1,c0:c1]=slopes[r0+iy:r1+iy,c0+ix:c1+ix];er[r0:r1,c0:c1]=errors[r0+iy:r1+iy,c0+ix:c1+ix]
  valid=np.isfinite(sh)&np.isfinite(sl);known&=valid
  maxslope=np.maximum(maxslope,np.where(np.isfinite(sl),sl,-np.inf));maxerr=np.maximum(maxerr,np.where(np.isfinite(er),er,-np.inf))
  z=np.where(np.isfinite(sh),sh,0.);ox,oy=ix*ground_spacing,iy*ground_spacing
  sums+=z;sum2+=z*z;sumx+=z*ox;sumy+=z*oy;sx2+=ox*ox;sy2+=oy*oy
 count=len(offsets);residual=sum2-sums*sums/count
 if sx2:residual-=sumx*sumx/sx2
 if sy2:residual-=sumy*sumy/sy2
 rms=np.sqrt(np.maximum(0.,residual/count))
 resolved=fine and 2*radius>=3*ground_spacing
 # 0 unknown, 1 favorable under local model, 2 limited margin, 3 fails.
 risk=np.zeros(shape,dtype=np.uint8);passed=known&resolved&(maxslope<=limit)&(rms<=roughness)
 failed=known&((maxslope>limit)|(resolved&(rms>roughness)))
 risk[passed]=1;risk[passed&((limit-maxslope<2)|(roughness-rms<.1))]=2;risk[failed]=3
 target=inside;total=int(target.sum());counts={str(i):int(np.count_nonzero(target&(risk==i))) for i in range(4)}
 good=np.argwhere(target&(risk==1));recommendation=None
 if len(good):
  best=min(good,key=lambda rc:(float(maxslope[tuple(rc)]),float(rms[tuple(rc)]),float(dx[tuple(rc)]**2+dy[tuple(rc)]**2)))
  rr,cc=map(int,best);blat,blon=coordinates(float(x[rr,cc]),float(y[rr,cc]));recommendation={'latitude_deg':blat,'longitude_deg':blon,'max_slope_deg':float(maxslope[rr,cc]),'roughness_rms_m':float(rms[rr,cc]),'offset_m':float(math.hypot(east_dx[rr,cc],north_dy[rr,cc]))}
 selected=target&known
 return {'status':'ok','source_resolution_m':spacing,'native_spacing_m':spacing,'local_region':source,'footprint_resolved':resolved,'settings':settings,
  'center_footprint':{'risk':int(risk[n,n]),'max_slope_deg':float(maxslope[n,n]) if known[n,n] else None,'roughness_rms_m':float(rms[n,n]) if known[n,n] else None,'resolved':bool(resolved and known[n,n])},
  'center':{'latitude_deg':lat,'longitude_deg':lon},'sample_count':total,'counts':counts,'max_slope_deg':float(np.max(maxslope[selected])) if selected.any() else None,
  'max_height_uncertainty_m':float(np.max(maxerr[selected&np.isfinite(maxerr)])) if np.any(selected&np.isfinite(maxerr)) else None,
  'all_dispersion_centers_meet_nominal_model':bool(total>0 and counts['1']+counts['2']==total and resolved),'recommended_local_center':recommendation,
  'grid':{'width':shape[1],'height':shape[0],'xmin':tr.c,'ymax':tr.f,'spacing_m':spacing,'risk':risk.ravel().tolist(),'inside_ellipse':target.astype(np.uint8).ravel().tolist(),
   'elevation_min_m':float(np.nanmin(dem)),'elevation_max_m':float(np.nanmax(dem)),'elevations_m':[float(v) if np.isfinite(v) else None for v in dem.ravel()]},
  'sources':[{'name':file,'url':REGIONAL_URL if not fine else SOURCES_URL,'sha256':verified_path(file)[1]} for file in ([name,source+'-slp.tif',source+'-toterr.tif'] if fine else [name])],
  'limitations':['Cada color corresponde a centros de píxel nativo y su huella circular; no a rocas subpíxel ni a una certificación de aterrizaje.',
   'La elipse es una región de dispersión declarada, no una distribución estadística ni una probabilidad de éxito.',
   'Los productos de 5 m tienen píxeles interpolados; la separación no es precisión ni resolución de medición independiente.',
   'Se informa incertidumbre vertical cuando existe; no se propagan todos los errores del DEM ni la incertidumbre de pendiente.',
   'Fuera de la cobertura de 5 m, las huellas pequeñas permanecen sin resolver. No se aumenta la resolución mediante interpolación.',
   'Rugosidad: RMS de altura tras retirar el plano ajustado en la huella; tolerancia declarada por el usuario.']}


@lru_cache(maxsize=24)
def _cached_footprint(lat,lon,settings):
 return _native_footprint(lat,lon,dict(settings))

def native_footprint(lat,lon,settings):
 return _cached_footprint(float(lat),float(lon),tuple(sorted(settings.items())))
