import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronRight, Database, Layers, MapPin, Orbit, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { loadDetailTile } from '../sites/lunarDetail'
import { loadAtlas,type AtlasData } from '../sites/atlasGeometry'
import TacticalSurvivalCockpit from './TacticalSurvivalCockpit'
import { Tactical3DScene } from './Tactical3DScene'
import MissionCopilot,{type CopilotAction} from './MissionCopilot'
import { classifyPolarCell,findPolarCell,rankPolarCells,validatePolarSurface,type PolarCell,type PolarSurface } from './polarScience'
import type { RaycastHit } from './tacticalMath'
import './mission-experience.css'
const ray:RaycastHit={hit:true,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:NaN,marginDeg:NaN}
const n=(v:number|null|undefined,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('es',{maximumFractionDigits:d}):'Sin datos'
export default function MissionExperience({onOpenScientific,active=true}:{onOpenScientific:()=>void;active?:boolean}){
  const [mode,setMode]=useState<'polar'|'local'>('polar')
  const [data,setData]=useState<PolarSurface|null>(null),[atlas,setAtlas]=useState<AtlasData|null>(null)
  const [loadError,setLoadError]=useState(''),[attempt,setAttempt]=useState(0)
  const [evaluated,setEvaluated]=useState(false),[threshold,setThreshold]=useState('10'),[applied,setApplied]=useState(10)
  const [selection,setSelection]=useState<PolarCell|null>(null),[notice,setNotice]=useState('')
  const [layer,setLayer]=useState<'screening'|'relief'>('screening'),[inspector,setInspector]=useState(false)
  const [focusZone,setFocusZone]=useState(false)
  const [focusTerrain,setFocusTerrain]=useState<AtlasData|null>(null),[detailStatus,setDetailStatus]=useState('')
  const [shadingStatus,setShadingStatus]=useState('Relieve NASA')
  const [showCandidates,setShowCandidates]=useState(()=>window.innerWidth>700)
  const localRef=useRef<HTMLDivElement>(null)
  const fresh=evaluated&&Number(threshold)===applied&&threshold.trim()!==''
  const assessments=useMemo(()=>data&&fresh?data.cells.map(c=>classifyPolarCell(c,applied)):[],[data,fresh,applied])
  const alternatives=useMemo(()=>data&&fresh?rankPolarCells(data,applied):[],[data,fresh,applied])
  const selected=selection&&fresh?classifyPolarCell(selection,applied):null
  const counts=useMemo(()=>assessments.reduce((o,a)=>(o[a.risk]++,o),{green:0,yellow:0,red:0,unknown:0}),[assessments])
  useEffect(()=>{
    const ac=new AbortController()
    setLoadError('');setData(null);setAtlas(null)
    Promise.all([fetch('/api/polar/surface',{signal:ac.signal}).then(async r=>{if(!r.ok)throw new Error('No se pudo cargar la evaluación regional NASA.');return validatePolarSurface(await r.json())}),loadAtlas(ac.signal)])
      .then(([s,a])=>{if(!ac.signal.aborted){setData(s);setAtlas(a)}}).catch(e=>{if(!ac.signal.aborted)setLoadError(e instanceof Error?e.message:'Datos regionales no disponibles.')})
    return()=>ac.abort()
  },[attempt])
  useEffect(()=>{
    if(!focusZone||!selection||!atlas){setFocusTerrain(null);setDetailStatus('');return}
    const ac=new AbortController()
    setFocusTerrain(null);setDetailStatus('Cargando relieve de mayor detalle…')
    loadDetailTile(atlas,selection.latitude_deg,selection.longitude_deg,ac.signal)
      .then(tile=>{if(!ac.signal.aborted){setFocusTerrain(tile);setDetailStatus(tile?'Relieve visual ~396 m · fuente NASA 80 m':'Sin detalle adicional; se conserva la vista regional')}})
      .catch(()=>{if(!ac.signal.aborted)setDetailStatus('No se pudo cargar más detalle; la vista regional sigue disponible')})
    return()=>ac.abort()
  },[focusZone,selection,atlas])
  function analyze(){
    const t=Number(threshold)
    if(!data||!threshold.trim()||!Number.isFinite(t)||t<0||t>45){setNotice('Define un umbral regional entre 0 y 45 grados.');return}
    setApplied(t);setEvaluated(true);setLayer('screening');setNotice('')
  }
  function select(lat:number,lon:number){
    if(!data)return
    const c=findPolarCell(data,lat,lon)
    if(!c){setNotice('Selecciona una zona entre 80°S y 90°S.');return}
    setSelection(c);setNotice('')
  }
  function openLocal(){
    setMode('local');setNotice('')
    setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),0)
  }
  const copilotContext=useMemo(()=>({
    selected:selection?{id:selection.id,name:'Zona polar seleccionada',lat:selection.latitude_deg,lon:selection.longitude_deg,slopeDeg:selection.regional_slope_deg,resolutionM:80,coverage:'regional'}:null,
    regional:{scope:'80S–90S',sourceResolutionM:80,totalCells:data?.statistics.cap_center_cells??0,knownCells:data?.statistics.known_cells??0,evaluated:fresh},
    simulation:{status:fresh?'ready':evaluated?'stale':'not_run',risk:selected?.risk??'unknown',reasons:selected?[selected.reason]:[],sunHours:null,earthHours:null},
    alternatives:alternatives.map((a,i)=>({id:a.cell.id,name:'Zona '+(i+1),lat:a.cell.latitude_deg,lon:a.cell.longitude_deg,slopeDeg:a.cell.regional_slope_deg,resolutionM:80}))
  }),[selection,data,fresh,evaluated,selected,alternatives])
  function action(a:CopilotAction){
    if(!a)return
    if(a.type==='details'){openLocal();return}
    if(a.type==='polar_view'){setMode('polar');return}
    if(a.type==='run_simulation'){setMode('polar');analyze();return}
    if(a.type==='select_cell'&&data){
      const c=data.cells.find(c=>c.id===a.target_id)
      if(c){setSelection(c);setMode('polar')}
    }
  }
  function download(){
    if(!fresh||!data)return
    const report={scope:'regional-terrain-screening',latitude_bounds_deg:data.latitude_bounds_deg,source_url:data.source_url,source_sha256:data.source_sha256,source_resolution_m:80,cell_spacing_m:data.cell_spacing_m,
      evaluated_at:new Date().toISOString(),max_regional_slope_deg:applied,statistics:data.statistics,classes:counts,selection:selected,alternatives,
      assessments:assessments.filter(a=>a.cell.latitude_deg<=-80).map(a=>({id:a.cell.id,risk:a.risk,regional_slope_deg:a.cell.regional_slope_deg,latitude_deg:a.cell.latitude_deg,longitude_deg:a.cell.longitude_deg})),limitations:data.limitations}
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-polo-sur.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div className="mission-experience">
    <div hidden={mode!=='polar'}>
      <header className="explorer-header"><a className="explorer-logo" href="#" onClick={e=>{e.preventDefault();setMode('polar')}}><Orbit size={31}/><span>LUNAR ORACLE<small>EXPLORA · COMPRENDE · PLANIFICA</small></span></a><div className="explorer-header-right"><span className="nasa-badge"><i/> NASA LOLA · DATOS REALES</span><button onClick={onOpenScientific}><Database size={14}/> Herramientas científicas</button></div></header>
      <div className="explorer-steps" aria-label="Pasos de planificación"><button className="step active" onClick={()=>setMode('polar')}><b>1</b><span>Explora el polo sur<small>Encuentra zonas de interés</small></span></button><ChevronRight size={14}/><button className={'step '+(selection?'completed':'')} onClick={()=>{if(!selection)setNotice('Haz clic en la Luna o elige una de las zonas propuestas.')}}><b>{selection?<Check size={14}/>:'2'}</b><span>Elige una zona<small>Comprende sus condiciones</small></span></button><ChevronRight size={14}/><button className="step" onClick={openLocal}><b>3</b><span>Planifica tu misión<small>Analiza Sol, Tierra y descenso</small></span></button></div>
      <div className="explorer-workspace">
        <aside className="explorer-left">
          <div className="eyebrow">EMPIEZA AQUÍ</div><h1>Todo el polo sur.<br/><em>Una decisión a la vez.</em></h1>
          <p className="explorer-lead">Analiza el terreno, descubre zonas para estudiar y después planifica tu llegada.</p>
          <section className="explorer-coverage"><div><Layers size={17}/><strong>80°S → 90°S</strong></div><p>{data?n(data.statistics.covered_area_km2,0)+' km² con datos preparados':'Cargando cobertura NASA…'}</p><span>Fuente NASA: 80 m · análisis por zonas de 4,75 km</span></section>
          <button className="primary-explore" onClick={analyze} disabled={!data||!atlas}><Search size={17}/>{fresh?'Actualizar análisis regional':'Analizar todo el polo sur'}<ArrowRight size={16}/></button>
          <p className="explorer-small">{fresh?'El mapa muestra las clases calculadas. Haz clic en cualquier zona.':'El análisis cubre el casquete completo con la resolución regional disponible.'}</p>
          <details className="regional-settings"><summary><SlidersHorizontal size={13}/> Ajustar el análisis</summary><label>Umbral de pendiente regional °<input aria-label="Pendiente regional máxima" type="number" min="0" max="45" value={threshold} onChange={e=>setThreshold(e.target.value)}/></label><p>Pendiente percentil 95 de los píxeles de 80 m de cada zona. Es un criterio de exploración, distinto de la pendiente bajo las patas de una nave.</p></details>
          {notice&&<p className="explorer-notice" role="status">{notice}</p>}
          {loadError&&<div className="science-error" role="alert">{loadError}<button onClick={()=>setAttempt(a=>a+1)}>Reintentar</button></div>}
          <details className="candidate-list" open={showCandidates} onToggle={e=>setShowCandidates(e.currentTarget.open)}><summary>Zonas para estudiar {fresh?'· '+alternatives.length:''}</summary><div className="explorer-section-title"><span>ZONAS PARA ESTUDIAR</span>{fresh&&<small>Búsqueda calculada</small>}</div>
          {!fresh?<div className="empty-candidates">Analiza el polo sur para comparar tres zonas con relieve regional más suave.</div>:alternatives.length?alternatives.map((a,i)=><button key={a.cell.id} className={'candidate-card '+(selection?.id===a.cell.id?'selected':'')} onClick={()=>setSelection(a.cell)}><span className={'candidate-number '+a.risk}>0{i+1}</span><div><strong>Zona {i+1} · {n(Math.abs(a.cell.latitude_deg),2)}°S</strong><small>{n(a.cell.longitude_deg,2)}° E · pendiente P95 {n(a.cell.regional_slope_deg)}°</small><span>{a.label}</span></div><ChevronRight size={14}/></button>):<p className="empty-candidates">Ninguna zona cumple el criterio regional elegido. Prueba otro umbral sin confundirlo con aptitud de aterrizaje.</p>}
          </details><div className="local-entry"><strong>¿Listo para una misión?</strong><p>Dos áreas cuentan además con análisis local de 5 m y horizontes para consultar Sol y Tierra.</p><button onClick={openLocal}>Abrir estudio detallado <ArrowUpRightIcon/></button></div>
        </aside>
        <main className="explorer-map-column">
          <div className="explorer-map-heading"><div><span className="eyebrow">MAPA INTERACTIVO · POLO SUR LUNAR</span><h2>{fresh?'Descubre dónde seguir explorando.':'Empieza mirando el panorama completo.'}</h2></div><div className="layer-tabs">{focusZone&&<button onClick={()=>setFocusZone(false)}>Todo el polo</button>}<button aria-pressed={layer==='screening'} onClick={()=>setLayer('screening')}>Evaluación</button><button aria-pressed={layer==='relief'} onClick={()=>setLayer('relief')}>Relieve</button></div></div>
          <div className="explorer-map" data-testid="polar-map">
            <Tactical3DScene latDeg={selection?.latitude_deg??-90} lonDeg={selection?.longitude_deg??0} observerHeightM={2} sunAzimuthDeg={0} sunElevationDeg={0} earthAzimuthDeg={0} earthElevationDeg={0} minSolarElevation={0} maxSlopeDeg={applied} currentSlopeDeg={NaN}
              atlasData={atlas} focusTerrainData={focusTerrain} sunRaycast={ray} earthRaycast={ray} cameraView="polar" siteName="Polo sur" placementMode onSurfacePlace={select} active={active&&mode==='polar'} overview onShadingStatus={setShadingStatus} focusZone={focusZone} cameraResetKey={focusZone?1:0} polarSurface={data} polarAssessments={fresh&&layer==='screening'?assessments:[]} polarSelection={selection}/>
            <div className="polar-quality-note">{shadingStatus}{detailStatus&&<small role="status">{detailStatus}</small>}</div><div className="polar-scope-badge"><span className={fresh?'live-dot':''}/>{fresh&&layer==='screening'?'EVALUACIÓN REGIONAL DE TERRENO':'RELIEVE NASA · SIN CLASIFICAR'}<small>{loadError?'Datos no disponibles · usa Reintentar':data?n(data.statistics.known_cells,0)+' zonas evaluables':'Cargando datos…'}</small></div>
            {!selection&&<div className="polar-click-hint"><MapPin size={15}/>{loadError?'No se puede analizar sin datos NASA. Reintenta la carga.':fresh?'Haz clic en una zona para conocer sus datos':'Pulsa «Analizar todo el polo sur» para empezar'}</div>}
            <div className="polar-legend"><span><i className="green"/>Prioridad de estudio{fresh?' · '+n(counts.green,0):''}</span><span><i className="yellow"/>Precaución</span><span><i className="red"/>Relieve exigente</span><span><i className="unknown"/>Datos ausentes</span></div>
          </div>
          <div className="explorer-bottom-note"><Layers size={18}/><div><strong>El mapa regional ayuda a buscar; el estudio local evalúa la misión.</strong><p>El cuadrado anterior era un parche local de 1,05 km. Ahora empiezas por todo el casquete; Sol, Tierra y aterrizaje se analizan por separado donde hay datos de detalle.</p></div><button onClick={()=>setInspector(v=>!v)}>{inspector?'Ocultar método':'Ver datos y alcance'}</button></div>
          {inspector&&<section className="polar-method"><h3>Qué se ha analizado</h3><p>Fuente NASA LOLA de 80 m. Cada zona resume 4,75 × 4,75 km; el percentil 95 refleja las pendientes regionales. Cubrimos aproximadamente el 99,7% del área del casquete; la franja de borde y nodata se conservan como desconocidos.</p><p>Los colores no garantizan aterrizajes. Aún falta calcular horizontes locales, Sol/Tierra, rocas y huella en las zonas nuevas.</p><a href={data?.source_url??'https://pgda.gsfc.nasa.gov/'} target="_blank" rel="noreferrer">Ver producto NASA original ↗</a><button disabled={!fresh} onClick={download}>Descargar evaluación regional</button></section>}
        </main>
        <aside className="explorer-right">
          {selection?<section className="zone-summary"><span className="eyebrow">TU ZONA SELECCIONADA</span><h2>{n(Math.abs(selection.latitude_deg),3)}°S · {n(selection.longitude_deg,3)}°E</h2><span className={'zone-class '+(selected?.risk??'unknown')}>{selected?.label??'Pendiente de analizar'}</span><p>{selected?.reason??'Ejecuta el análisis regional para clasificar esta zona.'}</p><button className="zoom-zone" onClick={()=>setFocusZone(v=>!v)}>{focusZone?'Volver a todo el polo':'Acercar esta zona'} <Search size={13}/></button><dl><div><dt>Pendiente P95 · 80 m</dt><dd>{n(selection.regional_slope_deg)}°</dd></div><div><dt>Elevación del centro</dt><dd>{n(selection.elevation_m,0)} m</dd></div><div><dt>Sol y Tierra</dt><dd>Sin evaluar</dd></div><div><dt>Aterrizaje local</dt><dd>Requiere detalle</dd></div></dl><button onClick={openLocal}>Ver áreas con estudio de misión <ArrowRight size={13}/></button></section>:<section className="zone-summary welcome"><MapPin size={22}/><h2>Elige tu próximo destino.</h2><p>Haz clic sobre la Luna o usa una zona propuesta. Aquí verás sus mediciones y qué falta por estudiar.</p></section>}
          <MissionCopilot context={copilotContext} onAction={action} active={active&&mode==='polar'}/>
        </aside>
      </div>
    </div>
    <div ref={localRef} hidden={mode!=='local'}><TacticalSurvivalCockpit onOpenScientific={onOpenScientific} active={active&&mode==='local'} onBackToPolar={()=>setMode('polar')}/></div>
  </div>
}
function ArrowUpRightIcon(){return <Sparkles size={13}/>}
