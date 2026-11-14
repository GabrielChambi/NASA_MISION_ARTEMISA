# Cobertura del Plan A y datos NASA

Estado comprobado de esta implementación; el documento original se interpreta como especificación de producto, no como evidencia de tareas ya realizadas.

| ID | Entrega | Estado / evidencia |
| --- | --- | --- |
| A-F1 | Shell y navegación | Implementado: Mission Control, Explorer, Solar, Earth, Compare, Evidence |
| A-F2 | Mapa polar y dos sitios | Implementado: coordenadas verificadas, selección y MissionContext |
| A-F3 | Solar y cronología | Implementado: curvas, muestras UTC, horizonte, ventanas y exportación CSV |
| A-F4 | Responsive y estados | Comprobado: cinco tamaños en inicio, cinco vistas científicas a 390 px; errores/reintentos |
| A-B1 | Catálogo y DEM | `/api/sites`, límites/CRS del GeoTIFF, pixel/altura trazables |
| A-B2 | Solar y contrato | `/api/solar` con meta, samples, windows, summary y errores |
| A-B3 | Horizonte compartido | Plano o terreno, interpolación circular y perfiles a 1/2/5 m, caché exacta |
| A-B4 | Health y fallos | `/api/health`, timeout/HTTP/JSON/tabla inválida → unavailable |
| A-S1 | Efemérides reales | Series Sol/Tierra y seis consultas independientes de contraste JPL |
| A-S2 | LOLA y horizonte | 5 m local + 80 m regional, 360 rayos, curvatura, nodata y cobertura parcial explícita |
| A-S3 | Ventanas y métricas | Intervalos semiabiertos con muestra izquierda; endpoint final sin duración extra |
| A-Q1 | Pruebas científicas | Pruebas Python: ventanas, UTC, formato, igualdad, perfil y errores |
| A-Q2 | UI y API | Build, pytest, navegador y paridad Python/Worker |
| A-Q3 | Método y fuentes | `docs/science/solar.md`, inventario y respuestas originales de JPL |
| A-Q4 | Revisión de B / pitch | Pendiente externo: no se ha proporcionado una PR de B ni se afirma haberla revisado |

## Extras solicitados e integrados

- Inicio renderizado en 3D, sin usar el antiguo fondo fotográfico.
- Selección de región enlazada con la secuencia de viaje y aterrizaje.
- Terreno de aterrizaje derivado de NASA; imágenes oficiales de los planetas con créditos.
- Consultas de la Tierra 399 y observatorio real reutilizando el motor común.
- Comparación solar entre sitios y escenarios de retraso/altura/horizonte recalculados.
- Adaptador de publicación con la misma procedencia y pruebas de igualdad con Python.

## Qué no significa «implementado»

El relieve tiene cobertura y muestreo finitos. Los productos de incertidumbre no se propagan a una simulación probabilística completa. No hay certificación de aterrizaje, cálculo de energía, enlace RF ni transformación SPICE independiente validada. La animación es ilustrativa y no representa una trayectoria orbital calculada. El estado de adquisición de cada producto se registra por separado en `/api/datasets`.
