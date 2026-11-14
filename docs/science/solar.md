# Solar geometry, terrain and NASA provenance

## Implemented scope

The scientific API uses actual NASA/JPL responses and actual NASA LOLA GeoTIFF measurements. There are no synthetic ephemerides or substituted visibility results. Solar queries and the shared Earth-target adapter, region catalog, 3D terrain previews, circular horizon interpolation, sampled visibility windows, bounded requests, exact-query disk caching and explicit failure states are implemented.

The seven requested topography products are fully downloaded, read and inventoried in `data/catalog/datasets.json`: two 5 m elevation rasters, four complete slope/height-uncertainty rasters, and the 80 m regional elevation raster. Each product is labeled `downloaded_verified` and retains a SHA-256 checksum. Slope/uncertainty grids are checked for exact CRS, transform, width and height alignment with their elevation DEM. Their source-pixel measurements, valid-pixel counts and full-raster min/max statistics are recorded. No 100-clone ensembles are downloaded.

## Official sources inspected

- [NASA Goddard LOLA landing-region products](https://pgda.gsfc.nasa.gov/products/78)
- [LOLA file inventory and README](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/)
- [JPL Horizons API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html)

Source URLs, acquisition timestamps, original bounds, full CRS WKT, product sizes and SHA-256 hashes are retained in the catalog. Original rasters are held in ignored `data/raw/`; small reproducible derivatives are versioned.

## Site reference points and coordinates

Each reference point is the actual central pixel (`row=1600`, `col=1600`) of its published 3200×3200 raster. The pixel's map coordinates are transformed using the GeoTIFF polar stereographic CRS to a spherical lunar longitude/latitude CRS with radius 1,737,400 m. This is a reproducible **regional reference pixel**, not a NASA-approved landing point or an assertion that this precise location is on the best part of a crater rim.

| Region | Latitude ° | East longitude ° | DEM height m |
| --- | ---: | ---: | ---: |
| Site01 · Connecting ridge | -89.46315776 | -137.50198491 | 1944.767 |
| Site04 · Shackleton rim | -89.76674148 | -171.89280908 | 767.979 |

Both points are inside their actual NASA raster bounds and have finite, valid elevations. The associated slope and formal RMS height uncertainty refer to that same source pixel. A future interactive point picker must revalidate DEM coverage, surface elevation and horizon at every new coordinate; the current profile must not be reused at a different marker.

NASA identifies the local rasters as MOON_ME in the DE421 reference frame. The live Horizons response identifies the topocentric lunar orientation as `MEAN_ME (high precision)`. This implementation uses that mean-Earth convention and does not confuse it with IAU_MOON or MOON_PA. An independent SPICE transformation/cross-validation has not been completed; centimeter-level frame consistency is not claimed.

## Real JPL query and parser

The response format was first inspected with `api/scripts/probe_horizons.py`. Its illustrative point at 0° longitude, 89°S is stored in `data/prepared/format-probe.json` with `probe_only: true` and is never used as a candidate site or result.

Actual site queries use target Sun `10` or Earth `399`, `EPHEM_TYPE=OBSERVER`, `CENTER=coord@301`, `COORD_TYPE=GEODETIC`, `QUANTITIES=4`, `TIME_TYPE=UT`, `CSV_FORMAT=YES`, `TIME_DIGITS=SECONDS`, and an airless observer. Site altitude is **DEM surface elevation plus observer height**, converted from meters to kilometers. It is not merely the observer's 1 m height above the terrain.

The real response header was checked for target, Moon (301), lunar MEAN_ME observer, geodetic coordinates, apparent azimuth and elevation. Only the table between `$$SOE` and `$$EOE` is parsed. CSV columns are timestamp, solar marker, event marker, apparent azimuth, apparent elevation. The parser rejects missing tables, incomplete sample counts, wrong bodies/columns, nonfinite angles, invalid ranges and timestamps that do not match the exact requested UTC grid.

The API accepts explicit UTC whole-minute times in 1962–2100, 1 hour–31 days, 5–1440 minute steps dividing the duration exactly, at most 1500 intervals, and bounded observer heights. Dates before 1962 are rejected because Horizons reports UT1 rather than UTC there. Python serializes upstream JPL requests per server process; the hosted frontend sequences its scientific requests. The edge adapter does not claim global serialization across visitors or isolates; that would require a separate coordination service. Timeout/HTTP/parse failures yield HTTP 503 with `status: unavailable`, empty samples/windows and no result summary. Input validation yields 422. Terrain unavailability never silently falls back to a flat result.

Exact-query cache records retain parameters, full JPL text, original query URL and retrieval timestamp. Prepared records are real previous responses, not fixtures. Any change of coordinates, altitude, interval, target or sampling step produces a distinct key. Cached retrieval time is kept unchanged and `cache_hit` is visible.

## Terrain horizon

`data/prepared/horizon_profiles.json` contains 360 one-degree azimuth samples for each site at observer heights **1, 2 and 5 m**. Other heights remain available in flat mode but are rejected in terrain mode until corresponding profiles are computed.

At each azimuth, spherical-geodesic forward positions are mapped into the real raster CRS and sampled from:

- the local NASA 5 m elevation raster at 10 m radial increments, up to its valid boundary (search limit 22 km);
- the regional NASA 80 m south-pole raster at 250 m radial increments, out to 250 km.

For lunar radius `R`, observer elevation `z0`, observer height `h`, terrain elevation `z` and surface distance `d`, the line-of-sight elevation is:

```text
angle = atan2((R+z) cos(d/R) - (R+z0+h), (R+z) sin(d/R))
```

The maximum along each ray defines the modeled horizon. Invalid/nodata samples and samples outside a raster are excluded. A ray containing no valid data is an explicit error. The runtime function `horizon_at(site_id, azimuth_deg, observer_height_m, mode)` interpolates the profile circularly, including the 359°/0° boundary.

The result is labeled **partial**, even though a regional DEM is included: radial/azimuth sampling, raster interpolation, finite 250 km range and nodata may miss obstructions. Height and slope uncertainty are displayed as source measurements but are not propagated into probabilistic horizon bounds. This is not a complete certified optical or radio horizon.

The 65×65 terrain previews are bilinear downsampled representations of the original 5 m rasters. They retain real heights and projected meter extents, but their reduced visual resolution must not be used as the calculation DEM or as a landing-safety assessment. The same preview grid includes real slope and RMS height-uncertainty layers (`slope_degrees` and `height_uncertainty_m`) from the corresponding aligned NASA products. Raster statistics and reference-point values are computed from the original full-resolution arrays, not these previews.

## Visibility and half-open windows

```text
visible = apparent_elevation_deg > horizon_elevation_deg
```

For flat mode, horizon is explicitly 0°. Equality is defined as not visible. Flat mode excludes terrain obstruction and horizon dip.

Each sample represents the half-open interval `[t_i, t_(i+1))`; consecutive true cells form windows. The final endpoint is retained for plotting and adds no duration. Durations are integrated over actual timestamp differences. Metrics are visible hours, visible fraction, window count and longest continuous dark/hidden gap. Transitions are uncertain by up to one sampling step; apparent solar center visibility is not finite solar-disk modeling, energy generation or a guaranteed RF link.

## Validation performed

- Six independent direct short JPL queries: both sites at 2026-12-01, 2026-12-04 and 2026-12-07 UTC, compared with the corresponding samples of the longer default series. All azimuth/elevation differences are within **0.00001°**. Exact query URLs and measured differences are stored in `data/prepared/validation.json`.
- Default real Sun and Earth series for both sites: 2026-12-01 through 2026-12-08, hourly, flat horizon, observer height 1 m. Each has 169 samples. Full API responses and raw JPL records are versioned.
- Unit/API tests cover circular interpolation, planar and obstructed synthetic horizons, nodata errors, strict horizon equality, UTC and day boundaries, final-endpoint counting, all-visible/all-dark intervals, malformed Horizons data, explicit upstream failures, catalog provenance and API defaults.

The independent-query comparison validates parsing and interval consistency against NASA output; it is not an independent astrodynamics solver or SPICE validation. Plan A's review of another team member's PR remains an external collaboration step and is not claimed as completed.

## Reproduce

From the repository root on Windows:

```powershell
python -m venv api/.venv
api/.venv/Scripts/python.exe -m pip install -r api/requirements.txt
api/.venv/Scripts/python.exe api/scripts/acquire_nasa.py
api/.venv/Scripts/python.exe api/scripts/prepare_ephemeris.py
api/.venv/Scripts/python.exe -m pytest api/tests -q
api/.venv/Scripts/python.exe -m uvicorn api.app.main:app --host 127.0.0.1 --port 8000
```

Data preparation uses about 435 MB of raw NASA rasters and network access to NASA. Independent raster products can download concurrently; the preparation script's JPL ephemeris requests are sequential. Downloads use temporary files and atomic replacement so interrupted transfers are not reused as complete products. Running the API with the versioned derivatives and exact default interval does not require downloading those rasters again. Other dates/parameters require a working JPL connection or a matching real cache entry.
