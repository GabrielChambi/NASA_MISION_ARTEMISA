import { useMission as useSharedMission } from '../mission/MissionContext'
import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  earthApiClient,
  type CompareResponse,
  type EarthResponse,
  type HorizonMode,
} from './EarthApiClient'

export interface MissionContextState {
  siteId: 'site01' | 'site04'
  startUtc: string
  endUtc: string
  durationHours: number
  stepMinutes: number
  horizonMode: HorizonMode
  clearanceDeg: number
  delayHours: number
  observerHeightM: number
  minimumSolarHours: number
  minimumEarthVisibleHours: number
  selectedSampleIndex: number
  earthData: EarthResponse | null
  compareData: CompareResponse | null
  loadingEarth: boolean
  loadingCompare: boolean
  errorMessage: string | null
  setSiteId: (siteId: 'site01' | 'site04') => void
  setStartUtcAndDuration: (startUtc: string, durationHours: number) => void
  setStepMinutes: (stepMinutes: number) => void
  setHorizonMode: (mode: HorizonMode) => void
  setClearanceDeg: (deg: number) => void
  setDelayHours: (hours: number) => void
  setObserverHeightM: (meters: number) => void
  setMinimumConstraints: (solarHours: number, earthHours: number) => void
  setSelectedSampleIndex: (idx: number | ((prev: number) => number)) => void
  refreshAll: () => void
}

const MissionContext = createContext<MissionContextState | null>(null)

function computeEndUtc(startUtc: string, durationHours: number): string {
  const ms = Date.parse(startUtc)
  if (Number.isNaN(ms)) return '2026-12-17T00:00:00Z'
  const endDt = new Date(ms + durationHours * 3600 * 1000)
  return endDt.toISOString().replace('.000Z', 'Z')
}

export function MissionProvider({
  initialSiteId = 'site04',
  onExternalSiteChange,
  children,
}: {
  initialSiteId?: 'site01' | 'site04'
  onExternalSiteChange?: (siteId: 'site01' | 'site04') => void
  children: ReactNode
}) {
  const { mission, updateMission, requirements, updateRequirements } = useSharedMission()
  const siteId = (mission.siteIds[0] === 'site01' ? 'site01' : 'site04') as 'site01' | 'site04'
  const { startUtc, endUtc, stepMinutes, horizonMode, delayHours, observerHeightM } = mission
  const durationHours = (Date.parse(endUtc)-Date.parse(startUtc))/3600000
  const clearanceDeg = requirements.earthClearanceDeg
  const minimumSolarHours = requirements.minimumSunHours
  const minimumEarthVisibleHours = requirements.minimumEarthHours
  const setStepMinutes = (value:number) => updateMission({stepMinutes:value})
  const setHorizonMode = (value:HorizonMode) => updateMission({horizonMode:value})
  const setDelayHours = (value:number) => updateMission({delayHours:value})
  const setObserverHeightM = (value:number) => updateMission({observerHeightM:value})
  const setClearanceDeg = (value:number) => updateRequirements({earthClearanceDeg:value})
  const [selectedSampleIndex,setSelectedSampleIndex] = useState(0)
  void initialSiteId

  const [earthData, setEarthData] = useState<EarthResponse | null>(null)
  const [compareData, setCompareData] = useState<CompareResponse | null>(null)
  const [loadingEarth, setLoadingEarth] = useState<boolean>(false)
  const [loadingCompare, setLoadingCompare] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number>(0)

  function setSiteId(next:'site01'|'site04') {
    updateMission({siteIds:[next,next==='site01'?'site04':'site01']})
    onExternalSiteChange?.(next)
  }
  function setStartUtcAndDuration(nextStartUtc:string,nextDurationHours:number) {
    if(!Number.isFinite(Date.parse(nextStartUtc))||!Number.isFinite(nextDurationHours))return
    updateMission({startUtc:nextStartUtc,endUtc:computeEndUtc(nextStartUtc,nextDurationHours)})
    setSelectedSampleIndex(0)
  }

  function setMinimumConstraints(solarHours: number, earthHours: number) {
    updateRequirements({minimumSunHours:solarHours,minimumEarthHours:earthHours})
  }

  function refreshAll() {
    setRefreshTick(t => t + 1)
  }

  useEffect(() => {
    let active = true
    setLoadingEarth(true)
    setEarthData(null)
    setErrorMessage(null)

    earthApiClient
      .fetchEarthVisibility({
        site_id: siteId,
        start_utc: startUtc,
        end_utc: endUtc,
        step_minutes: stepMinutes,
        horizon_mode: horizonMode,
        clearance_deg: clearanceDeg,
        delay_hours: delayHours,
        observer_height_m: observerHeightM,
      })
      .then(res => {
        if (!active) return
        setEarthData(res)
        setSelectedSampleIndex(prev => Math.min(prev, Math.max(0, res.samples.length - 1)))
      })
      .catch((err: unknown) => {
        if (!active) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoadingEarth(false)
      })

    return () => {
      active = false
    }
  }, [siteId, startUtc, endUtc, stepMinutes, horizonMode, clearanceDeg, delayHours, observerHeightM, refreshTick])

  useEffect(() => {
    let active = true
    setLoadingCompare(true)
    setCompareData(null)

    earthApiClient
      .fetchSiteComparison({
        site_ids: ['site01', 'site04'],
        start_utc: startUtc,
        end_utc: endUtc,
        step_minutes: stepMinutes,
        horizon_mode: horizonMode,
        clearance_deg: clearanceDeg,
        delay_hours: delayHours,
        observer_height_m: observerHeightM,
        minimum_solar_hours: minimumSolarHours,
        minimum_earth_visible_hours: minimumEarthVisibleHours,
      })
      .then(res => {
        if (!active) return
        setCompareData(res)
      })
      .catch((err: unknown) => {
        if (!active) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoadingCompare(false)
      })

    return () => {
      active = false
    }
  }, [startUtc, endUtc, stepMinutes, horizonMode, clearanceDeg, delayHours, observerHeightM, minimumSolarHours, minimumEarthVisibleHours, refreshTick])

  return (
    <MissionContext.Provider
      value={{
        siteId,
        startUtc,
        endUtc,
        durationHours,
        stepMinutes,
        horizonMode,
        clearanceDeg,
        delayHours,
        observerHeightM,
        minimumSolarHours,
        minimumEarthVisibleHours,
        selectedSampleIndex,
        earthData,
        compareData,
        loadingEarth,
        loadingCompare,
        errorMessage,
        setSiteId,
        setStartUtcAndDuration,
        setStepMinutes,
        setHorizonMode,
        setClearanceDeg,
        setDelayHours,
        setObserverHeightM,
        setMinimumConstraints,
        setSelectedSampleIndex,
        refreshAll,
      }}
    >
      {children}
    </MissionContext.Provider>
  )
}

export function useMissionContext(): MissionContextState {
  const ctx = useContext(MissionContext)
  if (!ctx) {
    throw new Error('useMissionContext must be used inside a MissionProvider')
  }
  return ctx
}
