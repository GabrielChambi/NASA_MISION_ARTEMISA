import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MissionParameters } from './types'

type MissionState = { mission: MissionParameters; updateMission: (patch: Partial<MissionParameters>) => void }
const MissionContext = createContext<MissionState | null>(null)

export function MissionProvider({ initialSiteId, children }: { initialSiteId: string; children: ReactNode }) {
  const [mission, setMission] = useState<MissionParameters>({
    siteIds: [initialSiteId, initialSiteId === 'site01' ? 'site04' : 'site01'],
    startUtc: '2026-12-01T00:00:00Z', endUtc: '2026-12-08T00:00:00Z',
    stepMinutes: 60, horizonMode: 'flat', delayHours: 0, observerHeightM: 1,
  })
  useEffect(() => {
    setMission(current => current.siteIds[0] === initialSiteId ? current : { ...current, siteIds: [initialSiteId, initialSiteId === 'site01' ? 'site04' : 'site01'] })
  }, [initialSiteId])
  return <MissionContext.Provider value={{ mission, updateMission: patch => setMission(current => ({ ...current, ...patch })) }}>{children}</MissionContext.Provider>
}

export function useMission() {
  const state = useContext(MissionContext)
  if (!state) throw new Error('useMission requires MissionProvider')
  return state
}
