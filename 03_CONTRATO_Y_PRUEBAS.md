# 03 — CONTRATO COMÚN Y PRUEBAS DE PARIDAD (LUNAR ORACLE)

Este documento define el contrato compartido entre **Integrante A (Sol + Terreno + Catálogo)** e **Integrante B (Tierra + Comparador + Mission Resilience Lab + 3D Telemetry)**.

## 1. Convenciones Científicas y Temporales

1. **Tiempo (`UTC`)**:
   - Todas las marcas temporales usan ISO-8601 UTC explícito con sufijo `Z` (`YYYY-MM-DDTHH:MM:SSZ`).
   - Las entradas sin zona horaria o con formato inválido devuelven `HTTP 422 Unprocessable Entity`.
   - Convención de ventanas: **semintervalo cerrado-abierto `[start_utc, end_utc)`**, donde cada muestra `t_i` representa el intervalo `[t_i, t_i + step_minutes)`.
2. **Coordenadas y Marcos (`MOON_ME` / `MEAN_ME`)**:
   - Catálogo base verificado en NASA GSFC PGDA (LRO-LOLA 5 m/píxel, producto 78, Barker et al. 2021 / Mazarico et al. 2011):
     - `site01` (**Connecting ridge**): `lat = -89.463521°`, `lon = 222.128578° E` (`-137.871422°`), `elevation_m = 1934.32 m` (`1.93432 km` sobre esfera lunar de `1737.4 km`).
     - `site04` (**Shackleton rim**): `lat = -89.771917°`, `lon = 203.293771° E` (`-156.706229°`), `elevation_m = 1731.37 m` (`1.73137 km` sobre esfera lunar de `1737.4 km`).
   - En JPL Horizons: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='lon_east_deg,lat_deg,height_km'`, `EPHEM_TYPE='OBSERVER'`, `QUANTITIES='4,20'`, `TIME_TYPE='UT'`, `ANG_FORMAT='DEG'`.
   - Orientación de azimut: `0° = Norte local`, `90° = Este`, `180° = Sur`, `270° = Oeste`.
   - Vector 3D topocéntrico (`enu_vector: [east, north, up]`):
     - `east  = cos(el) * sin(az)`
     - `north = cos(el) * cos(az)`
     - `up    = sin(el)`
3. **Límites de consulta**:
   - `step_minutes`: permitido entre `30` y `180` minutos.
   - Duración (`end_utc - start_utc`): mínimo `1 h`, máximo `336 h` (14 días).
   - `delay_hours`: permitido entre `0` y `24` horas.
   - `clearance_deg`: permitido entre `0.0` y `15.0` grados.
4. **Criterio geométrico de visibilidad**:
   - Sol (A): `sun_visible = sun_elevation_deg > local_horizon_deg`
   - Tierra (B): `earth_visible = earth_elevation_deg > local_horizon_deg + clearance_deg`
   - En modo `flat`, `local_horizon_deg = 0.0`.
   - En modo `terrain`, si el servicio común de horizonte (`api/app/core/horizon.py`) no está verificado o disponible para el sitio, el backend **no bloquea la respuesta ni altera silenciosamente la preferencia del usuario**: mantiene `requested_horizon_mode = "terrain"`, aplica `effective_horizon_mode = "flat"` (`0.0°`) y devuelve `quality = "terrain_unavailable"` con aviso explícito (`Terrain horizon unavailable`).

## 2. Endpoints de Integrante B

- `GET /api/earth` y `POST /api/earth`: serie temporal de visibilidad terrestre, ventanas `[start_utc, end_utc)`, métricas (`earth_visible_hours`, `earth_visible_fraction`, `longest_earth_blackout_hours`), vectores 3D ENU (`enu_vector`), malla 3D local LOLA (`terrain_mesh_3d`) y metadatos de calidad y procedencia.
- `POST /api/compare`: agregador de comparación entre 2 sitios (`site01`, `site04`) combinando la serie solar (`SolarServiceProtocol`) y la serie terrestre (`EarthService`) para las mismas fechas, paso, modo de horizonte y escenario de retraso (`delay_hours`).
