# Estado de implementación · LUNAR ORACLE

La revisión sustituye la portada con telemetría decorativa por un planificador en español. El inicio muestra una malla 3D NASA. Las pruebas del documento aportado y la física se detallan en [mission_planner.md](science/mission_planner.md).

| Entrega | Estado comprobado |
| --- | --- |
| Inicio | Mapa, fechas UTC, criterios, comparación y descenso |
| Catálogo y selección | Dos píxeles; coordenadas iguales en mapa y GET/POST |
| Sol y Tierra | NASA, horizonte, despeje y reloj sincronizado |
| Ventanas | Intervalos semiabiertos, duración, intersección y huecos |
| Comparación y escenarios | Condiciones idénticas, reglas y diferencia con cálculo previo |
| Descenso | Gravedad lunar, empuje, Isp, masa y tanque; contacto/impacto/timeout |
| Contacto en mapa | Marcador, coordenadas y cámara sobre el objetivo |
| Evidencia | JSON con misión, criterios, NASA y física; CSV avanzado |
| Integración de main | Earth/Compare con misión compartida y servicio canónico |
| Robustez | Cancelación, invalidación, error sin sustitución y reintento |
| Verificación | Build, 45 Python, 30 Node y navegador |
| Móvil | 360/390/768/1500 px; mapa primero |
| GitHub | Revisión preparada para main |
| Sites | Publicación pendiente: “Sites project not found” al pedir escritura |

El antiguo lanzamiento se conserva como código histórico, fuera del inicio. La semilla B no alimenta endpoints activos. Se corrigieron coordenadas estáticas y sustituciones de rango/horizonte.

Implementado no significa validación oficial: horizonte parcial, transiciones muestreadas, contraste SPICE pendiente y nave hipotética. No se certifica seguridad, energía, enlace RF ni trayectoria Tierra–Luna.
