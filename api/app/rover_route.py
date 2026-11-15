"""Bounded, deterministic terrain routing on known native DEM footprint cells."""
import heapq,math
from .energy_model import number
from .native_terrain import coordinates,R
DEFAULT={'mass_kg':50.,'speed_m_s':.05,'rolling_coefficient':.15,'drive_efficiency':.5,'auxiliary_w':15.,'battery_wh':500.,'initial_soc':.85,'reserve_soc':.2,'maximum_edge_slope_deg':10.}
LIMITS={'mass_kg':(.1,1e5),'speed_m_s':(.001,10),'rolling_coefficient':(.001,2),'drive_efficiency':(.01,1),'auxiliary_w':(0,1e5),'battery_wh':(.01,1e7),'initial_soc':(0,1),'reserve_soc':(0,1),'maximum_edge_slope_deg':(0,45)}
def route(study,raw=None,goal_index=None,start_index=None):
 if raw is not None and (not isinstance(raw,dict) or set(raw)-set(DEFAULT)):raise ValueError('Invalid rover configuration.')
 q=DEFAULT|dict(raw or {})
 if any(not number(q.get(k),*bounds) for k,bounds in LIMITS.items()):raise ValueError('Invalid rover parameter.')
 g=study['grid'];w,h=g['width'],g['height'];size=w*h
 if size>90601 or len(g['risk'])!=size or len(g['elevations_m'])!=size:raise ValueError('Invalid native terrain grid.')
 explicit_goal=goal_index is not None
 start=(h//2)*w+w//2 if start_index is None else start_index
 if not isinstance(start,int) or isinstance(start,bool) or not 0<=start<size:raise ValueError('Invalid rover start cell.')
 if goal_index is not None and (not isinstance(goal_index,int) or isinstance(goal_index,bool) or not 0<=goal_index<size):raise ValueError('Invalid rover goal cell.')
 common={'config':q,'source_resolution_m':study['source_resolution_m'],'sources':study['sources'],'calibrated':False,
 'limitations':['Route is restricted to this native DEM window and cells whose declared footprint and terrain criteria are resolved.','Mass, speed, rolling resistance and efficiency are declared design parameters, not measured vehicle capabilities.','Point-mass lunar gravity, constant rolling resistance, no regenerative braking. No rocks below pixel size, wheel sinkage, slip, slopes between samples, obstacle sensing, thermal survival or communications along the route.','A reachable return in this model is not an operational safety guarantee.']}
 valid=lambda i:g['risk'][i] in (1,2) and number(g['elevations_m'][i],-20000,20000)
 if not study['footprint_resolved']:return common|{'status':'unknown','reason':'Native terrain does not resolve the declared support footprint.','points':[]}
 if not valid(start):return common|{'status':'blocked','reason':'The starting footprint fails or lacks native terrain data. Choose another local center.','points':[]}
 if goal_index is not None and not valid(goal_index):return common|{'status':'blocked','reason':'The goal footprint fails or lacks native terrain data.','points':[]}
 cache={}
 def point(i):
  if i not in cache:
   rr,cc=divmod(i,w);lat,lon=coordinates(g['xmin']+(cc+.5)*g['spacing_m'],g['ymax']-(rr+.5)*g['spacing_m'])
   p,l=math.radians(lat),math.radians(lon);cache[i]=(lat,lon,(math.cos(p)*math.cos(l),math.cos(p)*math.sin(l),math.sin(p)))
  return cache[i]
 def edge(i,j):
  a,b=point(i)[2],point(j)[2]
  cross=(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
  ground=R*math.atan2(math.sqrt(sum(x*x for x in cross)),sum(x*y for x,y in zip(a,b)))
  dz=g['elevations_m'][j]-g['elevations_m'][i]
  if math.degrees(math.atan2(abs(dz),ground))>q['maximum_edge_slope_deg']:return None
  distance=math.hypot(ground,dz);seconds=distance/q['speed_m_s'];gravity=4902.80011845755e9/(R+(g['elevations_m'][i]+g['elevations_m'][j])/2)**2
  wh=(q['mass_kg']*gravity*(q['rolling_coefficient']*ground+max(dz,0))/q['drive_efficiency']+q['auxiliary_w']*seconds)/3600
  return wh,distance,seconds
 def search(origin,goal=None,reverse=False):
  costs={origin:0.};prev={};queue=[(0.,origin)]
  while queue:
   cost,i=heapq.heappop(queue)
   if cost>costs[i]+1e-12:continue
   if i==goal:break
   rr,cc=divmod(i,w)
   for dy in (-1,0,1):
    for dx in (-1,0,1):
     if dx==dy==0 or not (0<=rr+dy<h and 0<=cc+dx<w):continue
     j=(rr+dy)*w+cc+dx
     if not valid(j):continue
     if dx and dy and (not valid(rr*w+cc+dx) or not valid((rr+dy)*w+cc)):continue
     data=edge(j,i) if reverse else edge(i,j)
     if data is None:continue
     candidate=cost+data[0]
     if candidate<costs.get(j,math.inf)-1e-12:
      costs[j]=candidate;prev[j]=i;heapq.heappush(queue,(candidate,j))
  return costs,prev
 def path(prev,end,origin):
  out=[end]
  while out[-1]!=origin:out.append(prev[out[-1]])
  return list(reversed(out))
 available=q['battery_wh']*max(0,q['initial_soc']-q['reserve_soc'])
 costs,prev=search(start,goal_index)
 if not explicit_goal:
  returning,return_prev=search(start,reverse=True)
  choices=sorted((i for i in costs if i!=start and i in returning),key=lambda i:sum((a-b)**2 for a,b in zip(point(start)[2],point(i)[2])),reverse=True)
  affordable=[i for i in choices if costs[i]+returning[i]<=available]
  goal_index=(affordable or choices or [start])[0]
  if goal_index==start:return common|{'status':'blocked','reason':'No traversable route to a different goal in this native terrain window.','points':[]}
  back=list(reversed(path(return_prev,goal_index,start)));return_energy=returning[goal_index]
 else:
  if goal_index not in costs or goal_index==start:return common|{'status':'blocked','reason':'No traversable route to a different goal in this native terrain window.','points':[]}
  reverse_cost,reverse_prev=search(goal_index,start)
  if start not in reverse_cost:return common|{'status':'blocked','reason':'Return path is not reachable.','points':[]}
  back=path(reverse_prev,start,goal_index);return_energy=reverse_cost[start]
 outward=path(prev,goal_index,start);indices=outward+back[1:]
 length=seconds=0.
 for i,j in zip(indices,indices[1:]):
  e=edge(i,j);length+=e[1];seconds+=e[2]
 wh=costs[goal_index]+return_energy
 return common|{'status':'found' if wh<=available else 'insufficient_energy','goal_selection':'explicit_cell' if explicit_goal else 'farthest_affordable_roundtrip_in_window','start_index':start,'goal_index':goal_index,'outward_count':len(outward),'energy_wh':wh,'available_above_reserve_wh':available,'final_soc':max(0.,q['initial_soc']-wh/q['battery_wh']),'unserved_energy_wh':max(0.,wh-q['battery_wh']*q['initial_soc']),'roundtrip_distance_m':length,'roundtrip_hours':seconds/3600,'points':[{'index':i,'latitude_deg':point(i)[0],'longitude_deg':point(i)[1],'elevation_m':g['elevations_m'][i]} for i in indices]}
