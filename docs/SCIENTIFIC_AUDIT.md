# Auditoría científica · 15 de noviembre de 2026

**Estado: modelo de planificación con datos NASA y supuestos declarados. No se ha validado como gemelo digital operacional ni como herramienta de seguridad de vuelo.** No se puede asegurar ausencia total de errores.

Esta revisión contrasta código, datos originales y casos de prueba; corrige defectos concretos. No constituye revisión independiente por NASA ni cumplimiento certificado de NASA-STD-7009B.

## Defectos encontrados y corregidos

### Sustitución de escenarios por una demostración

El recurso operativo devolvía HTTP 200 y resultados de Site01 al faltar rasters o efemérides del escenario solicitado. Esa sustitución podía mantener el identificador del destino pedido, usar otras fechas, fijar distancias medias y declarar una alternativa con cifras constantes y requisitos satisfechos.

Se eliminaron las funciones de demostración y la sustitución automática. Ante ausencia de rasters o fallo de JPL, análisis y replanificación devuelven HTTP 503, un código de causa, un mensaje claro y ninguna propuesta. No se generan presupuestos, huellas ni alternativas favorables.

Ocho casos de prueba reproducen las dos causas en ambos recursos e idiomas. Fallaban antes de la corrección. Las respuestas NASA válidas almacenadas para el intervalo y observador exactos siguen siendo utilizables; no se sustituyen por un ejemplo de otro escenario.

### Caché opcional que podía bloquear una respuesta real

Una respuesta JPL ya validada se perdía si fallaba su escritura en disco. Ahora la caché es opcional: su fallo no cambia los valores recibidos ni los reemplaza. La prueba usa una respuesta NASA original y fuerza una excepción de permisos al escribir.

### Radio visual y parámetros de vehículos

El círculo del rover se describía como retorno seguro sin calcular trayecto, terreno, batería o maniobras. Ahora se presenta como **radio geométrico declarado, sin ruta validada**. Su anillo interior es una referencia de media distancia, no una reserva comprobada de retorno.

El estudio 3D muestra que sus parámetros son hipotéticos. El catálogo conserva nombres e ilustraciones, pero sus alturas, velocidades, radios y límites configurados no se atribuyen a fichas técnicas verificadas. Ningún dibujo prueba capacidades físicas del vehículo.

## Qué se comprobó y qué no

| Subsistema | Evidencia revisada | Alcance y límite |
| --- | --- | --- |
| Posiciones Sol/Tierra | Consultas originales JPL, marcos, UTC, distancias, consultas directas a otros observadores | Concordancia en los casos enumerados; no validación independiente completa con SPICE |
| Traslación regional | Tres centros, tres épocas por cuerpo; 18 comparaciones | Diferencia angular máxima aproximada de 0,00000352°; no es una cota para todo el polo ni para todas las fechas |
| Alturas de panel/antena | Un punto, cinco épocas por cuerpo, alturas de 50 m y 38 m | Máxima diferencia de azimut/elevación aproximada de 0,000002074° en esas diez comparaciones |
| DEM y pendientes | Hashes de rasters NASA, geometría esférica, pendiente nativa y cobertura | Resoluciones nativas de 80 m y 5 m donde hay cobertura; rocas y relieve subpíxel sin resolver |
| Horizontes | Perfiles por centro y altura, curvatura y datos ausentes | Muestreo angular y radial finito; cobertura lejana parcial; errores completos sin propagar |
| Transferencia | Semiperíodo elíptico ideal, GM terrestre JPL, estacionamiento a 200 km | Estimación de dos cuerpos; no calcula ascenso, encuentro lunar, inserción, combustible ni ventana de lanzamiento |
| Retorno | Misma duración ideal que la ida | Hipótesis de itinerario; no trayectoria de regreso calculada |
| Energía | Irradiancia nominal a 1 AU, distancia al cuadrado, orientación, ocultación por discos, cargas y eficiencias | Modelo eléctrico concentrado de diseño; no mide el Sol futuro ni valida condiciones térmicas |
| Conservación | Casos analíticos y doce escenarios reproducibles con sombra, fallos y batería variable | Residual de energía menor de 1e-7 Wh y cierre de datos a 1e-10 GB en esos casos; verifica contabilidad numérica, no parámetros físicos de una nave |
| Comunicaciones | Geometría de despeje y transmisión con tasa declarada | No presupuesto RF, patrón de antena, red de estaciones, apuntado ni disponibilidad de DSN |
| Descenso | Gravedad central lunar, variación de masa y RK4; pruebas existentes de convergencia e impacto | Nave hipotética en descenso vertical; no navegación lateral, gravedad lunar armónica, propulsión calibrada ni diseño de misión |
| Rover | Disco geométrico con valor declarado | No ruta, terramecánica, consumo, obstáculos ni autonomía verificada |
| IA | Parámetros estructurados y respuestas limitadas por evidencia | No fuente de mediciones, efemérides o prestaciones; una respuesta del modelo requiere validación |

Los informes completos conservan las épocas y consultas: [referencia regional](validation/global-reference-validation.json) y [altura del observador](validation/operations-observer-validation.json). Los desacuerdos angulares pequeños no validan DEM, estabilidad, energía, temperaturas ni la misión completa.

## Diferencia entre verificar y validar

Las pruebas pueden comprobar que el software resuelve un modelo y rechaza entradas incompatibles. Para confiar en sus predicciones también se necesita contrastar el modelo con datos físicos independientes y definir criterios de aceptación acordes con su uso.

[NASA-STD-7009B](https://standards.nasa.gov/sites/default/files/standards/NASA/B/1/NASA-STD-7009B-Final-3-5-2024.pdf) establece prácticas sobre modelos, simulaciones, verificación, validación, sensibilidad e incertidumbre. Se usa aquí como referencia metodológica; no se afirma su cumplimiento. [NASA Systems Engineering: Product Verification](https://www.nasa.gov/reference/5-3-product-verification/) distingue el propósito de esas comprobaciones.

## Trabajo necesario para un gemelo digital operacional

1. Identificar una nave real y su configuración, con procedencia verificable de masa, empuje, batería, paneles, antenas, autonomía y tolerancias. Los valores del catálogo no sustituyen esa información.
2. Calibrar y actualizar el modelo con telemetría o ensayos del sistema físico, con tiempos, unidades, incertidumbres y trazabilidad. Actualmente no hay una nave física conectada ni asimilación de su estado.
3. Incorporar termodinámica, batería dependiente de temperatura, RF y red de comunicaciones, trayectorias y guiado; validar cada modelo frente a referencias independientes.
4. Completar validación de marcos con SPICE, incertidumbres y sensibilidad conjuntas, comparación sobre muchas fechas y ubicaciones, y convergencia espacial/temporal.
5. Definir aceptación para cada decisión y revisión externa. Un resultado de hackatón no autoriza un vuelo.

Hasta entonces, el uso defendible es comparar hipótesis de planificación, comprender condiciones y señalar qué falta comprobar. No promete un sitio seguro ni una misión viable en la realidad.

## Fuentes físicas primarias

- [JPL Astrodynamic Parameters](https://ssd.jpl.nasa.gov/astro_par.html): GM y unidades; Tierra 398600,435507 km³/s² y Luna 4902,800118 km³/s².
- [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html): observadores y efemérides.
- [NASA Solar Irradiance Science](https://earth.gsfc.nasa.gov/climate/projects/solar-irradiance/science): referencia nominal solar y su variabilidad.
- [NASA LOLA landing-region products](https://pgda.gsfc.nasa.gov/products/78): terreno y productos de alta resolución.
- [NASA Glenn: specific impulse](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/): relación entre empuje, caudal másico e impulso específico.

## Reproducir

~~~powershell
api/.venv/Scripts/python.exe -m pytest api/tests -q
npm.cmd run test:science
api/.venv/Scripts/python.exe api/scripts/validate_global_reference.py
api/.venv/Scripts/python.exe api/scripts/validate_operations_observer.py
npm.cmd run dev:full
node frontend/scripts/test-mission-operations.mjs
node frontend/scripts/test-lunar-studio.mjs
~~~

Las consultas se pueden satisfacer con registros originales guardados que correspondan exactamente a los parámetros; eso no cambia el alcance de la comparación. Las pruebas de fallo no consultan NASA: inyectan una indisponibilidad para comprobar que no se fabrique un resultado.

La [evidencia de la revisión](validation/scientific-integrity-audit.json) registra pruebas y limitaciones de este estado del código.
