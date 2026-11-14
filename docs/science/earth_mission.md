# Scientific Documentation — Earth Visibility, 3D Topocentric Telemetry & Mission Resilience Lab (Plan B)

## 1. Lunar Topocentric Observer Ephemerides (JPL Horizons Body 399)

To determine direct line-of-sight visibility of the **Earth (NAIF ID `399`)** from a candidate landing site on the lunar surface (`Moon`, NAIF ID `301`), `api/app/earth/horizons.py` queries the official **NASA JPL Horizons API** (`https://ssd.jpl.nasa.gov/api/horizons.api`) using topocentric observer mode:

- `EPHEM_TYPE = 'OBSERVER'`
- `COMMAND = '399'` (Earth center, planetary ephemeris `DE441`)
- `CENTER = 'coord@301'` (topocentric site on Moon body `301`)
- `COORD_TYPE = 'GEODETIC'`
- `SITE_COORD = 'lon_east_deg,lat_deg,height_km'`
- `QUANTITIES = '4,20'` (apparent topocentric Azimuth & Elevation in degrees, plus observer-to-target range $\Delta$ in AU and range-rate $\dot{\Delta}$ in km/s)
- `TIME_TYPE = 'UT'`, `CSV_FORMAT = 'YES'`, `ANG_FORMAT = 'DEG'`

### Verified Candidate Sites (NASA GSFC PGDA · LRO-LOLA 5 m/pixel Product 78)

Coordinates are extracted directly from the NASA GSFC Planetary Geodynamics Data Archive (`https://pgda.gsfc.nasa.gov/products/78`, Barker et al. 2021 / Mazarico et al. 2011) in the `MOON_ME` reference frame (reference radius $R = 1737.4\text{ km}$):

| Site ID | Name | Latitude (`deg`) | East Longitude (`deg`) | Surface Elevation $Z$ (`m`) | South Polar Stereographic $(X, Y)$ |
|---|---|---:|---:|---:|---|
| `site01` | Connecting ridge | `-89.463521°` | `222.128578° E` | `1934.32 m` | `X = -10912.5 m, Y = -12065.0 m` |
| `site04` | Shackleton rim | `-89.771917°` | `203.293771° E` | `1731.37 m` | `X = -2735.0 m, Y = -6352.5 m` |

### Independent Verification Case (Auditable against JPL Horizons)

For epoch `2026-12-14T00:00:00Z` and `2026-12-15T00:00:00Z` with `observer_height_m = 2.0 m`:

- **Site01 (`222.128578, -89.463521, 1.93632 km`)**:
  - `2026-12-14 00:00 UT`: $\text{Az} = 133.427399^\circ$, $\text{El} = -1.438614^\circ$, $\Delta = 0.0026955026\text{ AU} = 403,241.45\text{ km}$ → `earth_visible = false` (below $0^\circ$ flat horizon).
  - `2026-12-15 00:00 UT`: $\text{Az} = 132.185934^\circ$, $\text{El} = -0.042867^\circ$ → `earth_visible = false` (still $0.043^\circ$ below flat horizon).
- **Site04 (`203.293771, -89.771917, 1.73337 km`)**:
  - `2026-12-14 00:00 UT`: $\text{Az} = 152.267344^\circ$, $\text{El} = -1.271667^\circ$, $\Delta = 0.0026954687\text{ AU} = 403,236.38\text{ km}$ → `earth_visible = false`.
  - `2026-12-15 00:00 UT`: $\text{Az} = 151.018961^\circ$, $\text{El} = +0.117899^\circ$ → `earth_visible = true` (Earth rises above flat horizon ~3 hours earlier at Shackleton rim than at Connecting ridge due to their $0.31^\circ$ latitude offset along the Earth libration direction).

## 2. Geometric Visibility Criterion & Semi-Open Window Convention

At each sample timestamp $t_i \in [\text{start\_utc}, \text{end\_utc})$:

$$\text{earth\_visible}(t_i) \iff \text{elevation\_deg}(t_i) > \text{local\_horizon\_deg}(\text{az}(t_i)) + \text{clearance\_deg}$$

- Strict inequality (`>`) is used consistently for both Solar (`sun_elevation_deg > local_horizon_deg`) and Earth visibility.
- Each sample $t_i$ represents the semi-open interval $[t_i, t_i + \Delta t)$.
- If a sample is missing from the series, `quality` is marked `"degraded"` and **no synthetic point is interpolated**; contiguous windows do not bridge across missing timestamps.
- In `terrain` mode, if `api.app.core.horizon` is not verified, the service explicitly returns `quality = "terrain_unavailable"`, preserves `requested_horizon_mode = "terrain"`, and serves `effective_horizon_mode = "flat"` ($0^\circ$).

## 3. 3D Topocentric Coordinate Frame (`ENU`) & LRO-LOLA 3D Surface Patches

To support real-time 3D visualization without recalculating trigonometry in the UI:

$$\mathbf{u}_{\text{ENU}} = \begin{bmatrix} x_{\text{east}} \\ y_{\text{north}} \\ z_{\text{up}} \end{bmatrix} = \begin{bmatrix} \cos(\text{el})\sin(\text{az}) \\ \cos(\text{el})\cos(\text{az}) \\ \sin(\text{el}) \end{bmatrix}, \quad \|\mathbf{u}_{\text{ENU}}\| = 1$$

Each `/api/earth` and `/api/compare` response also embeds a real $21 \times 21$ ($1\text{ km} \times 1\text{ km}$ at $50\text{ m}$ grid spacing) elevation grid sampled directly from NASA GSFC PGDA `Site01_final_adj_5mpp_surf.tif` and `Site04_final_adj_5mpp_surf.tif`.

## 4. Scientific Scope & Operational Limitations

- **Geometric visibility only:** Line of sight to Earth center (`399`) does not model RF link budget, atmospheric attenuation on Earth, DSN station handovers, or spacecraft structural masking.
- **Heuristic comparison:** Site ranking orders candidates by (1) number of satisfied minimum constraints, (2) joint temporal overlap (`Solar ∩ Earth`), and (3) deterministic `site_id` tie-breaker. If any required series is `unavailable`, `meets_constraints` is `"unknown"` and no winner is declared.

## 5. Official NASA Goddard (PGDA LRO-LOLA) & JPL Horizons Data Architecture

| NASA Source | Contents | Mission Purpose in LUNAR ORACLE | Extracted Site Telemetry (`Site01` / `Site04`) |
|---|---|---|---|
| **LOLA 5 m/pixel** (`*_final_adj_5mpp_surf.tif`) | Real lunar surface elevation $Z$ in meters (`MOON_ME`) | Build the 3D terrain mesh and local horizon obstructions | `Site01`: $1934.32\text{ m}$ (`1815.6..1957.4 m`)<br>`Site04`: $1731.37\text{ m}$ (`1511.4..1738.3 m`) |
| **LOLA Slope Maps** (`*_final_adj_5mpp_slp.tif`) | Surface terrain slope in degrees | Evaluate landing site steepness and surface characteristics | `Site01`: $3.435^\circ$ center ($7.52^\circ$ mean)<br>`Site04`: $2.534^\circ$ center ($15.79^\circ$ mean) |
| **LOLA Uncertainty Maps** (`*_final_adj_5mpp_toterr.tif`) | RMS vertical $Z$ error in meters from co-adjusted tracks & clones | Display precision boundaries in 3D & telemetry | `Site01`: $\pm 0.388\text{ m}$ center ($\pm 0.422\text{ m}$ median)<br>`Site04`: $\pm 0.118\text{ m}$ center ($\pm 0.281\text{ m}$ median) |
| **LOLA South Pole 80 m/pixel** | Regional polar relief DEM | Detect distant massifs blocking low-elevation horizon | Integrated via `core/horizon.py` protocol |
| **JPL Horizons** (`DE441`) | Topocentric Sun (`10`) & Earth (`399`) Az/El by UTC date & site | Calculate solar illumination, Earth LoS windows & 3D ENU vectors | Verified on `2026-12-01`..`2026-12-22` at 30-min steps |
| **LROC / Moon Trek** | Visual lunar imagery & polar basemaps | Visual explorer context & 3D shading | South Polar Stereographic `MOON_ME` alignment |
