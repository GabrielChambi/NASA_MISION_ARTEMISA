# LUNAR ORACLE — Presentation Storyboard & Parity Review (Plan B)

## 1. Storyboard (7-Part Structure)

| Slide / Stage | Core Message | Visual Evidence Shown | Time Budget |
|---|---|---|---:|
| **1. Problem** | At the Lunar South Pole ($\sim 89.5^\circ\text{S}$), both the Sun and the Earth hover near $0^\circ$ elevation. Lunar libration causes multi-day Earth line-of-sight blackouts that shift across neighboring ridges. | Launchpad Mission Control + South Pole geometry overview | 20 s |
| **2. NASA Data** | Authentic topocentric ephemerides from **NASA JPL Horizons (`DE441`)** (`coord@301`, targets `399` Earth & `10` Sun) + **NASA GSFC PGDA LRO-LOLA 5 m/pixel** DEMs (`Product 78`, `MOON_ME` frame) for `Site01` (Connecting ridge) and `Site04` (Shackleton rim). | Provenance badges & LOLA 3D surface elevation patch | 25 s |
| **3. Solution** | **LUNAR ORACLE** unifies Solar + Earth topocentric geometry, 3D LRO-LOLA surface visualization, and a deterministic Mission Resilience Lab in a single full-stack application. | Topbar switch into `Earth 3D & LoS` workspace | 20 s |
| **4. Live Demo** | Select `Dec 14–17, 2026 (72h)` → inspect Earth-rise transition on the elevation curve and interactive **3D Lunar Terrain + Sky-Dome** → switch to `Compare & Lab` → introduce a `+12h` launch delay and observe constraint satisfaction flip from `FALSE` to `TRUE`. | Live interaction across `MissionControls`, `EarthDashboard`, `EarthHorizonView` (3D), `SiteComparison`, and `MissionResilienceLab` | 65 s |
| **5. Validation** | 11 automated `pytest` tests verifying JPL Horizons parsing, boundary inequalities, missing-sample degradation, `unavailable` solar handling, and real UTC delay shifts, plus automated Playwright UI verification across 5 viewports. | `pytest` output + `docs/science/earth_mission.md` audit table | 20 s |
| **6. Limitations** | Explicit engineering boundaries: geometric line of sight to Earth center (`399`) does not guarantee RF link closure; flat horizon ($0^\circ$) is flagged when verified terrain horizon profiles are inactive; ranking is a transparent heuristic, not a NASA index. | `Terrain horizon unavailable` warning & provenance footer | 15 s |
| **7. Impact** | Enables mission planners, students, and reviewers to audit how launch timing and site selection interact at the Lunar South Pole with zero opaque scores or fabricated telemetry. | Summary comparison card (`Preferred under selected constraints`) | 15 s |

## 2. Timed Demo Script (English · 3 Minutes)

1. **0:00 – 0:30 (Mission Control Launchpad):** Start at `Mission control.` Highlight candidate sites `Shackleton rim (Site04)` and `Connecting ridge (Site01)` and explain that launchpad telemetry is illustrative, whereas the scientific workspaces query real NASA ephemerides.
2. **0:30 – 1:30 (Earth 3D & LoS Observatory):** Click **Earth 3D & LoS**. Show the `Dec 14–17, 2026` UTC window where Earth rises from $-1.4^\circ$ to $+2.8^\circ$ due to lunar libration. Scrub the 3D scene to show the live green line-of-sight vector over the real LRO-LOLA 5 m/pixel 3D surface mesh and inspect the `[start, end)` UTC visibility windows. Toggle `Terrain Horizon (LOLA)` to show the explicit `Terrain horizon unavailable` fallback notice.
3. **1:30 – 2:30 (Site Comparison & Mission Resilience Lab):** Click **Compare & Lab**. Point out that under a 48-hour minimum Earth LoS constraint on Dec 14–17, `Site04` achieves `48.0h` while `Site01` achieves `46.0h`. Then click `+12 hours` in the **Mission Resilience Lab** to trigger a real JPL Horizons query for the shifted UTC window (`Dec 14 12:00Z – Dec 17 12:00Z`), cutting initial blackout by 12 hours so both sites satisfy all constraints.
4. **2:30 – 3:00 (Provenance & 3D Telemetry Export):** Open the **3D Scene JSON** inspector to show the unit East-North-Up (`ENU`) vectors ready for external 3D engines, and summarize the scientific limitations.

## 3. Integration & Parity Review Log (Deliverable B-Q4)

- **Coordinate & Frame Parity:** Confirmed `site01` (`lat=-89.463521, lon=222.128578E, elev=1934.32m`) and `site04` (`lat=-89.771917, lon=203.293771E, elev=1731.37m`) in `MOON_ME` match NASA PGDA Product 78.
- **Inequality & Window Parity:** Both Solar (`SolarServiceProtocol`) and Earth (`EarthService`) use strict inequality (`>`) and semi-open intervals `[start_utc, end_utc)`.
- **No-Touch Compliance:** Zero modifications to `api/app/core/sites.py`, `api/app/core/horizon.py`, `api/app/solar/**`, `web/src/features/sites/**`, or `web/src/features/solar/**`.
