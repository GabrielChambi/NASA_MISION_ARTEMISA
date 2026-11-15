# Misión automática de LUNAR ORACLE

`UnifiedMissionPlanner` reúne solicitud, mapa y resultados en una sola experiencia. Una pregunta desencadena la interpretación y el cálculo científico, sin elegir primero un pequeño parche ni pasar a otra pantalla técnica.

## De una pregunta a un plan

> Si quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am, ¿dónde sería bueno caer y cuánto tardaría la misión?

1. `POST /api/mission-intent` extrae fecha, hora, significado de la fecha y restricciones. Gemini interpreta; no decide coordenadas ni inventa mediciones.
2. La interfaz llama automáticamente a `POST /api/automatic-plan` con la intención validada.
3. El motor obtiene de JPL la distancia Tierra–Luna para estimar el tránsito y solicita Sol/Tierra para la llegada y estancia calculadas.
4. Recorre las 12.892 celdas con centro preparado del casquete 80–90°S. Evalúa pendiente P95 y máxima, cobertura y horizonte propio. Calcula Sol/Tierra para cada celda con datos suficientes, incluidas las descartadas por pendiente, de modo que la inspección no se limite a los candidatos.
5. Devuelve la tabla completa de mediciones y una capa continua de clasificación con contornos sobre el relieve 3D. Los marcadores del mejor candidato y sus alternativas son referencias adicionales. Cualquier sector se puede seleccionar directamente o por coordenadas.

Los visitantes no necesitan iniciar sesión con ChatGPT ni Google. La clave del proveedor pertenece al servidor.

### Intención y supuestos visibles

«Viaje» o «salida» significa partida de la Tierra; «alunizar» o «llegar» significa llegada a la Luna. La zona predeterminada es `America/La_Paz`, UTC−04:00. UTC o un desplazamiento ISO explícito tiene prioridad y la interpretación queda visible.

Si no indicas estancia, se utilizan **72 horas en la superficie como hipótesis editable**. Preguntar cuánto dura la misión no fija esa estancia. Los valores predeterminados de pendiente y visibilidad también son editables. Los requisitos explícitos del texto tienen prioridad sobre los predeterminados. Cambiar la solicitud o sus requisitos invalida los resultados y requiere recalcular. Los requisitos explícitos incompatibles con la estancia se muestran para corregirlos: no se recortan en silencio para obtener una solución.

Si falta la fecha completa, se pide ese dato. Si no indicas hora, se asumen las 08:00 en la zona indicada y se declara como hipótesis editable. Fechas imposibles y requisitos contradictorios no se corrigen en silencio. Si Gemini falta, falla o devuelve una extracción inválida, se usa el parser determinista y se informa `mode: "parser"`; no se simula IA.

## Terreno y horizontes de todo el casquete

| Elemento | Método y alcance |
| --- | --- |
| Terreno | DEM original NASA LOLA/PGDA de 80 m |
| Comparación regional | 12.892 zonas; espaciado de 4,75 km |
| Pendiente | P95 desde píxeles nativos, con corrección de escala de la proyección |
| Horizonte | Perfil propio por zona; 72 azimuts separados 5° |
| Observador | 2 m sobre elevación local; geometría esférica lunar |
| Muestreo radial | Cada 80 m hasta 2 km; 250 m hasta 20 km; 1 km hasta 250 km |
| Cuantización | Hacia arriba en pasos de 0,05°, conservando la obstrucción muestreada |
| Cobertura mínima | Terreno cercano completo en las direcciones preparadas y alcance válido de al menos 20 km por dirección muestreada |
| Cobertura distante | Parcial y variable; no se extrapola fuera del DEM |
| Desconocidos | Se conservan; nunca se sustituyen por un horizonte plano |

Fuente regional: [DEM NASA LOLA de 80 m](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF). Los [productos locales de 5 m](https://pgda.gsfc.nasa.gov/products/78) son conjuntos distintos y sus errores no se trasladan como barras de error al DEM regional. `global_horizons.json` conserva URL y SHA-256 del DEM, que debe coincidir con el catálogo regional. `prepare_global_horizons.py` genera horizontes distintos desde el TIFF original; no copia un horizonte central a todo el casquete.

El umbral de 20 km no prueba que se conozcan todos los obstáculos lejanos. Los rayos que salen del casquete pierden cobertura y las muestras pueden omitir obstáculos intermedios. Tampoco se resuelven peligros menores de 80 m. Una zona favorable necesita estudio local y análisis de la nave.

### Sol, Tierra y clasificación

Las series de [NASA/JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html) usan un observador lunar de referencia en −90°, 0° y cadencia horaria. Vectores aparentes y distancias se trasladan geométricamente al marco este–norte–arriba de cada zona. Se comparan con su horizonte, interpolado entre muestras azimutales.

El ejemplo usa tres series originales: Tierra para el tránsito y Sol/Tierra para la estancia. La caché sólo se reutiliza si coincide la petición; otra fecha o intervalo puede requerir conexión a NASA. Se conservan parámetros, URL, fecha de recuperación y respuesta original.

El criterio nominal exige pendiente P95 bajo el límite configurado, más de 0,3° de despeje del centro del Sol y la Tierra al llegar y las horas mínimas durante la estancia. El máximo nativo de pendiente se conserva y se muestra, pero no sustituye silenciosamente el criterio P95. Por ejemplo, el candidato `polar:5:56` tiene P95 de 9,4889° y máximo de 16,1644°: cumplir P95 ≤ 10° no demuestra que todo el sector esté por debajo de 10°.

Los intervalos horarios son `[inicio, fin)`; la muestra final sirve para la gráfica y no añade una hora. El paso temporal limita la resolución de las transiciones. La iluminación del mapa base es ilustrativa; las variables de misión proceden de las series calculadas.

### Clases y sensibilidad angular

Para cada azimut del Sol o la Tierra se evalúan:

- Horizonte nominal: interpolación entre los dos azimuts de horizonte vecinos.
- Escenario con mayor obstrucción: máximo de esas dos muestras.
- Escenario con menor obstrucción: mínimo de las muestras menos el paso de cuantización de 0,05°, porque el archivo redondea hacia arriba.

Se calculan horas nominales, intervalos de sensibilidad de horas, despeje al llegar e interrupciones. La clasificación utiliza:

| Clase | Regla |
| --- | --- |
| Verde | Cumple terreno y visibilidad incluso con el escenario de mayor obstrucción muestreada |
| Amarillo | El cumplimiento cambia entre los escenarios angulares, o sólo cumple el escenario nominal |
| Rojo | Falla la pendiente P95 o los requisitos tampoco se satisfacen con el escenario de menor obstrucción |
| Gris | Faltan terreno o perfiles de horizonte suficientes, sin un descarte estático concluyente |

Estos escenarios **no son intervalos estadísticos ni cotas completas de incertidumbre física**. No acotan picos entre azimuts, obstáculos entre muestras radiales, error del DEM, huella, energía ni enlace de radio. Una región verde sigue siendo candidata a un estudio local.

El orden prioriza verdes; después compara la peor fracción nominal de horas Sol/Tierra, interrupciones, margen de llegada y pendiente. Las alternativas se separan al menos 30 km. Si no hay verdes, no se fuerza una recomendación de esa clase ni se relajan los requisitos; el resultado más próximo puede seguir siendo amarillo o rojo.

### Área física y borde sin resolver

Para coordenadas proyectadas x, y y radio R, el elemento de área es:

~~~text
dA = dx dy / [1 + (x² + y²)/(4R²)]²
~~~

El motor integra el jacobiano mediante cuadratura Gauss de ocho puntos y recorta los cuadrados contra el límite circular de 80°S. Contar cuadrados completos como si todos estuvieran dentro del casquete daría una cobertura incorrecta.

| Magnitud | Área del caso actual |
| --- | --- |
| Casquete teórico 80–90°S | 288.138,649 km² |
| Cuadrados recortados con centro preparado | 287.392,894 km² |
| Borde sin centro preparado | 745,754 km² |
| Verde en el ejemplo | 198,092 km² |
| Amarillo en el ejemplo | 34,029 km² |
| Rojo en el ejemplo | 285.153,531 km² |
| Desconocido, incluidos centros y borde | 2.752,996 km² |

Las cifras se redondean para presentación. `coverage.by_class` conserva fracciones respecto al casquete; el área gris incluye el borde no representado. El contador sigue indicando **12.892 centros**, de los que 95 tienen datos insuficientes para la evaluación de misión del ejemplo. El borde no se convierte en una recomendación por copiar una celda vecina.

El [estudio completo](SOUTH_POLE_SURFACE_ANALYSIS.md) desarrolla esta geometría y relaciona el criterio con fuentes primarias de NASA.

## Qué se ve en la Luna

El relieve NASA cubre el casquete y la vista **Evaluación** superpone el campo de clases completo mediante colores y contornos. La vista **Relieve** permite ver el terreno sin esa clasificación. El color de evaluación depende de los requisitos y de la fecha; no se deduce de la altura o del aspecto del terreno.

Los marcadores destacan centros recomendados. Las clases rojas y amarillas se muestran sobre la superficie, en vez de quedar representadas por una lista de círculos aislados. El gris identifica datos insuficientes y el borde sin evaluación preparada.

Un clic en cualquier sector usa su fila y columna de la rejilla; no escoge el marcador cercano. También se pueden introducir coordenadas exactas en el inspector. La inspección conserva elevación, P95 y máximo de pendiente, área, cobertura, clase y razones. Si hay un perfil suficiente, obtiene la serie temporal de ese centro mediante `POST /api/automatic-plan/cell`.

Ese endpoint valida el identificador, descodifica sólo su perfil y evalúa **una celda**, sin repetir el estudio de las 12.892. Devuelve `{status, mission, cell, meta}`, donde `cell.time_series` pertenece al sector solicitado. Sin un perfil suficiente, la serie queda vacía y el sector no se presenta como favorable. Puede seguir rojo si la pendiente conocida basta para descartarlo; en otro caso queda desconocido. Nunca se reemplaza por la serie del mejor candidato.

**Condiciones durante tu estancia** permite recorrer cada hora y observar el despeje del Sol y la Tierra. **Simular llegada a este destino** anima un descenso vertical con gravedad, masa, empuje y combustible de una nave hipotética. No sustituye el diseño orbital ni el estudio de peligros. La descarga incluye la tabla completa y la procedencia de los cálculos.

## Duración estimada y caso reproducible

La distancia Tierra–Luna de JPL alimenta una transferencia elíptica ideal de dos cuerpos desde una órbita terrestre de 200 km. Se usa el [parámetro gravitatorio terrestre de JPL](https://ssd.jpl.nasa.gov/astro_par.html). No se calcula una ventana real de lanzamiento ni una trayectoria Artemis.

Si se indica salida, la llegada ideal se redondea hacia arriba a la siguiente hora para alinearla con las series de visibilidad. Si se indica alunizaje, se conserva ese instante y se estima la salida restando el tránsito. El regreso usa la misma duración ideal de ida como supuesto simétrico; no se calcula su trayectoria independiente.

Datos de [automatic_example.json](../data/prepared/automatic_example.json):

| Dato | Resultado |
| --- | --- |
| Solicitud | 25 dic 2026 · 08:00 Bolivia |
| Salida | `2026-12-25T12:00:00Z` |
| Distancia de referencia | 357.972,60 km |
| Tránsito ideal | 107,5649 h |
| Ajuste de llegada | +26,11 min |
| Llegada analizada | `2026-12-30T00:00:00Z` |
| Ida tras el ajuste | 108 h |
| Estancia | 72 h |
| Fin de estancia | `2027-01-02T00:00:00Z` |
| Retorno ideal simétrico | 107,5649 h |
| Regreso estimado | `2027-01-06T11:33:53Z` |
| Total estimado | 287,5649 h ≈ 12 días |
| Verde / amarillo / rojo / centros desconocidos | 9 / 2 / 12.786 / 95 |
| Mejor candidato | `polar:5:56`, −80,78120657°, −7,30575953° |
| Visibilidad del candidato | 46 h de Sol; 72 h de Tierra |

Requisitos de ese caso: pendiente máxima de 10°, mínimos de 12 h de Sol y Tierra visible y estancia de 72 h. La longitud negativa corresponde a unos 7,3058° oeste. «Mejor» significa primero en este orden regional; no implica aprobación de NASA.

La duración no incluye preparación, esperas, maniobras detalladas, ascenso lunar, encuentro orbital, reentrada ni contingencias. La animación vertical no convierte esta estimación en una misión físicamente diseñada.

## Validación y reproducción

Con las dependencias instaladas y `npm.cmd run dev:full` iniciado:

~~~powershell
npm.cmd run test:science
api/.venv/Scripts/python.exe -m pytest api/tests -q
$env:LUNAR_ORACLE_TEST_URL='http://127.0.0.1:5173/'
node frontend/scripts/test-surface-coverage.mjs
node frontend/scripts/validate-surface-parity.mjs
node frontend/scripts/test-automatic-mission.mjs
node frontend/scripts/test-live-plan.mjs
~~~

Las pruebas de navegador requieren Chrome. Verifican el campo de superficie, selección de sectores sin marcador, inspector de coordenadas, fuentes, cambio de fecha y variables, condiciones, descenso y móvil. `test-live-plan.mjs` usa el 26 de diciembre de 2026, fuera del ejemplo incluido, y exige tres consultas trazables.

El intérprete determinista es un respaldo explícito y válido cuando Gemini no está disponible. Para una prueba que exija inferencia real de Gemini, configura `LUNAR_ORACLE_REQUIRE_AI=1` además de la clave del servidor. La prueba no presenta el respaldo como IA.

Las suites científicas cubren conservación de área, borde desconocido, sensibilidad angular, series en sectores descartados, selección de una celda y requisitos contradictorios. Los resultados de Python y Worker se han comparado en las 12.892 celdas, incluidos clase, horas y sensibilidad.

La API local comprime las respuestas grandes cuando el navegador admite gzip; se conservan filas de datos legibles y completas. No es necesario publicar para probar este flujo. La vista previa Worker sigue disponible con `npm.cmd run build:hosted` y `npm.cmd --prefix frontend run preview:hosted`, en el puerto 4173.

La caché de JPL es opcional y exige parámetros exactos. Si falla por permisos, lectura o escritura, se consulta NASA; si NASA no responde, se informa sin fabricar resultados.

~~~powershell
api/.venv/Scripts/python.exe api/scripts/prepare_automatic_example.py
api/.venv/Scripts/python.exe api/scripts/validate_global_reference.py
~~~

El segundo comando consulta directamente JPL en tres celdas seleccionadas, para Sol y Tierra y tres horas de una fecha. Compara esos ángulos con la traslación del observador polar. El [informe guardado](validation/global-reference-validation.json) registra las consultas originales y una separación angular máxima de aproximadamente `3,52 × 10⁻⁶°` en esa muestra.

La comprobación valida esa muestra de traslación del observador. No valida todos los lugares, fechas, horizontes ni la realización completa del marco lunar; la validación independiente con SPICE sigue pendiente.

### Archivos del flujo actual

| Función | Archivos |
| --- | --- |
| Interfaz única | `frontend/src/features/mission/UnifiedMissionPlanner.tsx` |
| Tipos | `frontend/src/features/mission/automaticTypes.ts` |
| Campo de superficie | `frontend/src/features/tactical/PolarCoverageLayer.tsx` |
| Inspección individual | `POST /api/automatic-plan/cell` |
| Intérprete | `api/app/mission_intent.py`, `frontend/worker/mission-intent.mjs` |
| Planificador | `api/app/automatic_plan.py`, `frontend/worker/automatic-plan.mjs` |
| Horizontes | `api/scripts/prepare_global_horizons.py`, `data/prepared/global_horizons.json` |
| Ejemplo | `api/scripts/prepare_automatic_example.py`, `data/prepared/automatic_example.json`, `data/prepared/ephemeris/` |
| Comparación JPL | `api/scripts/validate_global_reference.py`, `docs/validation/global-reference-validation.json` |
| Navegador | `frontend/scripts/test-surface-coverage.mjs`, `frontend/scripts/test-automatic-mission.mjs`, `frontend/scripts/test-live-plan.mjs` |

Las APIs anteriores se conservan para compatibilidad y auditoría; no forman un segundo flujo de la interfaz principal.

El siguiente trabajo científico consiste en ampliar y validar horizontes, propagar incertidumbres y añadir peligros locales, energía, temperatura, radio y trayectorias completas. El sistema usa datos reales con modelos regionales acotados: **no es un gemelo digital certificado**.

La [verificación de paridad](validation/surface-parity.json) compara las 12.892 celdas y diez campos entre Python y JavaScript usando las mismas tres respuestas originales de NASA, sin conexión. Comprueba consistencia de implementaciones y cierre de áreas; no es una certificación independiente de seguridad.


## Responder a una misión sin candidatos favorables

POST /api/mission-rescue recibe los mismos parámetros que el planificador y un límite search_days de 1 a 14 días. La interfaz lo invoca automáticamente cuando el mapa no contiene candidatos verdes. Una fecha ya viable no dispara esta búsqueda adicional.

El motor primero separa los sectores con terreno compatible y horizonte suficiente. Las zonas desconocidas se diagnostican como falta de datos, y las pendientes que incumplen permanecen descartadas: cambiar la fecha no cambia el relieve. La búsqueda usa ese conjunto elegible, no presenta su conteo como una reevaluación de todos los centros del casquete.

Tres series por lotes de JPL aportan la distancia Tierra–Luna para cada partida y Sol/Tierra para las llegadas y estancias. Las partidas explícitas conservan sus minutos; la llegada usa el redondeo horario declarado por el modelo de transferencia. Una fecha explícita de alunizaje conserva su minuto original. No se interpolan filas NASA ni se reemplaza una consulta por otra con fase temporal distinta.

Se examinan inicios diarios dentro del límite y se refinan las 23 horas anteriores al primer inicio diario favorable. El máximo es 38 escenarios. La clasificación conserva el análisis de sensibilidad angular del motor existente. Las alternativas mantienen pendiente, estancia, horas requeridas y altura: sólo proponen cambiar la fecha. El orden y las etiquetas se refieren a escenarios efectivamente probados, no a todos los instantes o a un óptimo global.

El JSON incluye diagnóstico, parámetros originales, propuestas, cambios, fechas realmente probadas y URLs de las tres consultas NASA. La aplicación posterior vuelve a calcular el mapa completo con consultas canónicas del escenario elegido. El texto del formulario se actualiza a esa nueva fecha y la solicitud original queda en adopted_alternative.original_text del archivo exportado. No se mezclan el mapa de una fecha con las métricas de otra.

El caso guardado en ../data/prepared/rescue_example.json reproduce la solicitud del 1 de diciembre de 2026 a las 10:00 Bolivia. El primer inicio favorable entre los evaluados es 7 dic 12:00 Bolivia (+146 h), con llegada 12 dic 20:00 Bolivia. La aplicación exacta devuelve un candidato verde y 72 h de visibilidad nominal de Sol y Tierra. El P95 de ese sector es 9,9843°, cercano al umbral de 10°: cumplir esta preselección regional no resuelve peligros locales ni incertidumbre de pendiente.

La interfaz informa búsqueda detenida, falta de datos o fallo de la fuente sin fabricar alternativas. Cancelar o cambiar la solicitud retira los resultados pendientes; una respuesta anterior no se aplica sobre nuevos criterios.

### Ventanas para operar

getOperationalWindows calcula intervalos de despeje por encima del margen de 0,3° para Sol, Tierra y ambos simultáneamente. El último punto es el límite del intervalo y no suma una hora adicional. Un cambio observado devuelve el intervalo entre muestras, mientras que la ausencia de un cambio sólo se informa hasta el fin de los datos. Muestras ausentes permanecen desconocidas; no significan bloqueo ni visibilidad.

Los contadores tienen resolución horaria y pueden omitir cortes breves entre muestras. No representan producción eléctrica, temperatura, potencia recibida o capacidad de transmisión. Esos estados requieren modelos de recursos y parámetros de una nave, identificados como fases siguientes en DECISION_SUPPORT_AND_TWIN_ROADMAP.md.

Validación adicional:

~~~powershell
node frontend/scripts/test-mission-rescue.mjs
~~~

Este recorrido utiliza el caso NASA real, aplica la alternativa al mapa completo, comprueba que una nueva planificación conserva la fecha adoptada, verifica ventanas y fin de datos, y prueba cancelación, error de fuente, respuestas antiguas y móvil.


## Extensión operativa y reloj de lanzamiento

El origen predeterminado de la interfaz es Kennedy LC-39B con horario de Florida o UTC. Los ejemplos históricos de Bolivia de este documento conservan sus instantes mediante offsets explícitos. El mapa regional se complementa con [energía, fallos, huella y alturas nativas](MISSION_OPERATIONS.md), ejecutados por la API local sobre los TIFF originales.
