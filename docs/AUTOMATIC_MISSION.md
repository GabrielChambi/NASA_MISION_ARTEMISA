# Misión automática de LUNAR ORACLE

`UnifiedMissionPlanner` reúne solicitud, mapa y resultados en una sola experiencia. Una pregunta desencadena la interpretación y el cálculo científico, sin elegir primero un pequeño parche ni pasar a otra pantalla técnica.

## De una pregunta a un plan

> Si quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am, ¿dónde sería bueno caer y cuánto tardaría la misión?

1. `POST /api/mission-intent` extrae fecha, hora, significado de la fecha y restricciones. Gemini interpreta; no decide coordenadas ni inventa mediciones.
2. La interfaz llama automáticamente a `POST /api/automatic-plan` con la intención validada.
3. El motor obtiene de JPL la distancia Tierra–Luna para estimar el tránsito y solicita Sol/Tierra para la llegada y estancia calculadas.
4. Compara las 12.892 zonas del casquete 80–90°S. Descarta primero el terreno que excede la pendiente; para las zonas restantes comprueba su propio horizonte y las condiciones del intervalo.
5. Devuelve la clasificación completa, el mejor candidato disponible, hasta tres alternativas separadas y hasta ocho ejemplos descartados. Aparecen sobre el mismo relieve 3D.

Los visitantes no necesitan iniciar sesión con ChatGPT ni Google. La clave del proveedor pertenece al servidor.

### Intención y supuestos visibles

«Viaje» o «salida» significa partida de la Tierra; «alunizar» o «llegar» significa llegada a la Luna. La zona predeterminada es `America/La_Paz`, UTC−04:00. UTC o un desplazamiento ISO explícito tiene prioridad y la interpretación queda visible.

Si no indicas estancia, se utilizan **72 horas en la superficie como hipótesis editable**. Preguntar cuánto dura la misión no fija esa estancia. Los valores predeterminados de pendiente y visibilidad también son editables. Los requisitos explícitos del texto tienen prioridad sobre los predeterminados. Cambiar la solicitud o sus requisitos invalida los resultados y requiere recalcular.

Si falta fecha completa u hora, se pide ese dato. Fechas imposibles y requisitos contradictorios no se corrigen en silencio. Si Gemini falta, falla o devuelve una extracción inválida, se usa el parser determinista y se informa `mode: "parser"`; no se simula IA.

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

Fuente: [NASA LOLA/PGDA, producto 78](https://pgda.gsfc.nasa.gov/products/78). `global_horizons.json` conserva URL y SHA-256 del DEM, que debe coincidir con el catálogo regional. `prepare_global_horizons.py` genera horizontes distintos desde el TIFF original; no copia un horizonte central a todo el casquete.

El umbral de 20 km no prueba que se conozcan todos los obstáculos lejanos. Los rayos que salen del casquete pierden cobertura y las muestras pueden omitir obstáculos intermedios. Tampoco se resuelven peligros menores de 80 m. Una zona favorable necesita estudio local y análisis de la nave.

### Sol, Tierra y clasificación

Las series de [NASA/JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html) usan un observador lunar de referencia en −90°, 0° y cadencia horaria. Vectores aparentes y distancias se trasladan geométricamente al marco este–norte–arriba de cada zona. Se comparan con su horizonte, interpolado entre muestras azimutales.

El ejemplo usa tres series originales: Tierra para el tránsito y Sol/Tierra para la estancia. La caché sólo se reutiliza si coincide la petición; otra fecha o intervalo puede requerir conexión a NASA. Se conservan parámetros, URL, fecha de recuperación y respuesta original.

Para ser favorable, una zona debe respetar la pendiente, tener más de 0,3° de despeje del centro del Sol y la Tierra al llegar y cumplir las horas mínimas durante la estancia. Los intervalos horarios son `[inicio, fin)`; la muestra final sirve para la gráfica y no añade una hora. Las transiciones tienen incertidumbre de hasta una muestra.

El orden prioriza cumplimiento y después la peor fracción de horas Sol/Tierra, interrupciones, margen de llegada y pendiente. Las alternativas se separan al menos 30 km. Si ninguna cumple, se informa sin forzar un candidato verde ni relajar requisitos.

## Qué se ve en la Luna

El relieve gris es continuo en todo el casquete. Su color describe terreno, no aptitud. Acercar destino añade detalle visual del mismo terreno sin insertar una pequeña superficie blanca sobre otra amarilla o azul.

- **Círculo destacado:** mejor candidato bajo los criterios calculados.
- **Círculos verdes:** hasta tres alternativas favorables.
- **Círculos rojos:** hasta ocho ejemplos descartados; el contador incluye todos los descartes.
- **Desconocidos:** se cuentan por separado; no se declaran favorables.

Los círculos son ubicaciones regionales, no huellas certificadas ni límites físicos de una zona segura. Tocar un destino muestra razones y mediciones. La descarga incluye todos los resultados, aunque el mapa sólo muestre una selección.

**Condiciones durante tu estancia** permite recorrer cada hora y observar el despeje del Sol y la Tierra. **Simular llegada a este destino** anima un descenso vertical con gravedad, masa, empuje y combustible de una nave hipotética. No sustituye el diseño orbital ni el estudio de peligros.

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
| Favorables / descartadas / desconocidas | 11 / 12.786 / 95 |
| Mejor candidato | `polar:5:56`, −80,78120657°, −7,30575953° |
| Visibilidad del candidato | 46 h de Sol; 72 h de Tierra |

Requisitos de ese caso: pendiente máxima de 10°, mínimos de 12 h de Sol y Tierra visible y estancia de 72 h. La longitud negativa corresponde a unos 7,3058° oeste. «Mejor» significa primero en este orden regional; no implica aprobación de NASA.

La duración no incluye preparación, esperas, maniobras detalladas, ascenso lunar, encuentro orbital, reentrada ni contingencias. La animación vertical no convierte esta estimación en una misión físicamente diseñada.

## Validación y reproducción

Desde la raíz, con dependencias instaladas:

~~~powershell
npm.cmd run test:science
api/.venv/Scripts/python.exe -m pytest api/tests -q
npm.cmd run build:hosted
npm.cmd --prefix frontend run preview:hosted
~~~

Las suites Node y Python cubren datos regionales, perfiles, efemérides, ventanas, tránsito, clasificación, fechas, requisitos y fallos del proveedor.

Con Chrome y Gemini configurado en el servidor, ejecuta en otra terminal:

~~~powershell
node frontend/scripts/test-automatic-mission.mjs
~~~

Para comprobar consultas NASA de una fecha no incluida en los ejemplos preparados:

~~~powershell
$env:LUNAR_ORACLE_TEST_URL='http://127.0.0.1:4173/'
node frontend/scripts/test-live-plan.mjs
~~~

La prueba usa el 26 de diciembre de 2026 y exige tres consultas trazables. Para comprobar producción, cambia la URL al sitio publicado. La caché del alojamiento es opcional: permisos denegados o fallos de lectura/escritura no bloquean una consulta nueva a JPL.


La URL predeterminada es `http://127.0.0.1:4173/`; usa `LUNAR_ORACLE_TEST_URL` para cambiarla. El test exige Gemini real y comprueba análisis automático posterior, fuentes NASA, 12.892 zonas, círculos renderizados, selección, tiempo y vista móvil.

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
| Intérprete | `api/app/mission_intent.py`, `frontend/worker/mission-intent.mjs` |
| Planificador | `api/app/automatic_plan.py`, `frontend/worker/automatic-plan.mjs` |
| Horizontes | `api/scripts/prepare_global_horizons.py`, `data/prepared/global_horizons.json` |
| Ejemplo | `api/scripts/prepare_automatic_example.py`, `data/prepared/automatic_example.json`, `data/prepared/ephemeris/` |
| Comparación JPL | `api/scripts/validate_global_reference.py`, `docs/validation/global-reference-validation.json` |
| Navegador | `frontend/scripts/test-automatic-mission.mjs` |

Las APIs anteriores se conservan para compatibilidad y auditoría; no forman un segundo flujo de la interfaz principal.

El siguiente trabajo científico consiste en ampliar y validar horizontes, propagar incertidumbres y añadir peligros locales, energía, temperatura, radio y trayectorias completas. El sistema usa datos reales con modelos regionales acotados: **no es un gemelo digital certificado**.
