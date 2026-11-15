# Cockpit científico, contornos y límites

Esta integración conecta el cockpit con el cliente y parser de JPL Horizons y con el cálculo geométrico de visibilidad. Elimina el motor temporal de demostración, la obstrucción artificial del escenario +6 días y las alturas y pendientes de respaldo.

## Qué se corrigió

| Problema revisado | Comportamiento actual |
| --- | --- |
| Efemérides por seno y constantes | Consultas NASA exactas del observador, fechas, altura y distancia; respuesta original y URL conservadas |
| Resultados verdes sin terreno | Carga y validación obligatoria; desconocido o error, sin evaluación ni exportación válida |
| Pendiente derivada del atlas de ~791 m | Producto de pendiente NASA de 5 m; se muestran el píxel y el máximo de la celda con huella |
| Curvatura y norte local | Geodesia esférica, base ENU por punto y radio lunar; alturas sin exageración en el cockpit |
| Precisión al sumar elevación y radio lunar | Cálculo de horizonte en float64; regresión contra los 360 azimuts del motor anterior |
| Rescate fijo presentado como búsqueda | Búsqueda determinista entre celdas evaluadas; reconsulta NASA al elegir un nuevo punto |
| Evidencia de otro destino | Evidencia del observador actual con coordenadas e intervalo; comparación de referencias identificada por separado |
| Fecha vacía y coordenadas incompletas | Validación estricta; no se convierten en cero ni en una fecha alternativa |
| Evaluación antigua tras editar parámetros | Se invalida hasta volver a simular; las coordenadas editadas requieren confirmación |
| Salida del intervalo interpretada como anochecer | Se informa que el evento no fue observado, sin extrapolar |
| Estados de animación incompatibles | Cambiar de hora o parámetros detiene el descenso; el contacto procede del integrador |
| Reinicio de caso al volver del análisis | Cockpit y contexto permanecen montados; las pruebas cambian de vista tres veces sin perder el caso |
| Controles recortados en móvil | Cabecera y cámaras accesibles a 390 px; lienzo ocupa el mapa y paneles fluyen verticalmente |
| Recursos 3D retenidos | Geometrías memoizadas y liberadas al sustituirse; escena oculta deja de producir fotogramas |

## Preparación del terreno

Se generan dos rejillas de 21 × 21 celdas, centradas en los píxeles de referencia Site01 y Site04. Los centros están separados 50 m. Cada celda representa 50 × 50 m y su máximo de pendiente incluye todos los píxeles originales del cuadrado de celda más 15 m de margen. El relieve es el rango de elevación del cuadrado central de 35 m; no una medida certificada de estabilidad de patas.

El espaciado de la elevación y pendiente originales es 5 m. NASA advierte que aproximadamente el 90% de los píxeles son interpolados. La rejilla no resuelve rocas pequeñas ni sustituye imágenes de mayor resolución. Se conserva el máximo RMS de altura del entorno analizado, sin convertirlo en una probabilidad de seguridad.

La vista usa un parche de 5 m, cuantizado a 0,1 m para dibujar; un contexto local de 75 m y el atlas polar reducido. El análisis usa los TIFF originales y no toma pendientes de ninguna de esas mallas reducidas. En el cockpit no se exageran alturas. Los cuerpos celestes tienen tamaños ilustrativos y direcciones basadas en las efemérides.

## Horizonte y tiempo

Para cada centro de celda se calculan 360 rayos. La trayectoria sobre la esfera sigue el azimut desde el norte local verdadero. La elevación aparente del terreno se obtiene de:

~~~text
atan2((R + h_terreno) cos(d/R) - (R + h_observador + 2 m),
      (R + h_terreno) sin(d/R))
~~~

Se busca el máximo en el DEM local cada 10 m hasta 22 km y en el regional cada 250 m hasta 250 km, con la misma convención del motor científico anterior. Se excluye nodata y se registra cobertura regional. La suma del radio y la elevación se realiza en doble precisión. La interpolación angular es circular, incluido el cruce 359° → 0°.

Son perfiles finitos y discretos: pueden omitir obstáculos entre rayos o muestras. Se usa la convención LOLA MOON_ME/DE421 y el observador lunar MEAN_ME de Horizons; falta validación independiente con kernels SPICE.

Las consultas del punto elegido solicitan azimut, elevación aparente sin atmósfera y distancia, con coordenadas y elevación de ese píxel. Para las celdas vecinas se traslada geométricamente el vector aparente y se transforma a su ENU local. Es una aproximación espacial; no se afirma que cada celda haya recibido una solución SPICE independiente. Una prueba compara 73 muestras de Sol y Tierra con consultas NASA independientes en una esquina de la rejilla y exige un error menor de 0,002°.

La cadencia de la interfaz es una hora. Las ventanas son [inicio, fin) y la muestra final no agrega tiempo. No se inventa una fecha de bloqueo cuando no aparece en el intervalo.

## Clases del mapa

- **Rojo:** algún criterio conocido falla: pendiente, relieve, despeje del Sol/Tierra o horas mínimas.
- **Amarillo:** cumple los criterios, pero se acerca al límite de pendiente en 1°, al de relieve en 0,5 m, al angular en 0,5°, o presenta RMS de altura mayor de 1 m.
- **Verde:** cumple los criterios y esas reservas del modelo.
- **Gris:** faltan datos, cobertura o muestras válidas.

La iluminación y el horizonte se evalúan en el centro de cada celda; no se calcula una envolvente continua para todos sus puntos interiores. La pintura representa una discretización. Al seleccionar se ajusta a un centro y se consulta ese observador exacto.

Las reservas son decisiones de cribado. No son intervalos de confianza ni compensan todas las incertidumbres del DEM. El verde significa “cumple el modelo evaluado”; no significa “NASA autoriza el aterrizaje”.

El fondo de altitud del atlas polar tiene otra finalidad que los contornos de aptitud. Sólo las celdas analizadas reciben contornos después de simular.

## Descenso y evidencia

El descenso reutiliza el integrador RK4 de misión, con gravedad central inversamente proporcional al radio al cuadrado y consumo por empuje / (Isp × g0). Usa una nave hipotética y una trayectoria vertical. La velocidad de contacto determina contacto suave o impacto; no modifica la aptitud ambiental. Los rayos de visibilidad siguen perteneciendo al observador de 2 m en el destino.

La exportación incluye observador, fechas, fuentes, hashes, efemérides, perfiles, criterios y clasificación, además de estados físicos cuando se ejecutó el descenso. Los intervalos no preparados exigen acceso a JPL. Ante un fallo no se sustituyen por efemérides artificiales.

## Validación y trabajo pendiente

Ejecutar los comandos del README. Hay pruebas independientes de ventanas, conservación de masa y combustible, caída libre, convergencia, pendientes nativas, cobertura, datos desconocidos, igualdad de perfiles entre motores y respuestas NASA almacenadas. El navegador verifica escritorio, móvil, colores por UTC, contacto, exportación, persistencia de vistas y fallos de las dependencias.

La cobertura preparada es limitada a las dos rejillas. Ampliarla requiere nuevos productos locales, su preparación y verificación. No se simulan energía eléctrica, térmica, presupuesto RF, guiado lateral ni estabilidad del tren de aterrizaje. Tampoco se ha propagado toda la incertidumbre o validado marcos con SPICE. Por eso el producto se presenta como **prototipo de gemelo de planificación**, no como gemelo operativo de una misión real.

Fuentes: [NASA LOLA / PGDA 78](https://pgda.gsfc.nasa.gov/products/78), [API Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [manual Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html), [parámetros dinámicos JPL](https://ssd.jpl.nasa.gov/astro_par.html).
