"""Launch facilities are scenario context; ascent/launch windows are not solved."""
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
LAUNCH_SITES={
 'ksc-39b':{'id':'ksc-39b','name':'Kennedy Space Center · LC-39B','timezone':'America/New_York','use':'Referencia Artemis / SLS','source_url':'https://www.nasa.gov/humans-in-space/exploration-ground-systems/launch-pad-39b/'},
 'ksc-39a':{'id':'ksc-39a','name':'Kennedy Space Center · LC-39A','timezone':'America/New_York','use':'Lanzamientos comerciales para NASA','source_url':'https://www.nasa.gov/humans-in-space/commercial-space/commercial-crew-program/commercial-crew-program-overview/'},
 'vandenberg-4e':{'id':'vandenberg-4e','name':'Vandenberg · SLC-4E','timezone':'America/Los_Angeles','use':'Referencia de misiones científicas; no presupone una trayectoria lunar compatible','source_url':'https://svs.gsfc.nasa.gov/14803/'},
}
ALLOWED_TIMEZONES=('America/New_York','America/Los_Angeles','America/La_Paz','UTC')

def local_to_utc(local_datetime,tz):
 if tz not in ALLOWED_TIMEZONES:raise ValueError('Zona horaria no admitida.')
 try:local=datetime.strptime(local_datetime,'%Y-%m-%dT%H:%M')
 except (ValueError,TypeError):raise ValueError('Fecha y hora local inválidas.')
 zone=ZoneInfo(tz);matches=set()
 for fold in (0,1):
  utc=local.replace(tzinfo=zone,fold=fold).astimezone(timezone.utc)
  if utc.astimezone(zone).replace(tzinfo=None)==local:matches.add(utc)
 if not matches:raise ValueError('Esa hora local no existe por el cambio al horario de verano. Indica otra hora o UTC explícito.')
 if len(matches)>1:raise ValueError('Esa hora local ocurre dos veces por el cambio de horario. Indica UTC o un desplazamiento explícito.')
 return next(iter(matches))
