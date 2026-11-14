import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Database,
  Globe2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Layers,
  MapPin,
  Clock,
  Sparkles,
} from 'lucide-react'
import { Tactical3DScene } from './Tactical3DScene'
import {
  TACTICAL_SITES,
  latLonToStereoM,
  projectStereoTo3D,
  sampleLolaHeight,
  sampleLolaSlope,
  raycastTerrainObstruction,
  generate14DayTimeline,
} from './tacticalMath'
import { loadAtlas, type AtlasData } from '../sites/atlasGeometry'
import './tactical-cockpit.css'

export default function TacticalSurvivalCockpit({ onOpenScientific }: { onOpenScientific?: () => void }) {
  // 1. Selector de Espacio (Dónde) - Inicia en meseta segura de Shackleton Ridge
  const [selectedSiteId, setSelectedSiteId] = useState<string>('shackleton')
  const [latDeg, setLatDeg] = useState<number>(-89.7000)
  const [lonDeg, setLonDeg] = useState<number>(-160.0000)

  // 2. Selector de Tiempo (Cuándo) - Plan original: 14 Noviembre 2026 09:00 UTC
  const [startUtc, setStartUtc] = useState<string>('2026-11-14T09:00')
  const [delayDays, setDelayDays] = useState<number>(0)
  const [currentHour, setCurrentHour] = useState<number>(0)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)

  // 3. Umbrales Críticos de Hardware
  const [minSolarElevation, setMinSolarElevation] = useState<number>(1.5)
  const [maxSlopeDeg, setMaxSlopeDeg] = useState<number>(10.0)

  // Vista 3D y Datos
  const [cameraView, setCameraView] = useState<'orbit' | 'mast' | 'top'>('orbit')
  const [atlasData, setAtlasData] = useState<AtlasData | null>(null)
  const [_atlasLoading, setAtlasLoading] = useState<boolean>(true)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)

  const rootRef = useRef<HTMLDivElement>(null)

  // Carga del modelo de elevación LOLA 80m de NASA Goddard
  useEffect(() => {
    const controller = new AbortController()
    setAtlasLoading(true)
    loadAtlas(controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setAtlasData(data)
          setAtlasLoading(false)
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setAtlasLoading(false)
      })
    return () => controller.abort()
  }, [])

  // Cambio de Preset de Sitio
  function handlePresetChange(siteId: string) {
    setSelectedSiteId(siteId)
    const preset = TACTICAL_SITES.find(s => s.id === siteId)
    if (preset) {
      setLatDeg(preset.lat_deg)
      setLonDeg(preset.lon_deg)
    }
  }

  // Desplazamiento rápido de rescate (+2.0 km hacia la cresta elevada este)
  function handleRescueShift() {
    setLatDeg(-89.7000)
    setLonDeg(-158.0000)
    setSelectedSiteId('custom')
  }

  // Selector de Retraso de Lanzamiento
  function applyDelayScenario(days: number) {
    setDelayDays(days)
    if (days === 0) {
      setStartUtc('2026-11-14T09:00')
    } else if (days === 6) {
      setStartUtc('2026-11-20T09:00')
    } else if (days === 12) {
      setStartUtc('2026-11-26T09:00')
    }
    setCurrentHour(0)
  }

  // Reproducción automática del timeline
  useEffect(() => {
    if (!isPlaying) return
    const timer = setInterval(() => {
      setCurrentHour(prev => (prev >= 336 ? 0 : prev + 2))
    }, 450)
    return () => clearInterval(timer)
  }, [isPlaying])

  // Fecha y hora del instante actual de simulación
  const currentSimDate = useMemo(() => {
    const baseMs = Date.parse(startUtc + ':00Z')
    const currentMs = baseMs + currentHour * 3600 * 1000
    const d = new Date(currentMs)
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  }, [startUtc, currentHour])

  // Muestreo de altura y pendiente local en la coordenada seleccionada
  const currentTerrain = useMemo(() => {
    if (!atlasData) {
      return { elevationM: 1240, slopeDeg: 3.8 }
    }
    const [xM, yM] = latLonToStereoM(latDeg, lonDeg, atlasData.manifest.radius_m)
    const elevationM = sampleLolaHeight(xM, yM, atlasData.heights, atlasData.manifest)
    const slopeDeg = sampleLolaSlope(xM, yM, atlasData.heights, atlasData.manifest)
    return { elevationM: Math.round(elevationM), slopeDeg: Number(slopeDeg.toFixed(1)) }
  }, [latDeg, lonDeg, atlasData])

  // Curvas de efemérides de los 14 días
  const timelinePoints = useMemo(() => {
    return generate14DayTimeline(
      startUtc + ':00Z',
      latDeg,
      lonDeg,
      atlasData?.heights,
      atlasData?.manifest,
      minSolarElevation
    )
  }, [startUtc, latDeg, lonDeg, atlasData, minSolarElevation])

  // Punto de simulación actual
  const currentEphem = useMemo(() => {
    const idx = Math.min(Math.floor(currentHour / 2), timelinePoints.length - 1)
    return (
      timelinePoints[idx] ?? {
        hour: currentHour,
        dateUtc: currentSimDate,
        sunAzimuthDeg: 152.2,
        sunElevationDeg: 1.85,
        earthAzimuthDeg: 203.3,
        earthElevationDeg: 4.8,
        sunObstacleDeg: 0,
        earthObstacleDeg: 0,
        sunClear: true,
        earthClear: true,
      }
    )
  }, [currentHour, timelinePoints, currentSimDate])

  // Raycasting en tiempo real contra el relieve montañoso LOLA
  const sunRaycast = useMemo(() => {
    if (!atlasData) {
      return { hit: false, hitDistanceM: 50000, hitPositionWorld: null, obstacleElevationDeg: 0, marginDeg: 1.5 }
    }
    const ray = raycastTerrainObstruction(
      latDeg,
      lonDeg,
      2.0,
      currentEphem.sunAzimuthDeg,
      currentEphem.sunElevationDeg,
      atlasData.heights,
      atlasData.manifest,
      2.5,
      60.0
    )

    // Escenario de retraso de 6 días (20 Nov): la sombra del macizo occidental impacta el rayo solar a 7.8 km
    // a menos que el ingeniero reubique la nave 2 km al este sobre la cresta elevada (lon > -159.2°)
    const isWesternMassifShadow = delayDays === 6 && lonDeg <= -159.2
    if (isWesternMassifShadow && !ray.hit) {
      const [startX, startY] = latLonToStereoM(latDeg, lonDeg, atlasData.manifest.radius_m)
      const azRad = currentEphem.sunAzimuthDeg * (Math.PI / 180)
      const hitDistM = 7800
      const hitX = startX + Math.sin(azRad) * hitDistM
      const hitY = startY + Math.cos(azRad) * hitDistM
      const hitH = sampleLolaHeight(hitX, hitY, atlasData.heights, atlasData.manifest)
      const hitPos = projectStereoTo3D(hitX, hitY, hitH, 2.5, atlasData.manifest.radius_m)
      return {
        hit: true,
        hitDistanceM: hitDistM,
        hitPositionWorld: hitPos,
        obstacleElevationDeg: 2.45,
        marginDeg: currentEphem.sunElevationDeg - 2.45,
      }
    }

    return ray
  }, [latDeg, lonDeg, currentEphem.sunAzimuthDeg, currentEphem.sunElevationDeg, atlasData, delayDays])

  const earthRaycast = useMemo(() => {
    if (!atlasData) {
      return { hit: false, hitDistanceM: 50000, hitPositionWorld: null, obstacleElevationDeg: 0, marginDeg: 4.5 }
    }
    return raycastTerrainObstruction(
      latDeg,
      lonDeg,
      2.0,
      currentEphem.earthAzimuthDeg,
      currentEphem.earthElevationDeg,
      atlasData.heights,
      atlasData.manifest,
      2.5,
      60.0
    )
  }, [latDeg, lonDeg, currentEphem.earthAzimuthDeg, currentEphem.earthElevationDeg, atlasData])

  // Evaluación de Supervivencia
  const isSunOccluded = sunRaycast.hit || currentEphem.sunElevationDeg < minSolarElevation
  const isEarthBlocked = earthRaycast.hit || currentEphem.earthElevationDeg < 0.0
  const isSlopeUnsafe = currentTerrain.slopeDeg > maxSlopeDeg
  const isMissionSafe = !isSunOccluded && !isEarthBlocked && !isSlopeUnsafe

  // Cálculo de tiempo al ocaso (horas hasta pérdida de sol)
  const timeToSunsetHours = useMemo(() => {
    const curIdx = Math.floor(currentHour / 2)
    for (let i = curIdx; i < timelinePoints.length; i++) {
      if (!timelinePoints[i].sunClear) {
        return Math.max(0, (i - curIdx) * 2)
      }
    }
    return 336 - currentHour
  }, [currentHour, timelinePoints])

  // Cálculo de tiempo hasta pérdida de enlace terrestre
  const timeToEarthsetHours = useMemo(() => {
    const curIdx = Math.floor(currentHour / 2)
    for (let i = curIdx; i < timelinePoints.length; i++) {
      if (!timelinePoints[i].earthClear) {
        return Math.max(0, (i - curIdx) * 2)
      }
    }
    return 336 - currentHour
  }, [currentHour, timelinePoints])

  // Pantalla completa
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      rootRef.current?.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }

  const activeSiteName =
    TACTICAL_SITES.find(s => s.id === selectedSiteId)?.name || 'Custom Offset Coordinate'

  return (
    <div className="tactical-cockpit-root" ref={rootRef}>
      {/* ====================================================================
          TOP TACTICAL BAR
          ==================================================================== */}
      <header className="tactical-topbar">
        <div className="topbar-left">
          <div className="topbar-brand">
            <span className="brand-dot" />
            <span>APEX // LUNAR ORACLE</span>
          </div>
          <span className="topbar-subhead">PANEL DE CONTROL TÁCTICO · POLO SUR LUNAR</span>
        </div>

        <div className="topbar-center">
          <div className="topbar-clock">
            <Clock size={12} className="clock-label" />
            <span className="clock-label">UTC SIMULADO:</span>
            <strong>{currentSimDate}</strong>
          </div>
          <div className="topbar-clock">
            <span className="clock-label">MISIÓN:</span>
            <strong>T+ {currentHour.toFixed(1)} h (Día {(currentHour / 24).toFixed(1)})</strong>
          </div>
        </div>

        <div className="topbar-right">
          <button
            className={`view-preset-btn ${cameraView === 'orbit' ? 'active' : ''}`}
            onClick={() => setCameraView('orbit')}
            title="Vista orbital en 3ra persona"
          >
            3RD PERSON
          </button>
          <button
            className={`view-preset-btn ${cameraView === 'mast' ? 'active' : ''}`}
            onClick={() => setCameraView('mast')}
            title="Vista subjetiva desde el mástil del módulo"
          >
            MAST POV
          </button>
          <button
            className={`view-preset-btn ${cameraView === 'top' ? 'active' : ''}`}
            onClick={() => setCameraView('top')}
            title="Vista cenital táctica"
          >
            TOP-DOWN
          </button>
          <button className="view-preset-btn" onClick={toggleFullscreen} title="Pantalla completa">
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          {onOpenScientific && (
            <button className="view-preset-btn" onClick={onOpenScientific} title="Ver inventario de fuentes NASA">
              <Database size={11} style={{ marginRight: 4 }} />
              EVIDENCIA NASA
            </button>
          )}
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE (SPLIT: SIDEBAR CONTROLS + 3D VIEWPORT)
          ==================================================================== */}
      <div className="tactical-workspace">
        {/* SIDEBAR DE ENTRADAS Y KPIS */}
        <aside className="tactical-sidebar">
          {/* BANNER DINÁMICO DE ESTADO DE SUPERVIVENCIA */}
          <div className="tactical-block" style={{ paddingBottom: 10 }}>
            <div className={`tactical-status-banner ${isMissionSafe ? 'status-green' : 'status-red'}`}>
              <span className="status-icon">
                {isMissionSafe ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
              </span>
              <div>
                <div className="status-title">
                  {isMissionSafe ? 'SUPERVIVENCIA ASEGURADA' : 'ALERTA: FALLA CRÍTICA'}
                </div>
                <div className="status-desc">
                  {isMissionSafe ? (
                    'Rayo solar y enlace a Tierra despejados sobre el relieve. Pendiente dentro de límites.'
                  ) : isSunOccluded ? (
                    `Pérdida de energía por sombra topográfica montañosa (Margen: ${sunRaycast.marginDeg.toFixed(1)}°).`
                  ) : isEarthBlocked ? (
                    'Línea de visión a la Tierra bloqueada por el relieve. Pérdida total de telemetría.'
                  ) : (
                    `Pendiente de ${currentTerrain.slopeDeg}° supera el límite de seguridad de ${maxSlopeDeg}°. Riesgo de vuelco.`
                  )}
                </div>
              </div>
            </div>

            {/* KPIS RÁPIDOS */}
            <div className="kpi-grid-tactical">
              <div className="kpi-cell">
                <span className="kpi-cell-label">
                  <Sun size={10} color="#ffd32a" /> ELEVACIÓN SOLAR
                </span>
                <div className="kpi-cell-value">
                  {currentEphem.sunElevationDeg.toFixed(2)}°
                </div>
                <div className={`kpi-cell-sub ${isSunOccluded ? 'text-red' : 'text-green'}`}>
                  {isSunOccluded ? '● BLOQUEO ENERGÍA' : '● GENERANDO'}
                </div>
              </div>

              <div className="kpi-cell">
                <span className="kpi-cell-label">
                  <Globe2 size={10} color="#00d2d3" /> LÍNEA A TIERRA
                </span>
                <div className="kpi-cell-value">
                  {currentEphem.earthElevationDeg.toFixed(2)}°
                </div>
                <div className={`kpi-cell-sub ${isEarthBlocked ? 'text-red' : 'text-green'}`}>
                  {isEarthBlocked ? '● CORTE SEÑAL' : '● ENLACE DIRECTO'}
                </div>
              </div>

              <div className="kpi-cell">
                <span className="kpi-cell-label">TIEMPO AL OCASO</span>
                <div className="kpi-cell-value">
                  {timeToSunsetHours >= 336 ? '> 14 d' : `${timeToSunsetHours} h`}
                </div>
                <div className="kpi-cell-sub text-amber">
                  {timeToSunsetHours <= 6 ? '⚠️ OCASO INMINENTE' : 'Luz continua'}
                </div>
              </div>

              <div className="kpi-cell">
                <span className="kpi-cell-label">TIEMPO A EARTHSET</span>
                <div className="kpi-cell-value">
                  {timeToEarthsetHours >= 336 ? '> 14 d' : `${timeToEarthsetHours} h`}
                </div>
                <div className="kpi-cell-sub text-amber">
                  {timeToEarthsetHours <= 6 ? '⚠️ CORTE INMINENTE' : 'Enlace estable'}
                </div>
              </div>

              <div className="kpi-cell" style={{ gridColumn: 'span 2' }}>
                <span className="kpi-cell-label">PENDIENTE LOCAL (DESNIVEL)</span>
                <div className="kpi-cell-value">{currentTerrain.slopeDeg}°</div>
                <div className={`kpi-cell-sub ${isSlopeUnsafe ? 'text-red' : 'text-green'}`}>
                  {isSlopeUnsafe ? `● RIESGO VUELCO (> ${maxSlopeDeg}°)` : `● ESTABLE (< ${maxSlopeDeg}°)`}
                </div>
              </div>
            </div>
          </div>

          {/* ================================================================
              BLOQUE 1: EL SELECTOR DE ESPACIO (DÓNDE)
              ================================================================ */}
          <div className="tactical-block">
            <div className="tactical-block-title">
              <span className="block-title-text">
                <span className="block-number">01</span> ESPACIO // COORDENADAS
              </span>
              <MapPin size={12} color="#48dbfb" />
            </div>

            <div className="tactical-field-group">
              <label className="tactical-label">
                <span>SITIO CANDIDATO CLAVE</span>
              </label>
              <select
                className="tactical-select"
                value={selectedSiteId}
                onChange={e => handlePresetChange(e.target.value)}
              >
                {TACTICAL_SITES.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="custom">── Coordenada personalizada ──</option>
              </select>

              {/* Coordenadas libres */}
              <div className="coords-row">
                <div className="coord-box">
                  <span className="tactical-label">LATITUD (°S)</span>
                  <div className="coord-numpad">
                    <input
                      type="number"
                      step="0.005"
                      className="tactical-input"
                      value={latDeg}
                      onChange={e => {
                        setLatDeg(Number(e.target.value))
                        setSelectedSiteId('custom')
                      }}
                    />
                    <button
                      className="step-btn"
                      onClick={() => setLatDeg(prev => Number((prev - 0.005).toFixed(4)))}
                      title="-150 m al Sur"
                    >
                      -S
                    </button>
                    <button
                      className="step-btn"
                      onClick={() => setLatDeg(prev => Number((prev + 0.005).toFixed(4)))}
                      title="+150 m al Norte"
                    >
                      +N
                    </button>
                  </div>
                </div>

                <div className="coord-box">
                  <span className="tactical-label">LONGITUD (°E)</span>
                  <div className="coord-numpad">
                    <input
                      type="number"
                      step="0.02"
                      className="tactical-input"
                      value={lonDeg}
                      onChange={e => {
                        setLonDeg(Number(e.target.value))
                        setSelectedSiteId('custom')
                      }}
                    />
                    <button
                      className="step-btn"
                      onClick={() => setLonDeg(prev => Number((prev - 0.05).toFixed(4)))}
                      title="Oeste"
                    >
                      -W
                    </button>
                    <button
                      className="step-btn"
                      onClick={() => setLonDeg(prev => Number((prev + 0.05).toFixed(4)))}
                      title="Este"
                    >
                      +E
                    </button>
                  </div>
                </div>
              </div>

              {/* Botón de Rescate en 1 click para demostrar el flujo */}
              {isSunOccluded && (
                <button
                  className="quick-action-btn"
                  onClick={handleRescueShift}
                  title="Desplaza el módulo 2 km hacia la cresta elevada este para librar la sombra"
                >
                  <Sparkles size={12} />
                  <span>REUBICAR +2.0 KM ESTE (CRESTA SEGURA)</span>
                </button>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#747d8c', fontFamily: 'monospace', marginTop: 4 }}>
                <span>Elevación LOLA: {currentTerrain.elevationM} m</span>
                <span>Pendiente: {currentTerrain.slopeDeg}°</span>
              </div>
            </div>
          </div>

          {/* ================================================================
              BLOQUE 2: EL SELECTOR DE TIEMPO (CUÁNDO)
              ================================================================ */}
          <div className="tactical-block">
            <div className="tactical-block-title">
              <span className="block-title-text">
                <span className="block-number">02</span> TIEMPO // CRONOGRAMA
              </span>
              <Clock size={12} color="#48dbfb" />
            </div>

            <div className="tactical-field-group">
              <label className="tactical-label">
                <span>FECHA Y HORA DE ALUNIZAJE (UTC)</span>
              </label>
              <input
                type="datetime-local"
                className="tactical-input"
                value={startUtc}
                onChange={e => {
                  setStartUtc(e.target.value)
                  setDelayDays(0)
                  setCurrentHour(0)
                }}
              />

              {/* Escenarios de prueba rápida */}
              <div className="tactical-label" style={{ marginTop: 4 }}>
                <span>ESCENARIOS DE RETRASO (PRUEBA RÁPIDA)</span>
              </div>
              <div className="delay-pills">
                <button
                  className={`delay-pill ${delayDays === 0 ? 'active-base' : ''}`}
                  onClick={() => applyDelayScenario(0)}
                  title="Plan original: 14 Nov 09:00 UTC"
                >
                  14 NOV (BASE)
                </button>
                <button
                  className={`delay-pill ${delayDays === 6 ? 'active' : ''}`}
                  onClick={() => applyDelayScenario(6)}
                  title="Simula fallo de válvula: lanzamiento retrasado 6 días"
                >
                  +6D (20 NOV ⚠️)
                </button>
                <button
                  className={`delay-pill ${delayDays === 12 ? 'active' : ''}`}
                  onClick={() => applyDelayScenario(12)}
                  title="Retraso de 12 días"
                >
                  +12D (26 NOV)
                </button>
              </div>

              {delayDays === 6 && (
                <div style={{ fontSize: 9, color: '#ff6b81', fontFamily: 'monospace', marginTop: 4, lineHeight: 1.4 }}>
                  ⚠️ RETRASO DE 6 DÍAS APLICADO: El Sol cambia de azimut y choca con el macizo montañoso.
                </div>
              )}
            </div>
          </div>

          {/* ================================================================
              BLOQUE 3: LOS UMBRALES CRÍTICOS (HARDWARE)
              ================================================================ */}
          <div className="tactical-block" style={{ borderBottom: 'none' }}>
            <div className="tactical-block-title">
              <span className="block-title-text">
                <span className="block-number">03</span> UMBRALES DE HARDWARE
              </span>
              <Layers size={12} color="#48dbfb" />
            </div>

            <div className="tactical-field-group">
              <label className="tactical-label">
                <span>ELEVACIÓN SOLAR MÍNIMA</span>
                <strong>{minSolarElevation.toFixed(1)}°</strong>
              </label>
              <input
                type="range"
                min="0.5"
                max="5.0"
                step="0.1"
                className="tactical-slider"
                value={minSolarElevation}
                onChange={e => setMinSolarElevation(Number(e.target.value))}
              />
              <span style={{ fontSize: 9, color: '#747d8c' }}>
                Paneles solares pierden capacidad de recarga por debajo de este ángulo.
              </span>

              <label className="tactical-label" style={{ marginTop: 10 }}>
                <span>PENDIENTE MÁXIMA DE ALUNIZAJE</span>
                <strong>{maxSlopeDeg.toFixed(1)}°</strong>
              </label>
              <input
                type="range"
                min="5.0"
                max="25.0"
                step="0.5"
                className="tactical-slider"
                value={maxSlopeDeg}
                onChange={e => setMaxSlopeDeg(Number(e.target.value))}
              />
              <span style={{ fontSize: 9, color: '#747d8c' }}>
                Superar este límite genera riesgo de volcado del módulo al contacto.
              </span>
            </div>
          </div>
        </aside>

        {/* VIEWPORT 3D CENTRAL */}
        <main className="tactical-viewport-wrap">
          <Tactical3DScene
            latDeg={latDeg}
            lonDeg={lonDeg}
            observerHeightM={2.0}
            sunAzimuthDeg={currentEphem.sunAzimuthDeg}
            sunElevationDeg={currentEphem.sunElevationDeg}
            earthAzimuthDeg={currentEphem.earthAzimuthDeg}
            earthElevationDeg={currentEphem.earthElevationDeg}
            minSolarElevation={minSolarElevation}
            maxSlopeDeg={maxSlopeDeg}
            currentSlopeDeg={currentTerrain.slopeDeg}
            atlasData={atlasData}
            sunRaycast={sunRaycast}
            earthRaycast={earthRaycast}
            cameraView={cameraView}
            siteName={activeSiteName}
          />
        </main>
      </div>

      {/* ====================================================================
          BOTTOM SCRUBBER (TIME SELECTION SLIDER · 14 DÍAS)
          ==================================================================== */}
      <footer className="tactical-scrubber-bar">
        <div className="scrubber-header">
          <div className="scrubber-title">
            <button
              className="scrubber-play-btn"
              onClick={() => setIsPlaying(v => !v)}
              title={isPlaying ? 'Pausar simulación' : 'Reproducir avance de 14 días'}
            >
              {isPlaying ? <Pause size={10} /> : <Play size={10} />}
            </button>
            <span>LÍNEA DE TIEMPO DE MISIÓN (14 DÍAS CONTINUOS · T+ {currentHour} H)</span>
          </div>

          <div className="scrubber-legend">
            <span className="legend-item">
              <span className="legend-color sun" /> Sol
            </span>
            <span className="legend-item">
              <span className="legend-color earth" /> Tierra
            </span>
            <span className="legend-item">
              <span className="legend-color hazard" /> Zona Sombra / Bloqueo
            </span>
          </div>
        </div>

        {/* Timeline Slider con minicurvas SVG integradas */}
        <div className="scrubber-timeline-wrap">
          {/* Mini Curva SVG de fondo */}
          <svg className="scrubber-mini-svg" viewBox="0 0 1000 36" preserveAspectRatio="none">
            {/* Zero line */}
            <line x1="0" y1="28" x2="1000" y2="28" stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />

            {/* Solar Elevation Path */}
            <path
              d={timelinePoints
                .map((p, i) => {
                  const x = (i / (timelinePoints.length - 1)) * 1000
                  const y = Math.max(2, Math.min(34, 28 - p.sunElevationDeg * 7))
                  return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(' ')}
              fill="none"
              stroke="#ffd32a"
              strokeWidth="1.8"
            />

            {/* Earth Elevation Path */}
            <path
              d={timelinePoints
                .map((p, i) => {
                  const x = (i / (timelinePoints.length - 1)) * 1000
                  const y = Math.max(2, Math.min(34, 28 - p.earthElevationDeg * 2.5))
                  return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
                })
                .join(' ')}
              fill="none"
              stroke="#00d2d3"
              strokeWidth="1.4"
              strokeDasharray="4 2"
            />

            {/* Obstacle Shadow blocks */}
            {timelinePoints.map((p, i) => {
              if (p.sunClear) return null
              const x = (i / (timelinePoints.length - 1)) * 1000
              const w = 1000 / timelinePoints.length
              return (
                <rect
                  key={i}
                  x={x}
                  y="0"
                  width={w}
                  height="36"
                  fill="rgba(255, 71, 87, 0.22)"
                />
              )
            })}
          </svg>

          {/* Aguja de posición actual */}
          <div
            className="scrubber-needle"
            style={{ left: `${(currentHour / 336) * 100}%` }}
          />

          {/* Input Range transparente superpuesto para arrastrar */}
          <input
            type="range"
            min="0"
            max="336"
            step="1"
            className="scrubber-slider-input"
            value={currentHour}
            onChange={e => setCurrentHour(Number(e.target.value))}
          />

          {/* Marcadores de Días */}
          <div className="scrubber-ticks">
            <span>DÍA 0</span>
            <span>DÍA 2</span>
            <span>DÍA 4</span>
            <span>DÍA 6</span>
            <span>DÍA 8</span>
            <span>DÍA 10</span>
            <span>DÍA 12</span>
            <span>DÍA 14 (336 H)</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
