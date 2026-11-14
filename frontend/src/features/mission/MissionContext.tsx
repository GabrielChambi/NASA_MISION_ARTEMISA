import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Requirements } from './missionAnalysis'
import type { MissionParameters } from './types'

type MissionState = { mission: MissionParameters; updateMission: (patch: Partial<MissionParameters>) => void; requirements: Requirements; updateRequirements: (patch: Partial<Requirements>) => void }
const MissionContext = createContext<MissionState | null>(null)

export function MissionProvider({ initialSiteId, children }: { initialSiteId: string; children: ReactNode }) {
  const [mission, setMission] = useState<MissionParameters>({
    siteIds: [initialSiteId, initialSiteId === 'site01' ? 'site04' : 'site01'],
    startUtc: '2026-12-14T00:00:00Z', endUtc: '2026-12-17T00:00:00Z',
    stepMinutes: 60, horizonMode: 'terrain', delayHours: 0, observerHeightM: 2,
  })
  const [requirements, setRequirements] = useState<Requirements>({ minimumSunHours: 12, minimumEarthHours: 12, maxSlopeDeg: 10, earthClearanceDeg: 0 })
  useEffect(() => {
    setMission(current => current.siteIds[0] === initialSiteId ? current : { ...current, siteIds: [initialSiteId, initialSiteId === 'site01' ? 'site04' : 'site01'] })
  }, [initialSiteId])
  return <MissionContext.Provider value={{ mission, requirements, updateRequirements: patch => setRequirements(current => ({ ...current, ...patch })), updateMission: patch => setMission(current => ({ ...current, ...patch })) }}>{children}</MissionContext.Provider>
}

export function useMission() {
  const state = useContext(MissionContext)
  if (!state) throw new Error('useMission requires MissionProvider')
  return state
}
