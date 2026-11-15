# English workflow and explainable line of sight

Lunar Oracle opens directly in the browser. Choose **English** or **Español** in the header. The choice persists after a reload; a browser that prefers English starts in English when no preference was saved. Changing language preserves the active mission, its UTC instants, requirements and calculated NASA results.

## Requests and follow-ups

The same deterministic interpreter handles Spanish and common English mission requests, including:

- “I want to travel on December 25, 2026 at 8am and stay 72 hours.”
- “I want to land on 25 December 2026 at 8am.”
- “Delay departure by 12 hours.”
- “Change the battery to one thousand Wh.”
- “What if solar panels produce 20% less?”
- “Communications blackout for 6 hours starting at hour 12.”

Departure and landing retain their distinct meanings. Kennedy Space Center LC-39B and America/New_York remain the default reference; July and December use the appropriate daylight-saving offset. UTC can be selected explicitly. A launch-site reference is not a computed ascent trajectory or a validated launch window.

A missing year produces a question about the year. Replying “2026” completes a known month, day and clock, even when the initial request already included the hour. Invalid calendar dates remain invalid. Negative instructions do not execute changes. Battery and other dimensional inputs retain their quantities and units.

English presentation includes the map, full-cap class budget, mission dates, operational windows, energy controls, local terrain study, errors, scientific limitations and copilot replies. IDs, NASA query URLs, UTC records and numerical payloads remain machine-readable. Raw user messages stay unchanged in the conversation audit. Native raster operations require the Python API; the hosted Worker keeps its existing scope.

## Why a red Earth direction could look unobstructed

The previous scene placed the ray on the enlarged illustrative spacecraft. In the focus view, its decorative antenna could put a ray hundreds of metres above a scientific observer whose declared height was 2 m. A separate visual rule used zero clearance while the timeline required more than 0.3 degrees.

Scientific ray origins now use the selected DEM elevation and the declared observer height along the local vertical. They are independent of the scale, position and altitude of the decorative spacecraft. The line color, timeline and visibility panel use a shared classification:

| State | Center-line condition |
| --- | --- |
| Occluded / red | Center elevation is at or below the sampled DEM horizon |
| Limited / amber | Positive clearance, but it does not exceed the required 0.3° margin |
| Clear / blue for Earth | Clearance exceeds that margin |
| Unknown / gray | Angles are missing, nonfinite or unsupported |

Clearance is **center elevation − terrain horizon**, in degrees. Comparisons use a small numerical tolerance at equality; this is not a physical uncertainty estimate. A negative elevation alone does not imply occultation: a terrain horizon can also lie below the local tangent.

The live diagnostic displays center elevation, the NASA DEM angular horizon, clearance, required margin, azimuth and observer height. Its angular sketch has no distance scale. The copilot receives these same values and distinguishes geometric visibility from RF performance.

For the reproduced departure at **1 December 2026, 10:00 Kennedy (15:00 UTC)**, the closest regional candidate at the initial arrival sample has Earth elevation **−1.884°**, horizon **−1.470°**, and clearance **−0.414°**. Its center is occluded under this model. These values belong to that scenario and destination; they are not a fixed explanation for every red sector.

The camera mesh is coarser than the source terrain, and the terrain setting the horizon may lie outside the view. The Earth sphere and lander remain illustrative. The prepared horizon data store angular profiles, not the distance or coordinates of the terrain point defining each maximum. The app therefore does not invent a collision point or an obstacle location. It does not calculate the visible fraction of the Earth disk or a radio-link budget.

NASA illustrates the importance of distant terrain and changing illumination in [Shadows near the Moon’s South Pole](https://svs.gsfc.nasa.gov/4893/). Observer quantities and geometry conventions are documented in the [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).

## Reproduce locally

~~~powershell
npm.cmd run dev:full
~~~

Open http://127.0.0.1:5173/ and select English. For verification:

~~~powershell
npm.cmd run test:science
api/.venv/Scripts/python.exe -m pytest api/tests -q
$env:LUNAR_ORACLE_TEST_URL='http://127.0.0.1:5173/'
node frontend/scripts/test-bilingual-visibility.mjs
node frontend/scripts/test-automatic-mission.mjs
~~~

The bilingual browser test exercises actual scientific APIs, the red Earth case, language persistence, conservation of NASA results across language changes, year clarification, mobile layout and English battery/solar experiments. Scientific data are calculated by the engines, not generated by a language model.
