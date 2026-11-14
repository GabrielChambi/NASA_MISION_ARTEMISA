# Contexto y plan de desarrollo de LUNAR ORACLE

> Documento de planificación inicial conservado como contexto. Para el estado implementado actual, consultar [README](../README.md), [cobertura del Plan A](IMPLEMENTATION_STATUS.md) y [metodología científica](science/solar.md).

Este documento resume la propuesta suministrada para el proyecto y la separa del estado implementado. Los endpoints, parámetros y arquitectura siguientes son propuestas por validar. No confirman requisitos oficiales de la hackatón ni certifican resultados científicos.

## Objetivo y límites

Explorar dos regiones candidatas del polo sur lunar, comparar iluminación solar y visibilidad geométrica directa de la Tierra y recalcular bajo condiciones alternativas de misión. La diferenciación propuesta es la reproducibilidad, los supuestos transparentes y la explicación de resultados.

No se promete certificar seguridad de aterrizaje, garantizar enlaces RF ni predecir generación eléctrica sin especificaciones y modelos físicos adecuados. Un modelo de lenguaje puede explicar resultados calculados, nunca inventar o calcular efemérides.

## Estado y pantallas

| Pantalla | Responsabilidad | Estado |
| --- | --- | --- |
| Mission Control | Inicio y contexto de misión | Prototipo implementado |
| Lunar Explorer | Regiones y selección de sitio | Pendiente |
| Sun & Earth Observatory | Curvas y ventanas | Pendiente |
| Site Comparison | Comparación con parámetros comunes | Pendiente |
| Mission Scenario Lab | Sensibilidad y retrasos | Pendiente |
| Scientific Evidence | Procedencia y metodología | Pendiente; existen notas de demostración |

La selección actual de destino solo cambia estado visual. El checklist y lanzamiento son simulados. Las gráficas decorativas no son salidas científicas. Conservar la pantalla inicial y evolucionar el sistema por módulos.

## Prioridades

**P0:** sitios verificados Site01 (Connecting ridge) y Site04 (Shackleton rim), selección temporal UTC, efemérides reales Sol/Tierra, curvas legibles, comparación de dos lugares en el mismo intervalo, metodología y demostración publicada.

**P1:** horizonte a partir del terreno LOLA, ventanas geométricas con incertidumbre, escenarios de retraso/altura/margen de antena y explicación de diferencias.

**P2:** terreno 3D, exportación de informes, PWA y explicador de lenguaje natural. Empezar después de validar P0 y P1.

## Arquitectura propuesta

```text
frontend/src/
  app/
  pages/
  components/
  features/explorer/
  features/observatory/
  features/comparison/
  features/scenario/
  api/
  types/
backend/
  app/
    main.py
    api/
    schemas/
    services/
      horizons.py
      terrain.py
      visibility.py
      comparison.py
      scenario.py
  tests/
data/
  sites.json
  prepared/
```

El frontend actual está concentrado en `App.tsx` y `styles.css`. Separarlo progresivamente al añadir funciones reales. Backend propuesto: FastAPI, httpx y NumPy; Rasterio cuando se procesen GeoTIFF. Crear dependencias reproducibles al implementar el backend.

La visualización científica inicial será polar 2D. No asumir que un raster lunar polar se puede usar directamente en un mapa terrestre. No enviar mosaicos de gigabytes al navegador: preparar recortes y derivados ligeros. Las llamadas externas, caché y cálculo científico pertenecen al backend.

## Incremento 1: catálogo verificable

Crear `data/sites.json` a partir de las regiones NASA verificadas, con identificador, coordenadas, convención de longitud, unidades, marco y enlaces de procedencia. No deducir coordenadas del nombre del cráter ni inventarlas.

**Aceptación:** cada coordenada es rastreable a la fuente y se comprenden los marcos del DEM y de Horizons. MOON_ME, MOON_PA e IAU_MOON no deben confundirse.

## Incremento 2: efemérides y primer gráfico conectado

Parámetros iniciales del plan, por comprobar contra la documentación de Horizons: `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`, `SITE_COORD='lon,lat,height_km'`, Sol `COMMAND='10'`, Tierra `COMMAND='399'`, `QUANTITIES='4'` para azimut/elevación.

Verificar convenciones y formato de salida antes de implementar el parser. Normalizar:

```ts
type EphemerisSample = {
  tUtc: string;
  sunAzDeg: number;
  sunElDeg: number;
  earthAzDeg: number;
  earthElDeg: number;
};
```

Añadir timeouts, límites de duración y muestras, validación de entradas, manejo de errores y caché por sitio/fechas/paso. El frontend debe mostrar carga, error, sin datos y resultados precalculados etiquetados.

**Aceptación:** contrastar ambos sitios y al menos tres fechas con las salidas originales de Horizons. Cambiar fecha o sitio cambia el cálculo. Mostrar UTC, unidades, resolución y procedencia.

## Contrato API propuesto

| Método y ruta | Función |
| --- | --- |
| `GET /api/health` | Disponibilidad |
| `GET /api/sites` | Sitios verificados |
| `POST /api/ephemeris` | Series Sol/Tierra de un sitio |
| `POST /api/compare` | Dos sitios con parámetros idénticos |
| `POST /api/scenario` | Recalcular supuestos alternativos |
| `GET /api/methodology` | Fuentes y limitaciones |

Ejemplo de comparación, sin resultados asociados:

```json
{
  "siteIds": ["site01", "site04"],
  "startUtc": "2026-12-01T00:00:00Z",
  "endUtc": "2026-12-08T00:00:00Z",
  "stepMinutes": 60,
  "observerHeightM": 1,
  "antennaMarginDeg": 0
}
```

Acordar respuestas y errores exactos entre ambos integrantes antes de integrar. Incluir parámetros usados, series, ventanas, métricas, procedencia y limitaciones. Metadatos mínimos: región, fuente, marco, altura, paso, fecha de obtención, horizonte ideal/modelado, cobertura y si el resultado fue precalculado.

## Incremento 3: horizonte y ventanas

Comenzar con horizonte ideal de 0°, identificado como simplificación. Después calcular `h(az)` usando recortes LOLA, altura del observador y curvatura lunar. Declarar que el recorte puede excluir obstáculos distantes.

```text
sun_visible(t)   = sunElDeg(t)   > h(sunAzDeg(t))
earth_visible(t) = earthElDeg(t) > h(earthAzDeg(t)) + marginDeg
```

Son modelos geométricos simplificados. La visibilidad solar no equivale a generación eléctrica y la visibilidad terrestre no garantiza radiofrecuencia. Calcular fracción de muestras visibles, intervalos consecutivos, mayor ventana e interrupción más larga. Empezar con 60 minutos de muestreo y declarar la incertidumbre de transición.

## Incremento 4: comparación y escenarios

Comparar ambos sitios con exactamente las mismas fechas, paso y supuestos. Recalcular retrasos de 0/6/12/24 h, altura y margen de antena; no limitarse a cambiar etiquetas. Evitar puntuaciones opacas. Si hay ranking, mostrar pesos y explicación.

**Aceptación:** reproducibilidad desde entradas y fuentes, explicación del criterio que favorece cada región y de cuándo cambia la conclusión. No simular baterías sin balance energético documentado.

## Organización del equipo y entrega

Propuesta para dos integrantes: frontend/demostración/despliegue y motor/datos/validación. Acordar esquemas JSON juntos y mantener `main` funcional mediante ramas y revisiones.

Antes de entregar: pruebas del parser, UTC, unidades y fallos externos; contraste de ambos sitios; validación del horizonte y cobertura; acceso público probado en incógnito; licencia elegida; fuentes, autoría y uso de IA declarados. Confirmar requisitos y plazos en la convocatoria oficial.

Recorrido de demostración propuesto: comparar dos sitios → revisar curvas y ventanas → introducir retraso → entender qué cambió → consultar evidencia. La próxima entrega debe demostrar al menos un cálculo real verificable antes de añadir efectos o módulos opcionales.
