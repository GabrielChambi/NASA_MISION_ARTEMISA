# Atlas regional 3D del polo sur lunar

## Fuente y referencia visual

La vista toma como referencia visual [NASA SVS 5127 · Lunar South Pole Terrain in Coded Color](https://svs.gsfc.nasa.gov/5127). La página identifica el uso de elevación para codificar colores y nombres de accidentes lunares. El atlas de LUNAR ORACLE se reconstruye en tiempo real con geometría propia a partir de mediciones; no muestra una captura o un video de esa visualización como si fuera un modelo interactivo.

Fuente del relieve: [NASA Goddard / LOLA · LDEM_80S_80MPP_ADJ.TIF](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF), el producto regional que ya utiliza la biblioteca de horizontes. El raster tiene 7600 × 7600 píxeles a 80 m/píxel, radio lunar de referencia 1 737 400 m y proyección estereográfica polar sur. Los límites proyectados son ±304 km en ambos ejes.

Los nombres y coordenadas se descargan del [Gazetteer IAU / USGS](https://planetarynames.wr.usgs.gov/GIS_Downloads), archivo `MOON_nomenclature_center_pts.kmz`, con control cartográfico LOLA 2011. Se retienen los enlaces individuales de nomenclatura. El catálogo de visualización incluye 18 accidentes dentro del área cubierta; 12 nombres principales aparecen en la vista inicial para mejorar la lectura.

## Preparación reproducible

```powershell
api/.venv/Scripts/python.exe api/scripts/prepare_polar_atlas.py
```

El script reutiliza `data/raw/regional80m.tif`; si falta, lo descarga desde la URL NASA. Los originales grandes y el KMZ permanecen en `data/raw/`, fuera de Git.

Derivados versionados en `frontend/public/data/polar-atlas/`:

- `manifest.json`: CRS, límites, dimensiones, resolución, nombres/posiciones, procedencia, fecha y SHA-256.
- `south-pole-height.u16`: cuadrícula de 769 × 769 alturas, 1 182 722 bytes, little-endian.

La cuadrícula se obtiene con remuestreo bilineal. Cada vértice representa el centro del píxel remuestreado, con separación aproximada de **790.64 m**, no 80 m. Las alturas se cuantizan en pasos de 0.5 m (`height = encoded * 0.5 - 16000`), con error de cuantización máximo aproximado de 0.25 m respecto al remuestreo. Esto no aumenta la precisión del DEM original.

`65535` representa nodata. Los triángulos que tocan nodata no se dibujan; las esquinas externas a la cobertura circular no se rellenan con terreno inventado. En móviles, la malla salta un vértice por eje para reducir la carga gráfica; la resolución de visualización efectiva es aproximadamente 1.58 km, aunque la descarga contiene la cuadrícula de 791 m.

El cliente comprueba longitud y SHA-256 antes de construir el modelo. Si faltan datos o WebGL, muestra un estado explícito; el mapa 2D y las herramientas científicas siguen disponibles.

## Geometría

Se invierte la proyección estereográfica esférica usando el radio del CRS, se incorpora cada altura medida y se representa la curvatura lunar. No se aplican fórmulas UTM o radios terrestres. La malla utiliza kilómetros como unidad gráfica.

La exageración vertical es una opción de inspección de **1×, 3× o 5×**. Se aplica radialmente al relieve; no altera coordenadas, datos de Horizons, perfiles de horizonte ni ventanas. El valor inicial 3× se indica en el selector y la leyenda. La opción 1× permite comprobar la forma sin exageración.

Los colores son una escala propia inspirada en la referencia: azul para depresiones y verdes/amarillos/tonos claros para mayor elevación. La leyenda está expresada en kilómetros respecto a la esfera lunar de referencia. No son colores naturales, una clasificación de hielo ni resultados de iluminación.

La luz de inspección es ilustrativa. No se presenta como un cálculo de sombras solares. Las posiciones y nombres de cráteres son anotaciones cartográficas; una etiqueta no designa un sitio de aterrizaje.

## Interacción y datos científicos

- Arrastrar para orbitar; rueda o botones para zoom.
- Vistas de perspectiva, polar y acercamiento al sitio.
- Mostrar/ocultar nombres; inspeccionar coordenadas y altura de un accidente mediante su etiqueta.
- Seleccionar Site01 o Site04 desde marcadores o la franja inferior. Se sincroniza con el contexto de misión y el selector general.
- Cambiar entre color de elevación y relieve monocromo.
- Pantalla completa y rotación automática opcional. El renderizado es bajo demanda y se respeta movimiento reducido.
- La línea temporal muestra las muestras UTC reales del Sol y de la Tierra y sus azimuts, elevaciones y horizontes. La reproducción recorre esas muestras, sin generar efemérides intermedias.
- Los rayos opcionales usan vectores locales Este/Norte/Arriba calculados de los azimuts y elevaciones JPL; sus longitudes son esquemáticas. La luz del modelo no determina si el astro está visible: el indicador usa el horizonte científico seleccionado.

Los cálculos de visibilidad siguen usando la biblioteca de horizontes y sus datos locales/regionales originales; **la malla gráfica reducida no se usa para decidir ventanas**. Las fechas, muestreo y altura se modifican desde los controles comunes situados debajo del atlas.

## Integración con los módulos descargados de main

La actualización conserva EarthMissionSuite, Site Comparison y Mission Resilience Lab del commit `5d7c37f`. El paquete alojado añade los contratos POST `/api/earth` y `/api/compare` mediante `frontend/worker/mission.mjs`; antes solo disponía de la API GET del primer incremento.

El adaptador usa el catálogo compartido y las consultas NASA exactas, incluye distancia terrestre medida mediante Horizons `QUANTITIES=4,20` y usa perfiles de terreno parciales explícitos. Las ventanas semiabiertas eliminan el punto final de la duración. La comparación recalcula la intersección Sol/Tierra con el mismo intervalo, y la sensibilidad de retraso usa una consulta distinta. No produce un resultado válido si una fuente necesaria falla.

Para preparar las consultas reales incluidas del 14–17 de diciembre de 2026 (alturas 2 m, retrasos 0/12 h):

```powershell
api/.venv/Scripts/python.exe api/scripts/prepare_hosted_mission.py
```

El atlas solicita `canonical=true` al endpoint terrestre local para utilizar siempre el catálogo y la caché exacta comunes, sin seleccionar las rutas de compatibilidad de semillas del módulo B. Las rutas anteriores de B se conservan.

## Validación y límites

`api/tests/test_polar_atlas.py` comprueba integridad binaria, rango, nodata/cobertura circular, centros de píxel, proyección de etiquetas con PyProj y comparación con el raster NASA original cuando está disponible. `frontend/scripts/verify-atlas.mjs` comprueba etiquetas, inspección, color, escala, cámaras, selección, tiempo, móvil y que arrastrar cambia realmente la imagen renderizada. `verify-main-integration.mjs` verifica la compatibilidad visual de Tierra/comparación en el paquete de producción.

La vista es regional, no un globo lunar completo ni una malla de 80 m en el navegador. Se mantiene pendiente la validación independiente SPICE entre los marcos cartográficos. La exageración, el remuestreo y los rayos esquemáticos deben tenerse en cuenta al interpretar la escena. No certifica seguridad de aterrizaje, producción energética o disponibilidad RF.
