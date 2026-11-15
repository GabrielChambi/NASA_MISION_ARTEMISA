"""Electrical and data budgets for explicitly configured lunar surface scenarios.

Not a thermal, RF, spacecraft qualification or real-time telemetry model.
"""
from datetime import datetime
import math

AU_KM=149597870.7
SOLAR_REFERENCE_W_M2=1361.0
SOURCES=[
 {'name':'NASA solar irradiance reference at 1 AU','url':'https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science'},
 {'name':'NASA spacecraft power subsystems','url':'https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems/'},
]
DEFAULT_ENERGY={
 'solar_area_m2':4.0,'solar_efficiency':.28,'solar_derate':.85,'panel_mode':'sun_tracking',
 'panel_tilt_deg':90.,'panel_azimuth_deg':0.,'battery_capacity_wh':4000.,'initial_soc':.85,
 'reserve_soc':.2,'charge_efficiency':.95,'discharge_efficiency':.95,
 'max_charge_w':1000.,'max_discharge_w':500.,'essential_load_w':80.,'optional_load_w':20.,
 'science_load_w':60.,'radio_load_w':25.,'science_duration_hours':6.,'science_start_hour':0.,
 'science_data_mbps':.02,'downlink_mbps':.1,'storage_gb':2.,'require_all_data':True,
}
DEFAULT_FAULT={'solar_loss_fraction':0.,'solar_fault_start_hour':0.,'earth_outage_start_hour':0.,'earth_outage_hours':0.,'delay_hours':0.}
LIMITATIONS=[
 'Parámetros de nave declarados por el usuario; el ejemplo no es una ficha técnica NASA ni de fabricante.',
 'Irradiancia de referencia 1361 W/m² a 1 AU escalada con la distancia JPL; no es una medición futura del Sol.',
 'Despeje del centro solar >0,3° respecto al horizonte muestreado. Sin auto-sombra, polvo variable ni resolución del relieve entre rayos.',
 'Ocultación solar por la Tierra aproximada con discos angulares; sin atmósfera terrestre ni luz difusa.',
 'Modelo eléctrico concentrado, sin degradación térmica de batería ni temperaturas. Energía suficiente no demuestra supervivencia.',
 'Transmisión con tasa configurada durante ventanas geométricas; no calcula un presupuesto RF ni garantiza una estación disponible.',
 'Cada muestra representa el intervalo hasta la siguiente; la última no añade duración. Se dividen eventos configurados dentro de un intervalo.',
 'El controlador prioriza carga esencial, ciencia, radio y carga opcional; una carga científica sin potencia suficiente se suspende y queda pendiente.',
]

def number(value,lo,hi):
 return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and lo<=value<=hi

def validate_energy(raw=None,surface_hours=72):
 if raw is not None and not isinstance(raw,dict):raise ValueError('La configuración eléctrica debe ser un objeto.')
 q=DEFAULT_ENERGY|dict(raw or {})
 limits={'solar_area_m2':(.01,1000),'solar_efficiency':(.001,1),'solar_derate':(0,1),'panel_tilt_deg':(0,180),'panel_azimuth_deg':(0,360),
 'battery_capacity_wh':(.01,1e7),'initial_soc':(0,1),'reserve_soc':(0,1),'charge_efficiency':(.01,1),'discharge_efficiency':(.01,1),
 'max_charge_w':(0,1e6),'max_discharge_w':(0,1e6),'essential_load_w':(0,1e6),'optional_load_w':(0,1e6),'science_load_w':(0,1e6),'radio_load_w':(0,1e6),
 'science_duration_hours':(0,surface_hours),'science_start_hour':(0,surface_hours),'science_data_mbps':(0,1e4),'downlink_mbps':(0,1e4),'storage_gb':(.001,1e6)}
 for key,(lo,hi) in limits.items():
  if not number(q.get(key),lo,hi):raise ValueError('Parámetro eléctrico inválido: '+key)
 if q['panel_mode'] not in ('sun_tracking','fixed') or not isinstance(q['require_all_data'],bool):raise ValueError('Revisa orientación de paneles y objetivo de datos.')
 if q['science_start_hour']+q['science_duration_hours']>surface_hours+1e-9:raise ValueError('La actividad científica termina fuera de la estancia.')
 return {key:q[key] for key in DEFAULT_ENERGY}

def validate_fault(raw=None,surface_hours=72):
 if raw is not None and not isinstance(raw,dict):raise ValueError('El fallo debe ser un objeto.')
 q=DEFAULT_FAULT|dict(raw or {})
 for key,(lo,hi) in {'solar_loss_fraction':(0,1),'solar_fault_start_hour':(0,surface_hours),'earth_outage_start_hour':(0,surface_hours),'earth_outage_hours':(0,surface_hours),'delay_hours':(0,72)}.items():
  if not number(q.get(key),lo,hi):raise ValueError('Parámetro de fallo inválido: '+key)
 return {key:q[key] for key in DEFAULT_FAULT}

def occulted_sun_fraction(sample):
 """Small-angle circular-disk overlap; Earth/Sun airless angular silhouettes."""
 keys=('sun_azimuth_deg','sun_elevation_deg','earth_azimuth_deg','earth_elevation_deg','sun_range_km','earth_range_km')
 if not all(number(sample.get(k),-1e12,1e12) for k in keys) or sample['sun_range_km']<=695700 or sample['earth_range_km']<=6378.1366:return None
 sa,se=math.radians(sample['sun_azimuth_deg']),math.radians(sample['sun_elevation_deg'])
 ea,ee=math.radians(sample.get('eclipse_earth_azimuth_deg',sample['earth_azimuth_deg'])),math.radians(sample.get('eclipse_earth_elevation_deg',sample['earth_elevation_deg']))
 separation=math.acos(max(-1,min(1,math.sin(se)*math.sin(ee)+math.cos(se)*math.cos(ee)*math.cos(sa-ea))))
 rs=math.asin(695700/sample['sun_range_km']);re=math.asin(6378.1366/sample.get('eclipse_earth_range_km',sample['earth_range_km']))
 if separation>=rs+re:return 0.
 if separation<=abs(re-rs):return min(1.,(re/rs)**2) if re<rs else 1.
 a=math.acos(max(-1,min(1,(separation**2+rs**2-re**2)/(2*separation*rs))))
 b=math.acos(max(-1,min(1,(separation**2+re**2-rs**2)/(2*separation*re))))
 overlap=rs**2*a+re**2*b-.5*math.sqrt(max(0,(-separation+rs+re)*(separation+rs-re)*(separation-rs+re)*(separation+rs+re)))
 return max(0.,min(1.,overlap/(math.pi*rs**2)))

def solar_power(sample,q,fault,hour):
 keys=('sun_azimuth_deg','sun_elevation_deg','sun_horizon_deg','sun_range_km')
 if not all(number(sample.get(k),-1e12,1e12) for k in keys) or sample['sun_range_km']<=0:return None
 eclipsed=occulted_sun_fraction(sample)
 if eclipsed is None:return None
 clear=sample['sun_elevation_deg']-sample['sun_horizon_deg']>.3
 incidence=1.
 if q['panel_mode']=='fixed':
  tilt=math.radians(q['panel_tilt_deg']);e=math.radians(sample['sun_elevation_deg']);da=math.radians(sample['sun_azimuth_deg']-q['panel_azimuth_deg'])
  incidence=max(0.,math.cos(tilt)*math.sin(e)+math.sin(tilt)*math.cos(e)*math.cos(da))
 loss=fault['solar_loss_fraction'] if hour>=fault['solar_fault_start_hour'] else 0.
 return SOLAR_REFERENCE_W_M2*(AU_KM/sample['sun_range_km'])**2*q['solar_area_m2']*q['solar_efficiency']*q['solar_derate']*incidence*(1-eclipsed)*(1-loss)*int(clear)

def sample_hours(samples):
 if not isinstance(samples,list) or not 2<=len(samples)<=1345:raise ValueError('Se requieren entre 2 y 1345 muestras NASA.')
 try:stamps=[datetime.fromisoformat(s['t_utc'].replace('Z','+00:00')).timestamp() for s in samples]
 except (KeyError,TypeError,ValueError):raise ValueError('Fechas NASA inválidas.')
 if any(not isinstance(s.get('t_utc'),str) or not s['t_utc'].endswith('Z') for s in samples):raise ValueError('Las muestras deben usar UTC explícito.')
 hours=[(t-stamps[0])/3600 for t in stamps]
 if any(not 0<hours[i+1]-hours[i]<=1 for i in range(len(hours)-1)) or hours[-1]>336:raise ValueError('La serie tiene huecos o supera el intervalo máximo.')
 return hours

def simulate_energy(samples,config=None,fault=None,science_slots=None,optional_enabled=True):
 hours=sample_hours(samples);q=validate_energy(config,hours[-1]);f=validate_fault(fault,hours[-1])
 if science_slots is not None and (not isinstance(science_slots,list) or any(not isinstance(i,int) or isinstance(i,bool) or i<0 or i>=len(samples)-1 for i in science_slots) or len(set(science_slots))!=len(science_slots)):raise ValueError('Horario de ciencia inválido.')
 slots=set(science_slots) if science_slots is not None else None
 capacity=q['battery_capacity_wh'];energy=capacity*q['initial_soc'];minimum=energy;reserve=capacity*q['reserve_soc']
 produced=load=charged=discharged=charge_loss=discharge_loss=curtailed=0.
 essential_unserved=unserved=completed=sent=generated=buffer=overflow=0.
 first_reserve=0. if energy<reserve else None;first_empty=0. if energy<=0 else None
 states=[{'hour':0.,'t_utc':samples[0]['t_utc'],'soc':energy/capacity,'battery_wh':energy,'buffer_gb':0.}];events=[];unknown=False
 for i in range(len(samples)-1):
  a,b=hours[i],hours[i+1]
  cuts=sorted(set([a,b]+[x for x in (f['solar_fault_start_hour'],f['earth_outage_start_hour'],f['earth_outage_start_hour']+f['earth_outage_hours'],q['science_start_hour'],q['science_start_hour']+q['science_duration_hours']) if a<x<b]))
  sample=samples[i]
  segments=list(zip(cuts,cuts[1:]))
  while segments:
   start,end=segments.pop(0)
   dt=end-start;mid=(start+end)/2;pv=solar_power(sample,q,f,mid)
   earth_known=all(number(sample.get(k),-1e9,1e9) for k in ('earth_elevation_deg','earth_horizon_deg'))
   if pv is None or not earth_known:
    unknown=True;events.append({'hour':start,'type':'unknown','message':'Faltan geometría o distancias; no se propaga una batería inventada.'});break
   earth_clear=sample['earth_elevation_deg']-sample['earth_horizon_deg']>.3 and not(f['earth_outage_start_hour']<=mid<f['earth_outage_start_hour']+f['earth_outage_hours'])
   planned=(i in slots) if slots is not None else q['science_start_hour']<=mid<q['science_start_hour']+q['science_duration_hours']
   available=pv+(q['max_discharge_w'] if energy>1e-9 else 0.)
   essential=min(q['essential_load_w'],available);available-=essential
   science=q['science_load_w'] if planned and available+1e-9>=q['science_load_w'] else 0.
   performed=planned and (q['science_load_w']==0 or science>0)
   available-=science
   new_data=q['science_data_mbps']*.45*dt if performed else 0.
   possible=min(buffer+new_data,q['downlink_mbps']*.45*dt) if earth_clear else 0.
   radio_duty=possible/(q['downlink_mbps']*.45*dt) if q['downlink_mbps']>0 else 0.
   radio=q['radio_load_w']*radio_duty
   if available+1e-9<radio:possible=0.;radio=0.
   available-=radio
   optional=min(q['optional_load_w'],max(0.,available)) if optional_enabled else 0.
   demand=essential+science+radio+optional
   requested=q['essential_load_w']+(q['science_load_w'] if planned else 0)+radio+(q['optional_load_w'] if optional_enabled else 0)
   deficit=max(0.,demand-pv)
   if deficit>0 and energy>1e-9 and deficit*dt/q['discharge_efficiency']>energy+1e-8:
    split=start+energy*q['discharge_efficiency']/deficit
    if start+1e-10<split<end-1e-10:
     segments.insert(0,(split,end));segments.insert(0,(start,split));continue
   shortage=max(0.,requested-demand)*dt;unserved+=shortage;essential_unserved+=(q['essential_load_w']-essential)*dt
   if q['essential_load_w']-essential>1e-8:events.append({'hour':start,'type':'essential_unserved','duration_hours':dt,'message':'La potencia disponible no cubre la carga esencial.'})
   if optional_enabled and q['optional_load_w']-optional>1e-8:events.append({'hour':start,'type':'optional_suspended','duration_hours':dt,'message':'Carga opcional suspendida o reducida por falta de potencia.'})
   if planned and not performed:events.append({'hour':start,'type':'science_suspended','duration_hours':dt,'message':'Actividad científica suspendida por falta de potencia.'})
   if performed:completed+=dt;generated+=new_data
   sent+=possible;buffer=max(0.,buffer+new_data-possible)
   if buffer>q['storage_gb']:overflow+=buffer-q['storage_gb'];buffer=q['storage_gb']
   before=energy;net=pv-demand
   if net>=0:
    incoming=min(net,q['max_charge_w'],(capacity-energy)/(q['charge_efficiency']*dt))
    incoming=max(0.,incoming);gain=incoming*q['charge_efficiency']*dt
    energy+=gain;charged+=gain;charge_loss+=incoming*dt-gain;curtailed+=(net-incoming)*dt
   else:
    output=-net*dt;removed=output/q['discharge_efficiency'];energy-=removed;discharged+=removed;discharge_loss+=removed-output
   energy=max(0.,min(capacity,energy));minimum=min(minimum,energy)
   if first_reserve is None and before>=reserve and energy<reserve:
    first_reserve=start+dt*(before-reserve)/(before-energy);events.append({'hour':first_reserve,'type':'reserve','message':'Se cruza la reserva configurada.'})
   if first_empty is None and energy<=1e-8:
    first_empty=end if before>0 else start;events.append({'hour':first_empty,'type':'empty','message':'Batería agotada en el modelo eléctrico.'})
   produced+=pv*dt;load+=demand*dt
   states.append({'hour':end,'t_utc':datetime.fromtimestamp(datetime.fromisoformat(samples[0]['t_utc'].replace('Z','+00:00')).timestamp()+end*3600,datetime.fromisoformat(samples[0]['t_utc'].replace('Z','+00:00')).tzinfo).isoformat().replace('+00:00','Z'),'soc':energy/capacity,'battery_wh':energy,'buffer_gb':buffer,'solar_w':pv,'load_w':demand,'science_active':performed,'earth_clear':earth_clear})
  if unknown:break
 residual=capacity*q['initial_soc']+produced-load-curtailed-charge_loss-discharge_loss-energy
 feasible=not unknown and essential_unserved<1e-6 and completed+1e-8>=q['science_duration_hours'] and minimum+1e-6>=reserve and overflow<1e-9 and (not q['require_all_data'] or buffer<1e-8)
 reasons=[]
 if unknown:reasons.append('Geometría incompleta; presupuesto sin resolver.')
 if essential_unserved>1e-6:reasons.append('No se suministra toda la carga esencial.')
 if minimum+1e-6<reserve:reasons.append('La batería cae por debajo de la reserva solicitada.')
 if completed+1e-8<q['science_duration_hours']:reasons.append('No se completan las horas científicas solicitadas.')
 if overflow>1e-9:reasons.append('Se supera la memoria configurada y se pierden datos.')
 if q['require_all_data'] and buffer>1e-8:reasons.append('Quedan datos sin transmitir al finalizar.')
 return {'status':'unknown' if unknown else 'ok','feasible':feasible,'config':q,'fault':f,'optional_enabled':optional_enabled,'science_slots':science_slots,
  'summary':{'minimum_soc':None if unknown else minimum/capacity,'final_soc':None if unknown else energy/capacity,'reserve_crossing_hour':first_reserve,'battery_empty_hour':first_empty,
   'solar_generated_wh':produced,'load_served_wh':load,'battery_charge_wh':charged,'battery_discharge_wh':discharged,'charge_loss_wh':charge_loss,'discharge_loss_wh':discharge_loss,'curtailed_wh':curtailed,
   'unserved_wh':unserved,'essential_unserved_wh':essential_unserved,'science_completed_hours':completed,'science_required_hours':q['science_duration_hours'],'data_generated_gb':generated,'data_sent_gb':sent,'buffer_final_gb':buffer,'data_lost_gb':overflow,'energy_balance_residual_wh':residual},
  'states':states,'events':events[:400],'reasons':reasons,'sources':SOURCES,'limitations':LIMITATIONS}

def optimized_schedule(samples,config,fault):
 hours=sample_hours(samples);q=validate_energy(config,hours[-1]);f=validate_fault(fault,hours[-1]);remaining=q['science_duration_hours'];chosen=[]
 # Greedy candidate only; a subsequent complete budget verifies feasibility.
 scored=[]
 for i,s in enumerate(samples[:-1]):
  power=solar_power(s,q,f,(hours[i]+hours[i+1])/2)
  if power is None:continue
  earth=s.get('earth_elevation_deg',-90)-s.get('earth_horizon_deg',90)>.3 and not(f['earth_outage_start_hour']<=hours[i]<f['earth_outage_start_hour']+f['earth_outage_hours'])
  scored.append((power-q['essential_load_w']+(.01 if earth else 0),-hours[i],i))
 for _,__,i in sorted(scored,reverse=True):
  dt=hours[i+1]-hours[i]
  if remaining+1e-8>=dt:chosen.append(i);remaining-=dt
  if remaining<1e-8:break
 if remaining>1e-8:return None
 return sorted(chosen)
