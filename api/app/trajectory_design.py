"""Finite-endpoint Lambert seed and Earth/Moon/Sun differential correction.

A parking-orbit transfer design, never an ascent solution or approved launch window.
Units: km, seconds, km/s. Ephemerides: NAIF DE440 geometric J2000 states.
"""
import math
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq,least_squares
from scipy.interpolate import CubicSpline
from .spice_service import body_state,ephemeris_time,kernel_manifest,LOCK,spice
MU_E=398600.43550702266;MU_M=4902.80011845755;MU_S=132712440041.27942
def stumpff(z):
 if abs(z)<1e-7:return .5-z/24+z*z/720,1/6-z/120+z*z/5040
 if z>0:
  a=math.sqrt(z);return (1-math.cos(a))/z,(a-math.sin(a))/a**3
 a=math.sqrt(-z);return (math.cosh(a)-1)/(-z),(math.sinh(a)-a)/a**3
def lambert(r1,r2,seconds,mu=MU_E,prograde=True):
 r1=np.asarray(r1,dtype=float);r2=np.asarray(r2,dtype=float);a1=float(np.linalg.norm(r1));a2=float(np.linalg.norm(r2))
 if a1<=0 or a2<=0 or seconds<=0:raise ValueError('Invalid Lambert boundary conditions.')
 cosine=np.clip(float(r1@r2)/(a1*a2),-1,1);sine=float(np.linalg.norm(np.cross(r1,r2)))/(a1*a2)
 if (np.cross(r1,r2)[2]<0)==prograde:sine=-sine
 if abs(sine)<1e-6 or 1-cosine<1e-8:raise ValueError('Lambert geometry is singular; change parking-orbit phase.')
 A=sine*math.sqrt(a1*a2/(1-cosine))
 def evaluate(z,values=False):
  C,S=stumpff(z)
  if C<=0:return None
  y=a1+a2+A*(z*S-1)/math.sqrt(C)
  if y<0:return None
  residual=(y/C)**1.5*S+A*math.sqrt(y)-math.sqrt(mu)*seconds
  return (y,C,S) if values else residual
 previous=None;root=None
 for z in np.linspace(-4*math.pi**2+1e-5,4*math.pi**2-1e-5,600):
  value=evaluate(float(z))
  if value is None:continue
  if previous is not None and value*previous[1]<=0:root=brentq(lambda x:evaluate(x),previous[0],float(z),xtol=1e-11);break
  previous=(float(z),value)
 if root is None:raise ValueError('No zero-revolution Lambert root in the declared branch.')
 y,_,__=evaluate(root,True);f=1-y/a1;g=A*math.sqrt(y/mu);gd=1-y/a2
 if abs(g)<1e-10:raise ValueError('Degenerate Lambert solution.')
 return (r2-f*r1)/g,(gd*r2-r1)/g
def third_body_acceleration(r,body,mu):
 delta=body-r
 return mu*(delta/np.linalg.norm(delta)**3-body/np.linalg.norm(body)**3)
def ephemeris_interpolators(et,seconds,step=900):
 times=np.linspace(0,seconds,max(3,int(math.ceil(seconds/step))+1))
 moon=np.asarray([body_state('MOON',et+t,'EARTH')[:3] for t in times])
 sun=np.asarray([body_state('SUN',et+t,'EARTH')[:3] for t in times])
 return CubicSpline(times,moon,axis=0),CubicSpline(times,sun,axis=0)
def propagate(r,v,seconds,moon,sun,rtol=1e-9,strength=1.,variational=False,detect_collision=False,cancel=None):
 def derivative(t,y):
  if cancel is not None and cancel.is_set():raise InterruptedError('Trajectory study cancelled.')
  p=y[:3];radius=np.linalg.norm(p);m=moon(t);s=sun(t)
  acceleration=-MU_E*p/radius**3+strength*(third_body_acceleration(p,m,MU_M)+third_body_acceleration(p,s,MU_S))
  base=np.r_[y[3:6],acceleration]
  if not variational:return base
  I=np.eye(3);gradient=MU_E*(3*np.outer(p,p)/radius**5-I/radius**3)
  for body,mu in ((m,MU_M),(s,MU_S)):
   delta=body-p;d=np.linalg.norm(delta);gradient+=strength*mu*(3*np.outer(delta,delta)/d**5-I/d**3)
  matrix=np.block([[np.zeros((3,3)),I],[gradient,np.zeros((3,3))]])
  return np.r_[base,(matrix@y[6:].reshape(6,6)).ravel()]
 initial=np.r_[r,v,np.eye(6).ravel()] if variational else np.r_[r,v]
 def earth_surface(t,y):return np.linalg.norm(y[:3])-6378.1366
 def moon_surface(t,y):return np.linalg.norm(y[:3]-moon(t))-1737.4
 earth_surface.terminal=moon_surface.terminal=True;earth_surface.direction=moon_surface.direction=-1
 return solve_ivp(derivative,(0.,seconds),initial,rtol=rtol,atol=1e-9,method='DOP853',max_step=300 if detect_collision else 1800,dense_output=True,events=(earth_surface,moon_surface) if detect_collision else None)
def correct_velocity(r0,r1,v0,duration,moon,sun,cancel=None):
 # Continuation avoids the singular, sensitive full-gravity Lambert starting guess.
 velocity=np.array(v0);strength=0.;increment=.1;calls=0;steps=0
 while strength<1.-1e-9 and calls<160:
  trial=min(1.,strength+increment);cached={}
  def get(v):
   nonlocal calls
   key=tuple(v)
   if key not in cached:
    calls+=1;cached[key]=propagate(r0,v,duration,moon,sun,strength=trial,variational=True,cancel=cancel)
   return cached[key]
  def residual(v):
   sol=get(v)
   return (sol.y[:3,-1]-r1)/1000. if sol.success else np.full(3,1e9)
  def jac(v):return get(v).y[6:,-1].reshape(6,6)[:3,3:]/1000.
  fit=least_squares(residual,velocity,jac=jac,max_nfev=12,xtol=1e-11,ftol=1e-11,gtol=1e-10,x_scale='jac')
  error=float(np.linalg.norm(residual(fit.x))*1000)
  if error<.02:
   velocity=fit.x;strength=trial;steps+=1;increment=min(.25,increment*1.4)
  else:
   increment/=2
   if increment<.001:break
 return velocity,calls,steps,strength
def solve_leg(start_utc,end_utc,lat,lon,outbound=True,cancel=None):
 et0,et1=ephemeris_time(start_utc),ephemeris_time(end_utc);duration=et1-et0
 if not 24*3600<=duration<=10*86400:raise ValueError('Transfer design supports 1–10 days per leg.')
 moon,sun=ephemeris_interpolators(et0,duration);moon0=body_state('MOON',et0);moon1=body_state('MOON',et1)
 latitude,longitude=math.radians(lat),math.radians(lon);up=np.array([math.cos(latitude)*math.cos(longitude),math.cos(latitude)*math.sin(longitude),math.sin(latitude)])
 with LOCK:rotation=spice.pxform('MOON_ME','J2000',et1 if outbound else et0)
 lunar_up=rotation@up
 if outbound:
  # Explicit notional 200 km orbit, with a phase ninety degrees behind the Earth-Moon direction.
  u=moon0[:3]/np.linalg.norm(moon0[:3]);normal=np.cross(moon0[:3],moon0[3:]);normal/=np.linalg.norm(normal)
  r0=-np.cross(normal,u)*(6378.1366+200.)
  r1=moon1[:3]+lunar_up*(1737.4+100.)
  circular=np.cross(normal,r0);circular/=np.linalg.norm(circular);initial_reference=circular*math.sqrt(MU_E/np.linalg.norm(r0))
 else:
  r0=moon0[:3]+lunar_up*(1737.4+100.)
  r1=moon1[:3]/np.linalg.norm(moon1[:3])*(6378.1366+120.)
  tangent=np.cross(lunar_up,np.array([0.,0.,1.]));tangent/=np.linalg.norm(tangent)
  initial_reference=moon0[3:]+tangent*math.sqrt(MU_M/(1737.4+100.))
 v0,seed_final=lambert(r0,r1,duration)
 if outbound:
  velocity,evaluations,steps,strength=correct_velocity(r0,r1,v0,duration,moon,sun,cancel)
 else:
  reverse_moon=lambda t:moon(duration-t)
  reverse_sun=lambda t:sun(duration-t)
  reverse_seed,_=lambert(r1,r0,duration,prograde=False)
  reverse_velocity,evaluations,steps,strength=correct_velocity(r1,r0,reverse_seed,duration,reverse_moon,reverse_sun,cancel)
  reverse=propagate(r1,reverse_velocity,duration,reverse_moon,reverse_sun,1e-11,cancel=cancel)
  velocity=-reverse.y[3:,-1]
  if strength>=1.-1e-9:
   for _ in range(6):
    sol=propagate(r0,velocity,duration,moon,sun,1e-11,variational=True,cancel=cancel);evaluations+=1
    residual=sol.y[:3,-1]-r1
    if np.linalg.norm(residual)<.001:break
    correction=np.linalg.solve(sol.y[6:,-1].reshape(6,6)[:3,3:],residual)
    if np.linalg.norm(correction)>.05:break
    velocity-=correction
 solved=propagate(r0,velocity,duration,moon,sun,1e-11,detect_collision=True,cancel=cancel);terminal=float(np.linalg.norm(solved.y[:3,-1]-r1))
 times=np.linspace(0,min(duration,solved.t[-1]),241);states=solved.sol(times).T
 earth_min=min(float(np.linalg.norm(p[:3])) for p in states);moon_min=min(float(np.linalg.norm(p[:3]-moon(t))) for t,p in zip(times,states))
 # Sampled clearance is explicitly not a guarantee of no collision between samples.
 status='closed' if strength>=1.-1e-9 and solved.success and solved.t[-1]>=duration-1e-6 and terminal<1. and earth_min>6378.1366 and moon_min>1737.4 else 'unresolved'
 if outbound:
  relative=solved.y[3:,-1]-moon1[3:];tangent=np.cross(lunar_up,np.array([0.,0.,1.]));tangent/=np.linalg.norm(tangent)
  capture=float(np.linalg.norm(relative-tangent*math.sqrt(MU_M/(1737.4+100.))))
 else:capture=None
 return {'status':status,'start_utc':start_utc,'end_utc':end_utc,'flight_hours':duration/3600,'terminal_error_km':terminal,'collision_detected':bool(solved.t[-1]<duration-1e-6),'propagated_hours':float(solved.t[-1]/3600),'iterations':steps,'gravity_continuation_fraction':strength,'propagations':evaluations,'departure_impulse_km_s':float(np.linalg.norm(velocity-initial_reference)),'lunar_capture_impulse_km_s':capture,'minimum_sampled_earth_radius_km':earth_min,'minimum_sampled_moon_radius_km':moon_min,'initial_position_km':r0.tolist(),'initial_velocity_km_s':velocity.tolist(),'target_position_km':r1.tolist(),'final_velocity_km_s':solved.y[3:,-1].tolist(),'points':[{'hour':float(t/3600),'position_km':p[:3].tolist(),'moon_position_km':moon(t).tolist()} for t,p in zip(times,states)]}
def design_roundtrip(mission,lat,lon,cancel=None):
 kernel_manifest()
 outbound=solve_leg(mission['departure_utc'],mission['arrival_utc'],lat,lon,True,cancel)
 returning=solve_leg(mission['surface_end_utc'],mission['return_utc'],lat,lon,False,cancel)
 return {'status':'closed' if outbound['status']==returning['status']=='closed' else 'unresolved','outbound':outbound,'return':returning,'source':'NASA/JPL NAIF DE440','model':'Earth central gravity plus direct-minus-indirect Moon and Sun point masses, geometric J2000; DOP853; Lambert seed and differential correction.','limitations':['Notional parking-orbit phase and plane; the actual launch site is not targeted.','Impulsive burns; no ascent, finite-thrust guidance, mass/fuel sizing, lunar descent/ascent or atmospheric entry validation.','Arrival and return durations are declared design boundaries; they are solved separately, not a proven launch opportunity.','Integrator surface-crossing events stop detected collisions; finite temporal resolution and spherical bodies are not collision-safety certification. The landing coordinates orient a 100 km lunar-orbit target, not a surface intercept.','A small terminal residual verifies boundary closure only; it does not prove an operationally flyable mission.']}
