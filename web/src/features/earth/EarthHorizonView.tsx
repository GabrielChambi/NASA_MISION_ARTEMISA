import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Code2, Compass, Eye, Layers, Pause, Play, RotateCcw } from 'lucide-react'
import { buildEarth3DSceneBundle } from './EarthApiClient'
import { useMissionContext } from './MissionContext'

type ViewMode = '3d-interactive' | '2d-polar-xy'
type LolaSurfaceLayer = 'elevation' | 'slope' | 'uncertainty'

export function EarthHorizonView() {
  const { earthData, compareData, selectedSampleIndex, setSelectedSampleIndex } = useMissionContext()
  const [viewMode, setViewMode] = useState<ViewMode>('3d-interactive')
  const [surfaceLayer, setSurfaceLayer] = useState<LolaSurfaceLayer>('elevation')
  const [playing, setPlaying] = useState<boolean>(false)
  const [yawDeg, setYawDeg] = useState<number>(-38)
  const [pitchDeg, setPitchDeg] = useState<number>(26)
  const [zoom, setZoom] = useState<number>(1.08)
  const [verticalExag, setVerticalExag] = useState<number>(3.0)
  const [show3DJson, setShow3DJson] = useState<boolean>(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  })

  const sampleCount = earthData?.samples.length ?? 0

  useEffect(() => {
    if (!playing || sampleCount <= 1) return
    const timer = window.setInterval(() => {
      setSelectedSampleIndex(prev => (prev + 1) % sampleCount)
    }, 350)
    return () => window.clearInterval(timer)
  }, [playing, sampleCount, setSelectedSampleIndex])

  const bundle3D = useMemo(() => {
    if (!earthData) return null
    return buildEarth3DSceneBundle(earthData, compareData, selectedSampleIndex)
  }, [earthData, compareData, selectedSampleIndex])

  // Render interactive 3D Lunar South Pole LOLA terrain + Sky Dome + Earth/Sun ENU vectors on Canvas
  useEffect(() => {
    if (viewMode !== '3d-interactive' || !bundle3D || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth || 560
    const height = canvas.clientHeight || 360
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
    }
    ctx.save()
    ctx.scale(dpr, dpr)

    // Deep space background gradient
    const bg = ctx.createRadialGradient(width * 0.5, height * 0.35, 20, width * 0.5, height * 0.5, width * 0.75)
    bg.addColorStop(0, '#162733')
    bg.addColorStop(0.6, '#0d1820')
    bg.addColorStop(1, '#070e14')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)

    const yaw = (yawDeg * Math.PI) / 180
    const pitch = (pitchDeg * Math.PI) / 180
    const cosY = Math.cos(yaw)
    const sinY = Math.sin(yaw)
    const cosP = Math.cos(pitch)
    const sinP = Math.sin(pitch)

    const cx = width * 0.52
    const cy = height * 0.52
    const scale = Math.min(width, height) * 0.33 * zoom

    function project3D(x: number, y: number, z: number): { sx: number; sy: number; depth: number } {
      const rx = x * cosY - y * sinY
      const ry = x * sinY + y * cosY
      const rz = z
      const py = ry * cosP - rz * sinP
      const pz = ry * sinP + rz * cosP
      const perspective = 3.2 / (3.2 + py * 0.45)
      return {
        sx: cx + rx * scale * perspective,
        sy: cy - pz * scale * perspective,
        depth: py,
      }
    }

    // 1. Draw LRO-LOLA 5m/pix 3D Lunar Terrain Mesh (colored by Elevation, Slope, or Uncertainty)
    const mesh = bundle3D.terrainMesh3D
    if (mesh && mesh.elevation_grid_m.length > 1) {
      const N = mesh.grid_size
      const grid = mesh.elevation_grid_m
      const slopeGrid = mesh.slope_grid_deg
      const uncGrid = mesh.uncertainty_grid_m
      const zCenter = mesh.center_elevation_m
      const halfSpan = (N - 1) / 2

      const quads: Array<{
        pts: Array<{ sx: number; sy: number }>
        depth: number
        elevRel: number
        slopeDeg: number
        uncM: number
      }> = []

      for (let r = 0; r < N - 1; r++) {
        for (let c = 0; c < N - 1; c++) {
          const x0 = ((c - halfSpan) / halfSpan) * 0.78
          const x1 = ((c + 1 - halfSpan) / halfSpan) * 0.78
          const y0 = ((halfSpan - r) / halfSpan) * 0.78
          const y1 = ((halfSpan - (r + 1)) / halfSpan) * 0.78

          const z00 = ((grid[r][c] - zCenter) / 500.0) * 0.22 * verticalExag
          const z10 = ((grid[r][c + 1] - zCenter) / 500.0) * 0.22 * verticalExag
          const z11 = ((grid[r + 1][c + 1] - zCenter) / 500.0) * 0.22 * verticalExag
          const z01 = ((grid[r + 1][c] - zCenter) / 500.0) * 0.22 * verticalExag

          const p00 = project3D(x0, y0, z00)
          const p10 = project3D(x1, y0, z10)
          const p11 = project3D(x1, y1, z11)
          const p01 = project3D(x0, y1, z01)

          const avgDepth = (p00.depth + p10.depth + p11.depth + p01.depth) * 0.25
          const avgElev = (grid[r][c] + grid[r][c + 1] + grid[r + 1][c + 1] + grid[r + 1][c]) * 0.25 - zCenter
          const avgSlope = slopeGrid
            ? (slopeGrid[r][c] + slopeGrid[r][c + 1] + slopeGrid[r + 1][c + 1] + slopeGrid[r + 1][c]) * 0.25
            : 5.0
          const avgUnc = uncGrid
            ? (uncGrid[r][c] + uncGrid[r][c + 1] + uncGrid[r + 1][c + 1] + uncGrid[r + 1][c]) * 0.25
            : 0.3

          quads.push({
            pts: [p00, p10, p11, p01],
            depth: avgDepth,
            elevRel: avgElev,
            slopeDeg: avgSlope,
            uncM: avgUnc,
          })
        }
      }

      quads.sort((a, b) => b.depth - a.depth)
      for (const q of quads) {
        let fillStyle = 'rgba(90, 110, 118, 0.68)'
        if (surfaceLayer === 'elevation') {
          const shade = Math.max(0.18, Math.min(0.88, 0.52 + q.elevRel / 260))
          const rCol = Math.round(45 + shade * 85)
          const gCol = Math.round(62 + shade * 95)
          const bCol = Math.round(70 + shade * 92)
          fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.68)`
        } else if (surfaceLayer === 'slope') {
          // Green (<7 deg safe), Gold (7-15 deg moderate), Coral (>15 deg steep crater wall)
          if (q.slopeDeg < 7) {
            fillStyle = 'rgba(92, 178, 138, 0.72)'
          } else if (q.slopeDeg < 15) {
            fillStyle = 'rgba(214, 182, 110, 0.72)'
          } else {
            fillStyle = 'rgba(214, 108, 92, 0.74)'
          }
        } else {
          // Uncertainty map (RMS Z error in meters: 0.1m low -> cyan, >0.45m high -> purple/amber)
          const t = Math.max(0, Math.min(1, (q.uncM - 0.1) / 0.5))
          const rCol = Math.round(60 + t * 165)
          const gCol = Math.round(165 - t * 60)
          const bCol = Math.round(195 - t * 80)
          fillStyle = `rgba(${rCol}, ${gCol}, ${bCol}, 0.72)`
        }

        ctx.beginPath()
        ctx.moveTo(q.pts[0].sx, q.pts[0].sy)
        ctx.lineTo(q.pts[1].sx, q.pts[1].sy)
        ctx.lineTo(q.pts[2].sx, q.pts[2].sy)
        ctx.lineTo(q.pts[3].sx, q.pts[3].sy)
        ctx.closePath()
        ctx.fillStyle = fillStyle
        ctx.fill()
        ctx.strokeStyle = 'rgba(190, 217, 187, 0.22)'
        ctx.lineWidth = 0.65
        ctx.stroke()
      }
    }

    // 2. Draw 3D Sky-Dome Wireframe Arcs & Compass Horizon Ring
    const domeRadius = 1.05
    ctx.strokeStyle = 'rgba(166, 198, 210, 0.13)'
    ctx.lineWidth = 0.8
    for (const elRing of [15, 30, 60]) {
      const elRad = (elRing * Math.PI) / 180
      ctx.beginPath()
      for (let az = 0; az <= 360; az += 10) {
        const azRad = (az * Math.PI) / 180
        const x = domeRadius * Math.cos(elRad) * Math.sin(azRad)
        const y = domeRadius * Math.cos(elRad) * Math.cos(azRad)
        const z = domeRadius * Math.sin(elRad) * 1.4
        const p = project3D(x, y, z)
        if (az === 0) ctx.moveTo(p.sx, p.sy)
        else ctx.lineTo(p.sx, p.sy)
      }
      ctx.stroke()
    }

    // Local 0-deg Horizon Ring
    ctx.beginPath()
    for (let az = 0; az <= 360; az += 5) {
      const azRad = (az * Math.PI) / 180
      const p = project3D(domeRadius * Math.sin(azRad), domeRadius * Math.cos(azRad), 0)
      if (az === 0) ctx.moveTo(p.sx, p.sy)
      else ctx.lineTo(p.sx, p.sy)
    }
    ctx.strokeStyle = 'rgba(190, 217, 187, 0.55)'
    ctx.lineWidth = 1.4
    ctx.stroke()

    ctx.font = '600 10px "IBM Plex Mono", monospace'
    ctx.fillStyle = '#bed9bb'
    const cardinals: Array<{ label: string; x: number; y: number }> = [
      { label: 'N (0°)', x: 0, y: domeRadius * 1.08 },
      { label: 'E (90°)', x: domeRadius * 1.08, y: 0 },
      { label: 'S (180°)', x: 0, y: -domeRadius * 1.08 },
      { label: 'W (270°)', x: -domeRadius * 1.08, y: 0 },
    ]
    for (const c of cardinals) {
      const cp = project3D(c.x, c.y, 0.02)
      ctx.fillText(c.label, cp.sx - 18, cp.sy + 3)
    }

    // 3. Draw Earth Trajectory Arc in 3D Sky
    function skyPosFromAzEl(azDeg: number, elDeg: number, r = domeRadius) {
      const azRad = (azDeg * Math.PI) / 180
      const elScaledRad = (Math.max(-35, Math.min(65, elDeg * 4.5)) * Math.PI) / 180
      return {
        x: r * Math.cos(elScaledRad) * Math.sin(azRad),
        y: r * Math.cos(elScaledRad) * Math.cos(azRad),
        z: r * Math.sin(elScaledRad),
      }
    }

    if (bundle3D.trajectory3D.length > 1) {
      for (let i = 0; i < bundle3D.trajectory3D.length - 1; i++) {
        const a = bundle3D.trajectory3D[i]
        const b = bundle3D.trajectory3D[i + 1]
        const pa = skyPosFromAzEl(a.azimuthDeg, a.elevationDeg)
        const pb = skyPosFromAzEl(b.azimuthDeg, b.elevationDeg)
        const p1 = project3D(pa.x, pa.y, pa.z)
        const p2 = project3D(pb.x, pb.y, pb.z)
        ctx.beginPath()
        ctx.moveTo(p1.sx, p1.sy)
        ctx.lineTo(p2.sx, p2.sy)
        ctx.strokeStyle = a.visible ? '#7fd4b8' : 'rgba(214, 197, 154, 0.55)'
        ctx.lineWidth = 2.2
        ctx.stroke()
      }
    }

    // 4. Draw Sun Vector & 3D Sun Orb
    const originP = project3D(0, 0, 0.03)
    if (bundle3D.sunState.azimuthDeg !== null && bundle3D.sunState.elevationDeg !== null) {
      const sunSky = skyPosFromAzEl(bundle3D.sunState.azimuthDeg, bundle3D.sunState.elevationDeg, domeRadius * 0.98)
      const sunP = project3D(sunSky.x, sunSky.y, sunSky.z)

      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(originP.sx, originP.sy)
      ctx.lineTo(sunP.sx, sunP.sy)
      ctx.strokeStyle = 'rgba(244, 213, 141, 0.45)'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(sunP.sx, sunP.sy, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#f5d47a'
      ctx.fill()
      ctx.fillStyle = '#f5d47a'
      ctx.font = '500 9px "IBM Plex Mono", monospace'
      ctx.fillText(`SUN (${bundle3D.sunState.elevationDeg.toFixed(1)}°)`, sunP.sx + 10, sunP.sy + 3)
    }

    // 5. Draw 3D Line-of-Sight Ray from Lunar Lander to Earth Center
    const earthSky = skyPosFromAzEl(bundle3D.earthState.azimuthDeg, bundle3D.earthState.elevationDeg)
    const earthP = project3D(earthSky.x, earthSky.y, earthSky.z)

    ctx.save()
    if (!bundle3D.earthState.visible) {
      ctx.setLineDash([5, 5])
    }
    ctx.beginPath()
    ctx.moveTo(originP.sx, originP.sy)
    ctx.lineTo(earthP.sx, earthP.sy)
    ctx.strokeStyle = bundle3D.earthState.visible ? '#84f0c6' : '#e0a96d'
    ctx.lineWidth = 2.4
    ctx.stroke()
    ctx.restore()

    // 6. Draw Lunar Lander Beacon at ROI Center (0,0,0)
    ctx.beginPath()
    ctx.arc(originP.sx, originP.sy, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = '#bed9bb'
    ctx.fill()
    ctx.strokeStyle = '#10171b'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.font = '600 9px "IBM Plex Mono", monospace'
    ctx.fillStyle = '#e5e8e6'
    ctx.fillText(`${bundle3D.siteId.toUpperCase()} LANDER`, originP.sx + 9, originP.sy - 5)

    // 7. Draw 3D Earth Sphere at Current Sample Position
    const earthGrad = ctx.createRadialGradient(earthP.sx - 3, earthP.sy - 3, 2, earthP.sx, earthP.sy, 11)
    if (bundle3D.earthState.visible) {
      earthGrad.addColorStop(0, '#b5f2ff')
      earthGrad.addColorStop(0.55, '#3b9be0')
      earthGrad.addColorStop(1, '#15446b')
    } else {
      earthGrad.addColorStop(0, '#ebd2ae')
      earthGrad.addColorStop(0.6, '#b07b46')
      earthGrad.addColorStop(1, '#4f3218')
    }
    ctx.beginPath()
    ctx.arc(earthP.sx, earthP.sy, 10, 0, Math.PI * 2)
    ctx.fillStyle = earthGrad
    ctx.fill()
    ctx.strokeStyle = bundle3D.earthState.visible ? '#98f5d2' : '#d6c59a'
    ctx.lineWidth = 1.8
    ctx.stroke()

    ctx.font = '600 10px "IBM Plex Mono", monospace'
    ctx.fillStyle = bundle3D.earthState.visible ? '#98f5d2' : '#e6c594'
    ctx.fillText(
      `EARTH (${bundle3D.earthState.elevationDeg >= 0 ? '+' : ''}${bundle3D.earthState.elevationDeg.toFixed(2)}°)`,
      earthP.sx + 13,
      earthP.sy - 2
    )
    ctx.font = '400 9px "IBM Plex Mono", monospace'
    ctx.fillStyle = '#b4c6ce'
    ctx.fillText(
      bundle3D.earthState.visible ? 'LoS VISIBLE' : 'BELOW HORIZON (BLACKOUT)',
      earthP.sx + 13,
      earthP.sy + 10
    )

    // 8. HUD Overlay inside 3D Canvas
    const layerLabel =
      surfaceLayer === 'elevation'
        ? `LOLA 5m/px Elev (Center ${mesh?.center_elevation_m ?? 0}m)`
        : surfaceLayer === 'slope'
        ? `LOLA Slope Map (Center ${mesh?.center_slope_deg ?? 0}° | Mean ${mesh?.mean_slope_deg ?? 0}°)`
        : `LOLA RMS Z Uncertainty (Center ±${mesh?.center_uncertainty_m ?? 0}m)`

    ctx.fillStyle = 'rgba(13, 24, 32, 0.85)'
    ctx.fillRect(12, 12, 295, 76)
    ctx.strokeStyle = 'rgba(181, 203, 209, 0.25)'
    ctx.strokeRect(12, 12, 295, 76)
    ctx.fillStyle = '#bed9bb'
    ctx.font = '600 9px "IBM Plex Mono", monospace'
    ctx.fillText(`3D LUNAR TOPOCENTRIC SCENE · ${bundle3D.siteName.toUpperCase()}`, 20, 26)
    ctx.fillStyle = '#d8e2e6'
    ctx.font = '400 9px "IBM Plex Mono", monospace'
    ctx.fillText(`UTC: ${bundle3D.timestampUtc} | Range: ${bundle3D.earthState.rangeKm.toLocaleString()} km`, 20, 41)
    ctx.fillText(
      `ENU Vector: [${bundle3D.earthState.enuUnitVector.map(v => v.toFixed(3)).join(', ')}]`,
      20,
      56
    )
    ctx.fillStyle = '#98ebd0'
    ctx.fillText(`Layer: ${layerLabel}`, 20, 71)

    ctx.restore()
  }, [viewMode, bundle3D, yawDeg, pitchDeg, zoom, verticalExag, surfaceLayer])

  if (!earthData || !bundle3D) {
    return (
      <div className="panel b-horizon-panel">
        <div className="panel-heading">
          <h2>Earth Horizon & 3D Sky-Dome</h2>
        </div>
        <div className="b-empty-state">Loading JPL Horizons topocentric geometry...</div>
      </div>
    )
  }

  const currentSample = earthData.samples[Math.min(selectedSampleIndex, earthData.samples.length - 1)]

  return (
    <div className="panel b-horizon-panel" aria-label="Earth Horizon and 3D Line-of-Sight View">
      <div className="panel-heading">
        <h2>
          <Compass size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Earth Horizon & 3D Lunar Surface LoS Dome
        </h2>
        <div className="b-view-tabs" role="tablist" aria-label="Horizon visualization mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === '3d-interactive'}
            className={`b-tab-btn ${viewMode === '3d-interactive' ? 'active' : ''}`}
            onClick={() => setViewMode('3d-interactive')}
          >
            <Box size={12} /> 3D Lunar Terrain + LoS Ray
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === '2d-polar-xy'}
            className={`b-tab-btn ${viewMode === '2d-polar-xy' ? 'active' : ''}`}
            onClick={() => setViewMode('2d-polar-xy')}
          >
            <Eye size={12} /> 2D Polar & Az/El Plot
          </button>
          <button
            type="button"
            className={`b-tab-btn ${show3DJson ? 'active' : ''}`}
            onClick={() => setShow3DJson(v => !v)}
            title="Inspect 3D ENU Scene Graph JSON for external 3D engines"
          >
            <Code2 size={12} /> 3D Scene JSON
          </button>
        </div>
      </div>

      {viewMode === '3d-interactive' ? (
        <div className="b-3d-container">
          {/* NASA LOLA 3D Surface Product Switcher */}
          <div className="b-3d-layer-bar" role="group" aria-label="NASA LRO-LOLA 3D surface data layer">
            <span className="eyebrow">
              <Layers size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              NASA GODDARD LRO-LOLA 3D LAYER:
            </span>
            <button
              type="button"
              className={`b-chip ${surfaceLayer === 'elevation' ? 'active' : ''}`}
              onClick={() => setSurfaceLayer('elevation')}
            >
              LOLA 5m/px Elevation (Z)
            </button>
            <button
              type="button"
              className={`b-chip ${surfaceLayer === 'slope' ? 'active' : ''}`}
              onClick={() => setSurfaceLayer('slope')}
            >
              LOLA Slope Map (°)
            </button>
            <button
              type="button"
              className={`b-chip ${surfaceLayer === 'uncertainty' ? 'active' : ''}`}
              onClick={() => setSurfaceLayer('uncertainty')}
            >
              LOLA Uncertainty Map (±RMS Z)
            </button>
          </div>

          <canvas
            ref={canvasRef}
            className="b-3d-canvas"
            aria-label="Interactive 3D Lunar South Pole LRO-LOLA terrain and Earth line-of-sight dome"
            onPointerDown={e => {
              dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
            }}
            onPointerMove={e => {
              if (!dragRef.current.active) return
              const dx = e.clientX - dragRef.current.lastX
              const dy = e.clientY - dragRef.current.lastY
              dragRef.current.lastX = e.clientX
              dragRef.current.lastY = e.clientY
              setYawDeg(y => (y + dx * 0.6) % 360)
              setPitchDeg(p => Math.max(8, Math.min(78, p + dy * 0.45)))
            }}
            onPointerUp={() => {
              dragRef.current.active = false
            }}
            onPointerLeave={() => {
              dragRef.current.active = false
            }}
          />

          <div className="b-3d-toolbar">
            <button
              type="button"
              className="b-chip active"
              onClick={() => setPlaying(p => !p)}
              aria-label={playing ? 'Pause 3D ephemeris playback' : 'Play 3D ephemeris playback'}
            >
              {playing ? <Pause size={12} /> : <Play size={12} />}
              <span>{playing ? 'Pause' : 'Animate 3D Orbit'}</span>
            </button>

            <input
              type="range"
              className="b-scrubber"
              min={0}
              max={Math.max(0, earthData.samples.length - 1)}
              value={Math.min(selectedSampleIndex, Math.max(0, earthData.samples.length - 1))}
              onChange={e => {
                setPlaying(false)
                setSelectedSampleIndex(Number(e.target.value))
              }}
              aria-label="Scrub UTC sample timestamp in 3D view"
            />

            <span className="b-mono-readout">{currentSample?.t_utc.slice(5, 16).replace('T', ' ')}Z</span>

            <div className="b-3d-cam-controls">
              <button
                type="button"
                className="b-chip"
                onClick={() => setVerticalExag(v => (v === 1 ? 3 : v === 3 ? 5 : 1))}
                title="Toggle LRO-LOLA terrain vertical exaggeration"
              >
                Z-Scale {verticalExag}x
              </button>
              <button
                type="button"
                className="b-chip"
                onClick={() => setZoom(z => (z > 1.25 ? 0.9 : +(z + 0.18).toFixed(2)))}
              >
                Zoom {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="b-chip"
                onClick={() => {
                  setYawDeg(-38)
                  setPitchDeg(26)
                  setZoom(1.08)
                }}
                title="Reset 3D camera orientation"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="b-2d-polar-grid">
          <svg
            viewBox="0 0 260 240"
            className="b-polar-svg"
            role="img"
            aria-label="2D Polar Azimuth and Elevation sky chart"
          >
            <circle cx="130" cy="120" r="92" fill="#0c171f" stroke="#b5cbd133" strokeWidth="1" />
            <circle cx="130" cy="120" r="65" fill="none" stroke="#b5cbd124" strokeDasharray="3 3" />
            <circle cx="130" cy="120" r="35" fill="none" stroke="#b5cbd124" strokeDasharray="2 3" />
            <line x1="130" y1="22" x2="130" y2="218" stroke="#b5cbd122" />
            <line x1="32" y1="120" x2="228" y2="120" stroke="#b5cbd122" />
            <text x="125" y="17" fill="#bed9bb" fontSize="8" fontFamily="monospace">
              N 0°
            </text>
            <text x="231" y="123" fill="#9fb4bd" fontSize="8" fontFamily="monospace">
              E 90°
            </text>
            <text x="122" y="232" fill="#9fb4bd" fontSize="8" fontFamily="monospace">
              S 180°
            </text>
            <text x="4" y="123" fill="#9fb4bd" fontSize="8" fontFamily="monospace">
              W 270°
            </text>

            <circle cx="130" cy="120" r="65" fill="none" stroke="#bed9bb88" strokeWidth="1.2" />

            {earthData.samples.map((s, idx) => {
              const azRad = (s.azimuth_deg * Math.PI) / 180
              const r = 65 - s.elevation_deg * 3.2
              const x = 130 + r * Math.sin(azRad)
              const y = 120 - r * Math.cos(azRad)
              return (
                <circle
                  key={s.t_utc}
                  cx={x}
                  cy={y}
                  r={idx === selectedSampleIndex ? 4.5 : 1.6}
                  fill={s.earth_visible ? '#7fd4b8' : '#d6c59a'}
                  stroke={idx === selectedSampleIndex ? '#ffffff' : 'none'}
                  strokeWidth={1.2}
                />
              )
            })}
          </svg>

          <svg
            viewBox="0 0 280 240"
            className="b-polar-svg"
            role="img"
            aria-label="Azimuth vs Elevation trajectory chart with local horizon line"
          >
            <rect x="34" y="18" width="230" height="190" fill="#0c171f" stroke="#b5cbd133" />
            {(() => {
              const thresh = currentSample?.effective_threshold_deg ?? 0
              const yThresh = 113 - thresh * 10
              return (
                <>
                  <line
                    x1="34"
                    y1={yThresh}
                    x2="264"
                    y2={yThresh}
                    stroke="#bed9bb"
                    strokeWidth="1.3"
                    strokeDasharray="4 3"
                  />
                  <text x="38" y={yThresh - 5} fill="#bed9bb" fontSize="8" fontFamily="monospace">
                    Horizon + Clearance ({thresh.toFixed(1)}°)
                  </text>
                </>
              )
            })()}
            {earthData.samples.map((s, i) => {
              const x = 34 + ((s.azimuth_deg - 120) / 55) * 230
              const y = 113 - s.elevation_deg * 10
              return (
                <circle
                  key={s.t_utc}
                  cx={Math.max(36, Math.min(262, x))}
                  cy={Math.max(22, Math.min(204, y))}
                  r={i === selectedSampleIndex ? 4.5 : 2}
                  fill={s.earth_visible ? '#7fd4b8' : '#d6c59a'}
                />
              )
            })}
            <text x="95" y="226" fill="#9fb4bd" fontSize="8" fontFamily="monospace">
              Azimuth (120° – 175° SE)
            </text>
          </svg>
        </div>
      )}

      {show3DJson && (
        <div className="b-3d-json-drawer">
          <div className="b-3d-json-header">
            <span>3D ENGINE TELEMETRY PAYLOAD (East-North-Up Unit Vectors + LRO-LOLA 3D Surface Patch)</span>
            <span>Frame: MOON_ME / Topocentric ENU</span>
          </div>
          <pre>
            {JSON.stringify(
              {
                siteId: bundle3D.siteId,
                timestampUtc: bundle3D.timestampUtc,
                observerPositionM: bundle3D.observerPositionM,
                earthState: bundle3D.earthState,
                sunState: bundle3D.sunState,
                terrainMeshSummary: bundle3D.terrainMesh3D
                  ? {
                      gridSize: bundle3D.terrainMesh3D.grid_size,
                      spacingM: bundle3D.terrainMesh3D.spacing_m,
                      centerElevationM: bundle3D.terrainMesh3D.center_elevation_m,
                      centerSlopeDeg: bundle3D.terrainMesh3D.center_slope_deg,
                      meanSlopeDeg: bundle3D.terrainMesh3D.mean_slope_deg,
                      centerUncertaintyM: bundle3D.terrainMesh3D.center_uncertainty_m,
                      medianUncertaintyM: bundle3D.terrainMesh3D.median_uncertainty_m,
                      frame: bundle3D.terrainMesh3D.frame,
                    }
                  : null,
              },
              null,
              2
            )}
          </pre>
        </div>
      )}
    </div>
  )
}
