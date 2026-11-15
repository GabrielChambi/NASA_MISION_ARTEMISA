"""Declared engineering models. Results never imply hardware calibration or flight approval."""
import math
from .energy_model import number,sample_hours,occulted_sun_fraction,AU_KM,SOLAR_REFERENCE_W_M2
SIGMA=5.670374419e-8
BOLTZMANN=1.380649e-23
LIGHT_M_S=299792458.
THERMAL_DEFAULT={'initial_k':293.15,'capacity_j_k':40000.,'radiating_area_m2':.8,'absorbing_area_m2':1.,'absorptivity':.1,'emissivity':.8,'ground_view_factor':.35,'ground_temperature_k':100.,'space_temperature_k':2.725,'internal_heat_fraction':.8,'heater_w':150.,'heater_on_k':273.15,'heater_off_k':278.15,'battery_min_k':263.15,'battery_max_k':313.15}
RF_DEFAULT={'frequency_hz':8.4e9,'tx_power_w':5.,'tx_gain_dbi':12.,'rx_gain_dbi':68.2,'system_noise_k':30.,'loss_db':4.,'required_ebn0_db':6.,'required_margin_db':3.,'rate_bps':100000.,'pa_efficiency':.4,'electronics_w':2.}
SOURCES={'thermal':'https://www.nasa.gov/smallsat-institute/sst-soa/thermal-control/','rf':'https://deepspace.jpl.nasa.gov/dsndocs/810-005/','sigma':'https://physics.nist.gov/cgi-bin/cuu/Value?sigma','k':'https://physics.nist.gov/cgi-bin/cuu/Value?k'}
def config(raw,defaults,limits):
 if raw is not None and not isinstance(raw,dict):raise ValueError('Configuration must be an object.')
 if raw and set(raw)-set(defaults):raise ValueError('Unknown engineering parameter.')
 q=defaults|dict(raw or {})
 for key,(lo,hi) in limits.items():
  if not number(q.get(key),lo,hi):raise ValueError('Invalid engineering parameter: '+key)
 return q
def thermal_config(raw=None):
 limits={'initial_k':(20,600),'capacity_j_k':(100,1e9),'radiating_area_m2':(.001,1000),'absorbing_area_m2':(0,1000),'absorptivity':(0,1),'emissivity':(.001,1),'ground_view_factor':(0,1),'ground_temperature_k':(2.725,500),'space_temperature_k':(0,20),'internal_heat_fraction':(0,1),'heater_w':(0,1e5),'heater_on_k':(20,500),'heater_off_k':(20,500),'battery_min_k':(20,500),'battery_max_k':(20,600)}
 q=config(raw,THERMAL_DEFAULT,limits)
 if q['heater_on_k']>=q['heater_off_k'] or q['battery_min_k']>=q['battery_max_k']:raise ValueError('Invalid temperature bounds.')
 return q
def rf_config(raw=None):
 return config(raw,RF_DEFAULT,{'frequency_hz':(1e6,1e11),'tx_power_w':(.001,1e5),'tx_gain_dbi':(-30,80),'rx_gain_dbi':(-30,100),'system_noise_k':(1,1e5),'loss_db':(0,100),'required_ebn0_db':(-5,30),'required_margin_db':(0,30),'rate_bps':(1,1e10),'pa_efficiency':(.01,1),'electronics_w':(0,1e5)})
def thermal_power(t,q,solar_w,internal_w,heater_w):
 env=q['ground_view_factor']*q['ground_temperature_k']**4+(1-q['ground_view_factor'])*q['space_temperature_k']**4
 radiation=q['emissivity']*SIGMA*q['radiating_area_m2']*(env-t**4)
 return solar_w+internal_w+heater_w+radiation
def thermal_step(t,dt,q,solar_w,internal_w,heater_w):
 def d(x):return thermal_power(x,q,solar_w,internal_w,heater_w)/q['capacity_j_k']
 a=d(t);b=d(t+dt*a/2);c=d(t+dt*b/2);d4=d(t+dt*c)
 end=t+dt*(a+2*b+2*c+d4)/6
 if not math.isfinite(end) or not 0<end<2000:raise ValueError('Thermal integration exceeded its physical/numerical domain.')
 return end
def link_budget(distance_km,raw=None):
 q=rf_config(raw)
 if not number(distance_km,1,1e10):raise ValueError('Invalid radio range.')
 loss=20*math.log10(4*math.pi*(distance_km*1000)*q['frequency_hz']/LIGHT_M_S)
 received=10*math.log10(q['tx_power_w'])+q['tx_gain_dbi']+q['rx_gain_dbi']-loss-q['loss_db']
 n0=10*math.log10(BOLTZMANN*q['system_noise_k'])
 cn0=received-n0;ebn0=cn0-10*math.log10(q['rate_bps']);margin=ebn0-q['required_ebn0_db']-q['required_margin_db']
 maximum_rate=10**((cn0-q['required_ebn0_db']-q['required_margin_db'])/10)
 return {'free_space_loss_db':loss,'received_dbw':received,'noise_density_dbw_hz':n0,'cn0_db_hz':cn0,'ebn0_db':ebn0,'margin_db':margin,'maximum_rate_bps':maximum_rate,'one_way_light_time_s':distance_km*1000/LIGHT_M_S}
def rf_scenario(samples,raw=None,stations=None):
 q=rf_config(raw);hours=sample_hours(samples);rows=[];usable=visible=0.
 if stations is not None:
  if stations['status']!='ok':return {'status':'unknown','config':q,'reason':'Station geometry is unresolved.','states':[]}
  for i,state in enumerate(stations['states']):
   chosen=state['selected'];row={k:chosen[k] for k in ('free_space_loss_db','received_dbw','noise_density_dbw_hz','cn0_db_hz','ebn0_db','margin_db','maximum_rate_bps','one_way_light_time_s')}
   row.update(hour=hours[i],earth_geometric_clear=chosen['geometry_pass'],link_model_pass=chosen['link_model_pass'],station_id=chosen['id'])
   rows.append(row)
   if i<len(samples)-1:
    dt=hours[i+1]-hours[i];visible+=dt*int(chosen['geometry_pass']);usable+=dt*int(chosen['link_model_pass'])
  return {'status':'ok','config':q,'states':rows,'summary':{'minimum_margin_db':min(r['margin_db'] for r in rows),'geometric_clear_hours':visible,'link_model_hours':usable,'maximum_one_way_delay_s':max(r['one_way_light_time_s'] for r in rows)},'dsn':stations,'calibrated':False,'source_url':SOURCES['rf']}
 for i,s in enumerate(samples):
  if s.get('earth_horizon_deg') is None or not number(s.get('earth_range_km'),1,1e10):return {'status':'unknown','config':q,'reason':'Missing Earth geometry or range.','states':[]}
  row=link_budget(s['earth_range_km'],q);clear=s['earth_elevation_deg']-s['earth_horizon_deg']>.3
  row.update(hour=hours[i],earth_geometric_clear=clear,link_model_pass=clear and row['margin_db']>=0);rows.append(row)
  if i<len(samples)-1:
   dt=hours[i+1]-hours[i];visible+=dt*int(clear);usable+=dt*int(row['link_model_pass'])
 return {'status':'ok','config':q,'states':rows,'summary':{'minimum_margin_db':min(r['margin_db'] for r in rows),'geometric_clear_hours':visible,'link_model_hours':usable,'maximum_one_way_delay_s':max(r['one_way_light_time_s'] for r in rows)},'calibrated':False,'source_url':SOURCES['rf'],'receiver':'Declared equivalent receiver. Reference gain is illustrative of a 34 m X-band dish; not a reservation or confirmation of DSN visibility, pointing, weather or station availability.'}

BATTERY_CURVE=[{'temperature_k':253.15,'capacity_factor':.6,'charge_factor':0.,'discharge_factor':.4},{'temperature_k':273.15,'capacity_factor':.9,'charge_factor':.4,'discharge_factor':.8},{'temperature_k':293.15,'capacity_factor':1.,'charge_factor':1.,'discharge_factor':1.},{'temperature_k':313.15,'capacity_factor':.9,'charge_factor':.5,'discharge_factor':.8},{'temperature_k':333.15,'capacity_factor':.5,'charge_factor':0.,'discharge_factor':.3}]
def battery_factors(temperature,curve):
 if not isinstance(curve,list) or not 2<=len(curve)<=30:raise ValueError('Battery requires a declared temperature curve.')
 last=-math.inf
 for row in curve:
  if not isinstance(row,dict) or not number(row.get('temperature_k'),20,600) or row['temperature_k']<=last or any(not number(row.get(k),0,1) for k in ('capacity_factor','charge_factor','discharge_factor')):raise ValueError('Invalid battery temperature curve.')
  last=row['temperature_k']
 if not curve[0]['temperature_k']<=temperature<=curve[-1]['temperature_k']:return None
 for a,b in zip(curve,curve[1:]):
  if a['temperature_k']<=temperature<=b['temperature_k']:
   f=(temperature-a['temperature_k'])/(b['temperature_k']-a['temperature_k'])
   return {k:a[k]+f*(b[k]-a[k]) for k in ('capacity_factor','charge_factor','discharge_factor')}
 return None
def coupled_scenario(samples,energy,fault,policy,thermal_raw=None,rf_raw=None,curve=None,stations=None,cancel=None):
 """Causal interval coupling, with the thermostat and battery limits sampled on the NASA grid."""
 from .energy_model import simulate_energy,validate_energy
 q=thermal_config(thermal_raw);rf=rf_scenario(samples,rf_raw,stations);hours=sample_hours(samples)
 energy=validate_energy(energy,hours[-1]);curve=curve if curve is not None else BATTERY_CURVE
 if rf['status']!='ok':return {'status':'unknown','thermal':{'status':'unknown','states':[]},'rf':rf,'budget':None,'integration_completed':False}
 working_samples=samples
 if stations is not None and stations['status']=='ok':
  working_samples=[]
  for original,station in zip(samples,stations['states']):
   chosen=station['selected']
   working_samples.append(original|{'eclipse_earth_azimuth_deg':original.get('eclipse_earth_azimuth_deg',original['earth_azimuth_deg']),'eclipse_earth_elevation_deg':original.get('eclipse_earth_elevation_deg',original['earth_elevation_deg']),'eclipse_earth_range_km':original.get('eclipse_earth_range_km',original['earth_range_km']),'earth_azimuth_deg':chosen['lunar_azimuth_deg'],'earth_elevation_deg':chosen['lunar_elevation_deg'],'earth_horizon_deg':chosen['lunar_horizon_deg']})
 effective_radio=max(energy['radio_load_w'],rf['config']['tx_power_w']/rf['config']['pa_efficiency']+rf['config']['electronics_w'])
 energy=energy|{'radio_load_w':effective_radio}
 conditions=[{'capacity_factor':1.,'charge_factor':1.,'discharge_factor':1.,'heater_w':0.,'rf_rate_bps':0.} for _ in samples[:-1]]
 temperature=q['initial_k'];heating=temperature<=q['heater_on_k'];states=[{'hour':0.,'temperature_k':temperature,'heater_on':heating}]
 minimum=maximum=temperature;outside=heater_wh=requested_heater_wh=0.;budget=None
 for i,s in enumerate(samples[:-1]):
  if cancel is not None and cancel.is_set():raise InterruptedError('Engineering study cancelled.')
  factors=battery_factors(temperature,curve)
  if factors is None:
   return {'status':'unknown','reason':'Temperature leaves the declared battery curve; no extrapolation is performed.','thermal':{'status':'unknown','config':q,'states':states,'resolved_hours':hours[i],'summary':{'minimum_k':minimum,'maximum_k':maximum,'outside_declared_battery_limits_hours':outside,'heater_served_wh':heater_wh,'heater_requested_wh':requested_heater_wh}},'rf':rf,'budget':None,'integration_completed':False,'battery_curve':curve}
  if temperature<=q['heater_on_k']:heating=True
  elif temperature>=q['heater_off_k']:heating=False
  conditions[i]=factors|{'heater_w':q['heater_w'] if heating else 0.,'rf_rate_bps':min(rf['states'][i]['maximum_rate_bps'],rf['config']['rate_bps']) if rf['states'][i]['link_model_pass'] else 0.}
  # Past intervals are invariant under future conditions. Reuse the verified electric ledger.
  budget=simulate_energy(working_samples,energy,fault,policy.get('science_slots'),policy.get('optional_enabled',True),conditions)
  if budget['status']!='ok':return {'status':'unknown','thermal':{'status':'unknown','states':states},'rf':rf,'budget':None,'integration_completed':False,'reason':'Missing geometry in electrical propagation.'}
  begin,end=hours[i],hours[i+1];intervals=[(max(begin,a['hour']),min(end,b['hour']),b) for a,b in zip(budget['states'],budget['states'][1:]) if b['hour']>begin+1e-9 and a['hour']<end-1e-9]
  mean_load=sum((b-a)*(x.get('load_w',0)-x.get('heater_w',0)) for a,b,x in intervals)/(end-begin)
  heater=sum((b-a)*x.get('heater_w',0) for a,b,x in intervals)/(end-begin)
  battery_loss_wh=0.
  for before,after in zip(budget['states'],budget['states'][1:]):
   overlap=max(0.,min(end,after['hour'])-max(begin,before['hour']))
   if overlap<=1e-9:continue
   delta=after['battery_wh']-before['battery_wh']
   loss=delta*(1/energy['charge_efficiency']-1) if delta>=0 else -delta*(1-energy['discharge_efficiency'])
   battery_loss_wh+=loss*overlap/(after['hour']-before['hour'])
  battery_loss_w=battery_loss_wh/(end-begin)
  internal=mean_load*q['internal_heat_fraction']+battery_loss_w
  eclipse=occulted_sun_fraction(s)
  if eclipse is None or s.get('sun_horizon_deg') is None:return {'status':'unknown','thermal':{'status':'unknown','states':states},'rf':rf,'budget':None,'integration_completed':False}
  solar=SOLAR_REFERENCE_W_M2*(AU_KM/s['sun_range_km'])**2*q['absorbing_area_m2']*q['absorptivity']*(1-eclipse)*int(s['sun_elevation_deg']-s['sun_horizon_deg']>.3)
  requested_heater_wh+=conditions[i]['heater_w']*(end-begin)
  remaining=(end-begin)*3600
  while remaining>1e-7:
   # Stability bound for the explicit radiative term, evaluated at the current temperature.
   tau=q['capacity_j_k']/(4*q['emissivity']*SIGMA*q['radiating_area_m2']*max(temperature,20.)**3)
   dt=min(30.,remaining,max(.01,.1*tau))
   temperature=thermal_step(temperature,dt,q,solar,internal,heater)
   remaining-=dt;heater_wh+=heater*dt/3600
   outside+=dt/3600*int(temperature<q['battery_min_k'] or temperature>q['battery_max_k'])
   minimum=min(minimum,temperature);maximum=max(maximum,temperature)
  states.append({'hour':end,'temperature_k':temperature,'heater_on':heating,'heater_served_w':heater,'solar_absorbed_w':solar,'internal_w':internal,'battery_loss_w':battery_loss_w})
 thermal={'status':'ok','config':q,'states':states,'summary':{'minimum_k':minimum,'maximum_k':maximum,'outside_declared_battery_limits_hours':outside,'heater_served_wh':heater_wh,'heater_requested_wh':requested_heater_wh,'stored_heat_change_j':q['capacity_j_k']*(temperature-q['initial_k'])},'source_url':SOURCES['thermal'],'calibrated':False}
 budget['model_scope']='coupled_thermal_rf'
 budget['limitations']=[line for line in budget['limitations'] if 'sin degradación térmica' not in line and 'tasa configurada' not in line]+['Temperature factors and independent heater consumption are included with the declared equivalent-node model and battery curve.','Transmission is capped by the conditional station-specific RF model; this does not reserve DSN service.']
 # The final temperature may be outside the curve even if the preceding interval was defined.
 curve_supported=battery_factors(temperature,curve) is not None
 return {'status':'ok' if curve_supported else 'unknown','thermal':thermal,'rf':rf,'budget':budget if curve_supported else None,'integration_completed':curve_supported,'coupling_method':'causal_interval','battery_curve':curve,'effective_radio_electrical_w':effective_radio,
 'curve_provenance':'Declared design curve; not a calibrated manufacturer curve. Unavailable capacity is locked, not deleted from the electrical energy ledger.',
 'limitations':['Causal temperature/energy coupling. Battery limits, heater hysteresis and RF rate are held over each NASA interval; radiation is integrated with steps of at most 30 s. Transitions within a NASA interval remain unresolved.','Equivalent isothermal node with prescribed ground radiance; no structural conduction network, measured battery temperature or auto-shadowing.','RF receiver gain, temperature, pointing losses, battery curve and thermal properties are declared assumptions. No DSN station booking or hardware calibration.','The effective radio electrical load is at least RF power divided by PA efficiency plus declared electronics consumption.']}
