# LUNAR ORACLE · Lunar Landing Site Navigator

Escribe cuándo quieres viajar y el sistema calcula una recomendación sobre **todo el polo sur lunar, de 80°S a 90°S**. Una sola pantalla reúne la pregunta, el mapa 3D, los destinos, las condiciones durante la estancia y la duración estimada. Los visitantes entran directamente, sin iniciar sesión con ChatGPT ni Google.

![Planificación automática sobre todo el polo sur](docs/images/automatic-mission.png)

> Quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am. ¿Dónde sería mejor alunizar y cuánto tardaría la misión?

**Gemini interpreta la solicitud; el motor científico calcula con NASA LOLA y JPL Horizons.** Es un prototipo de planificación regional con hipótesis visibles, no un gemelo digital certificado ni una autorización de vuelo.

## Cómo se usa

1. Escribe fecha y hora y pulsa **Planificar mi misión**, o prueba el ejemplo. La hora predeterminada es Bolivia, `America/La_Paz` / UTC−04:00; puedes indicar UTC.
2. El sistema interpreta salida o alunizaje, estima el tránsito y compara automáticamente **12.892 zonas** de todo el casquete. No necesitas abrir otro estudio ni elegir capas.
3. El mapa conserva un **relieve gris continuo**, sin un pequeño parche blanco superpuesto. Un círculo destacado señala el mejor candidato; hasta tres círculos verdes muestran alternativas y hasta ocho rojos muestran ejemplos descartados. Son una selección visible del análisis completo.
4. Toca un destino para conocer sus razones. Reproduce **Condiciones durante tu estancia** para ver los cambios del Sol y la Tierra respecto al horizonte del lugar. **Acercar destino** mantiene el mismo mapa y carga más detalle visual.
5. Cambia fecha, estancia y requisitos en **Preferencias del viaje** y recalcula. **Descargar plan y evidencia** guarda resultados, supuestos y consultas NASA. La animación de descenso usa una nave hipotética y no certifica el terreno.

El gris del relieve no indica aptitud. Los datos insuficientes se conservan como desconocidos y se cuentan por separado; no se sustituyen con un horizonte plano ni se convierten en zonas favorables. Verde significa que cumple los criterios del modelo regional en el intervalo analizado.

## Ejecutar

Requiere Node 22.12+ y Python 3.11+. En Windows, desde la raíz:

~~~powershell
npm.cmd --prefix frontend ci
python -m venv api/.venv
api/.venv/Scripts/python.exe -m pip install -r api/requirements.txt
npm.cmd run dev:full
~~~

Abre [la aplicación local](http://127.0.0.1:5173/). La documentación FastAPI está en [127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). El lanzador inicia ambos servicios, carga `.env` y los detiene al cerrarse. En Linux/macOS usa `npm`, `python3` y `api/.venv/bin/python`.

Los derivados NASA y las consultas originales del ejemplo están incluidos. Los TIFF grandes sólo hacen falta para regenerar o auditar el terreno.

### Configurar Gemini

Gemini interpreta la solicitud como datos estructurados; la interfaz encadena automáticamente la consulta NASA y el análisis de destinos. No se queda en una respuesta de texto.

Obtén una clave del proyecto en [Google AI Studio](https://aistudio.google.com/apikey). Si todavía no tienes `.env`, copia `.env.example`; si ya existe, edítalo sin reemplazar sus valores privados:

~~~dotenv
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash-lite
GEMINI_API_KEY=tu_clave
~~~

El modelo es configurable según disponibilidad y permisos del proyecto Google. Reinicia el servidor después de editar la configuración.

~~~powershell
npm.cmd run ai:check
npm.cmd run ai:check -- --generate
~~~

La clave sólo se usa en el servidor. No la pongas en variables `VITE_`, en el navegador ni en Git. El despliegue remoto necesita su propio secreto `GEMINI_API_KEY`; el archivo `.env` local no se publica. Los visitantes no necesitan claves ni cuentas.

Si Gemini falla o falta la clave, un intérprete determinista reconoce fechas y requisitos compatibles y se identifica como sistema. No se presenta como IA. Si faltan fecha u hora, pide ese dato; no inventa una misión.

### Compilar y previsualizar la versión alojable

~~~powershell
npm.cmd run build:hosted
npm.cmd --prefix frontend run preview:hosted
~~~

Abre [la vista previa](http://127.0.0.1:4173/). Incluye frontend y API Worker y funciona sin un proceso Python. También lee `.env`.

## Caso reproducible y alcance científico

El caso de [automatic_example.json](data/prepared/automatic_example.json) usa salida el **25 de diciembre de 2026 a las 08:00 de Bolivia**, estancia de 72 h, pendiente regional máxima de 10° y mínimos de 12 h de Sol y Tierra visible.

| Resultado del modelo | Valor |
| --- | --- |
| Salida UTC | 25 dic 2026 · 12:00 |
| Tránsito ideal de ida | 107,56 h; ajuste de llegada de +26,11 min hasta la siguiente hora |
| Llegada analizada | 30 dic 2026 · 00:00 UTC |
| Estancia | 72 h |
| Regreso estimado | 6 ene 2027 · 11:33:53 UTC |
| Duración total estimada | 287,56 h, aproximadamente 12 días |
| Clasificación regional | 11 favorables, 12.786 descartadas, 95 desconocidas |
| Mejor candidato | −80,78120657°, −7,30575953°; `polar:5:56` |
| Visibilidad del mejor candidato | 46 h de Sol y 72 h de Tierra |

Estos valores dependen de la fecha, los requisitos y los derivados. El tránsito es una transferencia elíptica ideal de dos cuerpos desde una órbita terrestre de 200 km; el regreso usa la misma duración ideal. No se ha diseñado una trayectoria Artemis ni una ventana real de lanzamiento.

El [DEM NASA LOLA/PGDA](https://pgda.gsfc.nasa.gov/products/78) de 80 m se agrega en zonas de 4,75 km. Cada zona tiene su **propio** horizonte con muestras cada 5°; no se reutiliza el de un punto para toda la Luna. El motor requiere alcance válido de al menos 20 km por dirección muestreada y conserva la cobertura distante como parcial, incluso con rayos hasta 250 km.

Las posiciones y distancias del Sol y la Tierra provienen de [NASA/JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html). Se trasladan geométricamente desde un observador lunar de referencia a cada zona, con cadencia horaria. El modelo regional no resuelve rocas pequeñas, huella, energía, temperatura ni presupuesto de radio. La validación independiente completa de marcos con SPICE sigue pendiente.

La metodología, los endpoints y los límites están en [Misión automática](docs/AUTOMATIC_MISSION.md).

## Verificar y reproducir

~~~powershell
npm.cmd run test:science
api/.venv/Scripts/python.exe -m pytest api/tests -q
npm.cmd run build:hosted
npm.cmd --prefix frontend run preview:hosted
~~~

En otra terminal, con Google Chrome y Gemini configurado en el servidor:

~~~powershell
node frontend/scripts/test-automatic-mission.mjs
~~~

Para comprobar consultas NASA de una fecha no incluida en los ejemplos preparados:

~~~powershell
$env:LUNAR_ORACLE_TEST_URL='http://127.0.0.1:4173/'
node frontend/scripts/test-live-plan.mjs
~~~

La prueba usa el 26 de diciembre de 2026 y exige tres consultas trazables. Para comprobar producción, cambia la URL al sitio publicado. La caché del alojamiento es opcional: permisos denegados o fallos de lectura/escritura no bloquean una consulta nueva a JPL.


Las suites Node y Python verifican los motores y las APIs. El recorrido de navegador verifica pregunta → interpretación Gemini real → análisis NASA → mapa con círculos, selección, cambios temporales y vista móvil. Usa `LUNAR_ORACLE_TEST_URL` para probar otra dirección. Los tests unitarios del proveedor utilizan respuestas controladas y comprueban también los fallos y el respaldo determinista.

Para reproducir el ejemplo y la comparación independiente con consultas directas a JPL en tres puntos:

~~~powershell
api/.venv/Scripts/python.exe api/scripts/prepare_automatic_example.py
api/.venv/Scripts/python.exe api/scripts/validate_global_reference.py
~~~

El [informe de tres puntos](docs/validation/global-reference-validation.json) compara tres horas por astro y punto para una fecha. Su alcance no valida cada ubicación, el terreno ni la viabilidad de una misión real.

Para regenerar el conjunto regional:

~~~powershell
api/.venv/Scripts/python.exe api/scripts/acquire_nasa.py
api/.venv/Scripts/python.exe api/scripts/prepare_polar_atlas.py
api/.venv/Scripts/python.exe api/scripts/prepare_polar_screening.py
api/.venv/Scripts/python.exe api/scripts/prepare_global_horizons.py
api/.venv/Scripts/python.exe api/scripts/prepare_lunar_detail.py
~~~

Los TIFF se guardan en `data/raw`, ignorado por Git. Los derivados registran fuente y SHA-256; las consultas JPL conservan parámetros, URL, fecha de recuperación y respuesta original.

## Dónde continuar

- [UnifiedMissionPlanner.tsx](frontend/src/features/mission/UnifiedMissionPlanner.tsx): experiencia única de usuario.
- [mission_intent.py](api/app/mission_intent.py) y [mission-intent.mjs](frontend/worker/mission-intent.mjs): extracción validada de la solicitud.
- [automatic_plan.py](api/app/automatic_plan.py) y [automatic-plan.mjs](frontend/worker/automatic-plan.mjs): planificación automática Python y Worker.
- [prepare_global_horizons.py](api/scripts/prepare_global_horizons.py): perfiles propios desde el DEM nativo.
- [AUTOMATIC_MISSION.md](docs/AUTOMATIC_MISSION.md): metodología, evidencia y limitaciones.

Las APIs científicas anteriores se conservan para compatibilidad y auditoría. El recorrido principal utiliza la interfaz unificada y no envía al visitante a pantallas antiguas.
