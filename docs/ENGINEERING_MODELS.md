# Engineering studies and physical evidence

Lunar Oracle is an **uncalibrated design model with NASA terrain and ephemerides**. It now computes coupled thermal/electrical states, conditional DSN radio contacts, bounded rover round trips and finite-endpoint orbital transfer designs. It can compare recorded telemetry and assimilate an initial state. These capabilities do not establish a validated operational digital twin.

## Run and inspect

Use Python 3.11+ and the pinned dependencies.

~~~powershell
api/.venv/Scripts/python.exe -m pip install -r api/requirements.txt
api/.venv/Scripts/python.exe api/scripts/acquire_nasa.py
api/.venv/Scripts/python.exe api/scripts/acquire_spice.py
npm.cmd run dev:full
~~~

Open http://127.0.0.1:5173/, plan a mission and open **Estudio de misión / Mission study**. The extended physics study runs automatically for the selected destination. The main summary distinguishes the basic electrical ledger from the coupled thermal/radio result. It never promotes an unresolved coupled result to mission survival.

Edit **Physics settings**, upload a physics profile or compare sensitivity scenarios. Orbital transfers have a separate explicit calculation because they require more computation. The operations and main mission exports retain the physics evidence. This functionality requires the Python API; a static frontend alone cannot run it.

POST /api/engineering/analyze recomputes the NASA scenario. It does not accept browser-predicted terrain or flight results as scientific inputs. POST /api/engineering/trajectory uses the same dates and target. Missing source files, unavailable ephemerides, unsupported kernel dates and invalid configuration are explicit failures. Obsolete calculations receive a cancellation signal; new inputs cannot display an old study.

An outer **status: ok** means a report was generated. The nested status and individual criteria determine whether a part is resolved. **operationally_validated remains false.**

## Electrical and thermal coupling

The basic ledger retains its original role. The coupled study adds an independent heater, temperature-dependent battery limits and an RF-limited data rate. Enter critical electrical loads **without** this heater to avoid counting it twice.

The equivalent isothermal node solves, in SI units:

~~~text
C dT/dt = α S(1 AU / r)² A_abs V
        + f_heat P_served_nonheater + P_served_heater
        + ε σ A_rad [F_ground T_ground⁴ + (1−F_ground) T_space⁴ − T⁴]
~~~

Solar distance and occultation come from the NASA scenario. Absorbing area is a declared projected effective area. Ground temperature is a prescribed blackbody-equivalent radiative boundary, **not a measured or predicted Diviner temperature**. View factors sum to one. There is no structural conduction network, panel self-shadow or spatial thermal gradient.

Radiation uses RK4 with steps no larger than 30 s and a local radiative stability bound. Thermostat hysteresis, RF rate and battery factors are held over each original 15-minute NASA interval. Subinterval switching remains unresolved. Electrical segmentation resolves configured faults, reserve crossings and depletion within that sampled model.

Battery curves provide temperature, accessible capacity, charge-power and discharge-power factors. Linear interpolation is confined to their domain. Out-of-domain temperatures stop the supported coupled prediction. Inaccessible stored charge is locked rather than deleted; temperature changes do not create or destroy electrical energy.

The heater receives only power actually served after other essential loads. RF electrical consumption is at least transmitted power divided by amplifier efficiency plus transmitting electronics load. Optional equipment respects the full-power transmitting fraction. Electrical and data conservation are checked separately from physical calibration.

The shipped curve and thermal parameters are **design assumptions**, not manufacturer data. The equivalent node is not an independently measured battery-cell temperature.

References: [NASA thermal control](https://www.nasa.gov/smallsat-institute/sst-soa/thermal-control/), [NASA power subsystems](https://www.nasa.gov/smallsat-institute/sst-soa/power-subsystems/), [NIST constants](https://physics.nist.gov/cuu/Constants/).

## RF and DSN geometry

The calculation uses Friis loss, antenna gains, additional losses and receiver noise:

~~~text
L_fs = 20 log10(4π R f / c)
C/N₀ = P_received(dBW) − 10 log10(k T_system)
E_b/N₀ = C/N₀ − 10 log10(bit_rate)
margin = E_b/N₀ − required_E_b/N₀ − declared_reserve
~~~

The maximum rate is limited by the margin and configured requested rate. No contact means no transmitted data.

Station vectors use **DSS-24 Goldstone, DSS-34 Canberra and DSS-54 Madrid**. WGS84 coordinates come from [DSN 301P, table 5](https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf). They are epoch 2003.0 positions; tectonic velocities are not propagated. These are three representative 34 m antennas, not the entire DSN.

Lunar horizons use the declared antenna height and station azimuth. Earth rotation uses a pinned binary PCK and ITRF93. A declared 10° ground elevation mask is applied. Actual masks, equipment configuration, gain pattern, weather, pointing and schedules are unconfirmed. Computed windows are **conditional**, never booked contacts.

Station geometry is instantaneous. It does not iterate transmit/receive light-time events, stellar aberration or refraction. The observer-validation path below separately uses apparent CN+S angles. The Earth PCK includes predictions after its measured interval and ends on 2027-02-10. Unsupported dates remain unresolved.

Gains, noise and losses are declared equivalent design values, not verified station specifications. Formulas are checked against [NASA NTRS 19970017397, table 2](https://ntrs.nasa.gov/api/citations/19970017397/downloads/19970017397.pdf), plus distance, power, noise and data-rate invariants.

## Independent SPICE software path

Acquisition records official URLs, bytes and SHA256 for the LSK, DE440s, lunar binary PCK, mean-Earth frame kernel, text PCK and Earth binary PCK. Large kernels stay in ignored data/raw/spice; the manifest is versioned. SPICE global kernel calls are serialized.

The observer comparison uses spkcpo, MOON_ME, observer-frame evaluation and CN+S. The frame alias uses DE440 orientation aligned to the DE421 mean-Earth convention. Terrain height and panel/antenna height enter explicitly. Differences use great-circle separation, avoiding unstable azimuth subtraction near a pole.

[111 comparisons from 40 original JPL records](validation/spice-reference-validation.json) pass the declared 0.01° threshold; observed maximum separation is about 0.000000923°. Each study also compares up to seven epochs per body for its actual observer. Shared JPL ephemeris heritage does not provide independent physical tracking validation or a bound on every lunar location.

See [NAIF spkcpo](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html) and [original kernels](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/).

## Orbital outbound and return designs

A zero-revolution Lambert solution seeds differential correction. State-transition matrices and gravity continuation help close finite boundaries. Return is solved separately with reverse-time targeting followed by forward correction.

Geocentric J2000 equations include Earth central gravity and direct-minus-indirect Moon/Sun point-mass acceleration. DE440 geometric positions are interpolated every 15 minutes. DOP853 integrates the path. Detected spherical-body surface crossings stop integration.

Outbound starts in a **notional** 200 km Earth parking orbit and targets a point 100 km above the selected lunar direction. Return starts at a notional 100 km lunar parking point and targets a 120 km Earth entry boundary. Phase and plane are assumptions. Ground coordinates orient an orbital target, not a propagated surface landing.

Terminal error, impulses, duration, detected impacts and sampled clearances are exported. Closure requires residual below 1 km and no detected impact. The reference case closes far below that threshold and is reintegrated with tighter tolerance.

This does not validate ascent from Kennedy, a launch window, optimized orbit insertion, fuel/finite thrust, lunar ascent/descent or atmospheric entry. Times remain design boundaries; the main itinerary retains its identified ideal two-body estimate. Finite event searches on spherical bodies do not certify collision avoidance.

Reference: [JPL astrodynamic parameters](https://ssd.jpl.nasa.gov/astro_par.html). Numerical closure verifies equations and boundaries, not flight feasibility.

## Rover routes

Dijkstra search uses the native local DEM and footprint classes. Unknown/failed cells are excluded; diagonal corner cutting is disallowed. Edges also satisfy the declared slope from native height differences. Elevations retain native precision.

Distances use lunar spherical geometry. Positive edge costs include rolling work, uphill gravitational work divided by drive efficiency, and auxiliary energy over travel time. There is no regenerative braking or assumed solar recharge. Directed return costs are solved, not inferred from a radius.

Automatic selection maximizes displacement among destinations whose computed **round trip** fits above reserve. An explicit goal can exceed available energy. If no affordable trip exists, the furthest point is not labeled safe.

A Site01 route appears in [engineering validation](validation/engineering-reference-validation.json). It uses 5 m spacing and a recomputed favorable center. Spacing is not independent measurement accuracy. Subpixel rocks, bearing capacity, slip/sinkage, suspension, thermal survival and route communications are outside this model. Support uses the declared local-study footprint, not unverified 3D dimensions.

## Hardware and telemetry

Example: [hardware-design-profile.json](../data/examples/hardware-design-profile.json). Its sources explain physics; they do not claim its numbers describe a NASA spacecraft.

Profiles record asset_id, name, revision and references. Specification/test document hashes may be declared. They remain user-supplied; a calibration flag cannot self-certify the model.

Telemetry requires:

~~~json
{
  "asset_id": "DESIGN-REFERENCE",
  "source": "Description of the recording or test",
  "kind": "recorded",
  "mode": "replay",
  "uncertainty": {"temperature_k": 1.0, "soc": 0.02},
  "samples": [
    {"t_utc": "2026-12-30T00:00:00Z", "temperature_k": 293.15, "soc": 0.85}
  ]
}
~~~

Times must increase strictly, use UTC and lie in the modeled stay. Future samples cannot claim live mode. Recorded data require a matching hardware identity. Downloaded templates are synthetic_test and retain that identity even if comparison is unresolved.

An exact arrival sample may initialize temperature and SOC. The report retains previous values, replacements, asset and canonical-record digest. This does **not** fit parameters, calibrate a curve or independently validate that same measurement. The temperature observable must correspond to the modeled node.

Residual RMSE/bias require a supported prediction. Declared uncertainty is a threshold, not an inferred confidence level. No authenticated physical spacecraft stream is connected.

## Sensitivity and acceptance

Lower solar derating, colder initial state and higher RF loss are evaluated separately and together. These declared perturbations are not exhaustive joint covariance propagation, worst-case proof or a success probability.

DEM errors, finite horizon sampling, partial distant coverage and subpixel hazards remain visible. Missing covariance and hardware uncertainty cannot be invented. Separate gates cover geometry, regional planning, dispersion footprints, coupled budget, thermal limits, hardware identity, calibration and review. Calibration and independent review remain pending.

[NASA-STD-7009B](https://standards.nasa.gov/sites/default/files/standards/NASA/B/1/NASA-STD-7009B-Final-3-5-2024.pdf) is a methodological reference, not a conformance or NASA approval claim.

## Reproduce

~~~powershell
api/.venv/Scripts/python.exe -m pytest api/tests -q
npm.cmd run test:science
npm.cmd run build
api/.venv/Scripts/python.exe api/scripts/validate_spice.py
api/.venv/Scripts/python.exe api/scripts/validate_engineering.py
node frontend/scripts/test-engineering.mjs
node frontend/scripts/test-mission-operations.mjs
node frontend/scripts/test-lunar-studio.mjs
~~~

Analytical checks include heating, radiative cooling/equilibrium/refinement, the published RF benchmark, battery locking/conservation, directed return costs, invalid telemetry, circular-orbit Lambert boundaries and impacts. Positive browser results use original NASA responses; only explicit failure cases are intercepted.
