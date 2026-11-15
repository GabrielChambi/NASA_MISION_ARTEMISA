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

## Actualización: modelos y comprobaciones incorporados

Se conectó el estudio físico al flujo local y al resumen principal. Los defectos reproducidos se corrigieron; los límites que requieren datos externos permanecen explícitos.

| Punto | Incorporado | Qué sigue sin demostrar |
| --- | --- | --- |
| Marcos | Kernels NAIF con hash; 111 muestras en 40 registros JPL y contraste por escenario | Seguimiento físico independiente y cota global |
| Térmica | Radiación, capacidad térmica, termostato y calefacción limitada por energía servida | Red conductiva y calibración de una nave; suelo radiativo prescrito |
| Batería | Capacidad accesible y potencia por curva de temperatura, reserva y conservación | Curva de fabricante y ensayos reales; no extrapola |
| RF | Friis, C/N₀, E_b/N₀, margen, tasa y potencia del amplificador | Patrón de antena y equipo calificado |
| Red | Geometría de DSS-24/34/54, ITRF93 y horizontes lunares propios | Máscaras reales, clima, apuntado y agenda DSN; geometría instantánea |
| Ida y regreso | Contornos separados con gravedad Tierra/Luna/Sol, DE440, Lambert, corrección y detección de impactos | Ascenso desde Kennedy, combustible, guía lunar y entrada validada |
| Rover | Rutas nativas, rodadura/subida, potencia auxiliar y retorno dirigido con reserva | Terramecánica, rocas subpíxel, supervivencia térmica y comunicaciones de ruta |
| Telemetría | Perfil con fuentes, identificador, UTC, incertidumbre, residuales y asimilación inicial | Conexión autenticada y calibración independiente |
| Sensibilidad | Tres perturbaciones por separado y un escenario conjunto | Covarianzas y propagación exhaustiva; no probabilidad de éxito |
| IA e interfaz | Evidencia física acotada para el copiloto, resumen y exportación bilingües | La IA no genera mediciones ni rellena datos ausentes |

El [documento de modelos](ENGINEERING_MODELS.md) detalla ecuaciones, unidades, procedencia y límites. La [comparación SPICE](validation/spice-reference-validation.json) y los [casos de ingeniería](validation/engineering-reference-validation.json) conservan evidencia reproducible.

Un caso favorable en el presupuesto eléctrico básico puede quedar sin resolver al añadir calefacción y temperatura. El resumen muestra esa diferencia. La batería mayor del caso de contraste es una **hipótesis de diseño**, no una prestación NASA. El caso con radio debilitada conserva datos pendientes y no pasa.

## Verificación y validación física

Las pruebas verifican ecuaciones, conservación, entradas y comportamientos enumerados. No demuestran ausencia absoluta de fallos ni que los parámetros representen un sistema físico real.

[NASA-STD-7009B](https://standards.nasa.gov/sites/default/files/standards/NASA/B/1/NASA-STD-7009B-Final-3-5-2024.pdf) es una referencia metodológica. No se afirma certificación, aprobación NASA ni autorización de vuelo.

Para un gemelo operacional siguen siendo necesarios:

1. Una nave identificada con configuración, fichas y ensayos verificables.
2. Telemetría autenticada, observables definidos, calibración y datos independientes.
3. Fidelidad adecuada en térmica, propulsión/guía, suelo/ruedas, antenas y servicios de comunicaciones.
4. Incertidumbres medidas y revisión independiente con criterios de aceptación.

El software permite registrar fuentes y comparar/actualizar estados. La ausencia de nave real, ensayos o revisión externa no se resuelve inventándolos.

## Reproducir

~~~powershell
api/.venv/Scripts/python.exe -m pip install -r api/requirements.txt
api/.venv/Scripts/python.exe api/scripts/acquire_nasa.py
api/.venv/Scripts/python.exe api/scripts/acquire_spice.py
api/.venv/Scripts/python.exe -m pytest api/tests -q
npm.cmd run test:science
npm.cmd run build
api/.venv/Scripts/python.exe api/scripts/validate_spice.py
api/.venv/Scripts/python.exe api/scripts/validate_engineering.py
npm.cmd run dev:full
node frontend/scripts/test-engineering.mjs
node frontend/scripts/test-mission-operations.mjs
node frontend/scripts/test-lunar-studio.mjs
~~~

Las cachés JPL deben corresponder al observador, intervalo y parámetros exactos. Las pruebas de indisponibilidad inyectan fallos, no escenarios positivos artificiales.

## Resultado de esta entrega

Pasaron 366 pruebas Python, 225 pruebas JavaScript, la compilación y cinco flujos de navegador con datos positivos NASA originales. La comprobación HTTP final verifica la aplicación sin login, el presupuesto acoplado y la corrección del intervalo de fechas.

El [registro de verificación del sistema](validation/engineering-system-verification.json) conserva las huellas del código, los resultados y el alcance. Estos resultados no cambian los requisitos pendientes de calibración física y revisión independiente.
