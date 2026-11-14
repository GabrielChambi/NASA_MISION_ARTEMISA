import { MissionProvider } from './features/mission/MissionContext'
import MissionPlanner from './features/mission/MissionPlanner'

export default function App() {
  return <MissionProvider initialSiteId="site01"><MissionPlanner /></MissionProvider>
}
