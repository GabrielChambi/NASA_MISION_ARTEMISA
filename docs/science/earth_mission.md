# Visibilidad terrestre y módulos avanzados

La implementación actual utiliza el servicio común de NASA descrito en [mission_planner.md](mission_planner.md). Esta revisión sustituye las coordenadas y ejemplos del primer Plan B: las regiones contienen muchos píxeles, pero la aplicación evalúa los dos puntos del catálogo compartido.

| Punto | Latitud | Longitud este | Elevación | Altura del observador de ejemplo |
| --- | --- | --- | --- | --- |
| Site01 | −89,46315776° | 222,49801509° | 1944,767 m | 2 m |
| Site04 | −89,76674148° | 188,10719092° | 767,979 m | 2 m |

NASA/JPL Horizons usa observador topocéntrico lunar coord@301, target 399, coordenadas geodésicas con elevación + altura. Q4 proporciona azimut/elevación aparente sin refracción; Q20 aporta distancia y velocidad radial medidas. La URL original, instante de recuperación y caché acompañan el resultado. El núcleo valida la rejilla UTC completa, el cuerpo y el marco mean-Earth.

## Resultado de contraste guardado

A las 00:00 UTC del 14 de diciembre de 2026, con observador 2 m:

| Punto | Azimut Tierra | Elevación Tierra | Distancia Tierra |
| --- | --- | --- | --- |
| Site01 | 133,057924° | −1,436344° | 403 241,38 km |
| Site04 | 167,454807° | −1,297333° | 403 237,14 km |

Son regresiones contra respuestas originales NASA, no una validación con un segundo motor. Los seis contrastes JPL independientes del núcleo se conservan en data/prepared/validation.json. El contraste SPICE del marco sigue pendiente.

## Terreno, ventanas y comparación

El criterio es elevación del centro terrestre > horizonte LOLA + margen. Se mantiene la igualdad como oculta y los intervalos semiabiertos con muestra izquierda. El horizonte es parcial y depende de la altura. Si falta, se devuelve error; no se ofrece horizonte plano como sustitución.

GET /api/earth entrega el contrato común. POST /api/earth conserva EarthResponse del módulo avanzado: 72 muestras para 72 intervalos horarios y las métricas de la misma serie NASA que GET presenta con 73 puntos incluyendo el extremo final. Las mallas avanzadas usan el derivado local común de 65 × 65.

POST /api/compare usa idénticos parámetros para ambos astros y lugares, intersección de ventanas y escenarios con nuevas fechas. La regla de ranking se declara en su respuesta; no certifica seguridad.

Los controles avanzados comparten la misión y los criterios con el inicio. Se invalidan respuestas anteriores al cambiar parámetros. El antiguo archivo seed_ephemeris.json y los recortes 21 × 21 se conservan como material histórico, fuera de las rutas activas.

Ver Tierra no garantiza enlace RF: faltan estación, antena, potencia, presupuesto de enlace y operación. Los colores de elevación no son hielo ni luz instantánea.
