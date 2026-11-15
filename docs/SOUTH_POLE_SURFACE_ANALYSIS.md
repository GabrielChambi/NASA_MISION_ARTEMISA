# Estudio de superficie completa del polo sur lunar

Fecha de revisión: 15 de noviembre de 2026. Ámbito solicitado: todo el casquete de la imagen, entre 80°S y 90°S; no toda la Luna.

## Resultado de la revisión

El motor anterior ya recorría los 12.892 centros regionales preparados. El problema de interpretación era que el mapa sólo dibujaba un candidato, algunas alternativas y unos ejemplos descartados. Esos símbolos no permitían distinguir la superficie evaluada de la superficie sin datos suficientes.

La actualización implementa un campo espacial de clasificación sobre todo el casquete renderizable y permite consultar cualquier sector, manteniendo los marcadores como referencias. Un color representa una decisión del modelo a su escala declarada; no certifica cada metro de suelo dentro de un polígono.

El producto es un análisis regional reproducible basado en NASA LOLA y JPL Horizons. No se atribuye validación institucional, capacidad de guiado de vuelo ni certificación de aterrizaje a la aplicación.

## Criterio de ingeniería y fuentes primarias

NASA describe la selección de lugares como un proceso iterativo que depende de los objetivos, de la capacidad del vehículo y de los datos disponibles. Su documento de arquitectura advierte que la tolerancia a obstáculos varía entre naves y que la disponibilidad de imágenes de alta resolución no es uniforme. La iluminación y la visibilidad de la Tierra cambian con la ubicación y con la fecha. Esto justifica una evaluación espacial y temporal, en lugar de una lista fija de puntos. [NASA, Lunar Site Selection](https://www.nasa.gov/wp-content/uploads/2024/02/15-2024-architecture-workshop-white-paper-lunar-site-selection.pdf).

Una revisión técnica reciente considera conjuntamente arquitectura de misión, disponibilidad temporal, variabilidad de pendientes dentro de la elipse de aterrizaje, cráteres y bloques. La priorización regional es una etapa previa al análisis del sitio y de la nave. Los umbrales de esta aplicación son parámetros de estudio propios; no se presentan como requisitos universales de NASA. [NASA NTRS, Artemis III Site Selection Update](https://ntrs.nasa.gov/citations/20250011660).

La literatura de diseño de misión también requiere satisfacer simultáneamente restricciones de los distintos vehículos y operaciones. Una transferencia de dos cuerpos y una animación vertical no equivalen a ese diseño integrado. [NASA NTRS, Artemis Lunar Mission Availability & Design](https://ntrs.nasa.gov/api/citations/20220012445/downloads/IAC2022_LunarMissionAvailability_Paper.docx.pdf).

## Datos y escalas que deben conservarse

| Elemento | Valor del conjunto regional actual | Interpretación |
| --- | --- | --- |
| Elevaciones originales | DEM NASA LOLA de 80 m | Espaciado del producto fuente; no tamaño mínimo de peligro verificable |
| Proyección | Estereográfica polar sur esférica, MOON_ME/DE421 | Debe coincidir con coordenadas, geometría y consulta astronómica |
| Radio de referencia | 1.737.400 m | Modelo esférico del conjunto |
| Rejilla de resultados | 128 × 128 cuadrados proyectados de 4.750 m | Agregación para el cribado regional |
| Centros dentro del casquete | 12.892 | No equivale a 12.892 sitios aprobados |
| Pendiente regional | Percentil 95 de pendientes nativas | No es el máximo ni la pendiente de la huella de la nave |
| Perfil por centro | 72 azimuts separados 5° | Horizonte angular muestreado, no horizonte continuo exacto |
| Cuantización angular | Hacia arriba en pasos de 0,05° | Conserva la obstrucción muestreada; no limita todos los errores |
| Observador | 2 m sobre la elevación local | Hipótesis declarada del cálculo actual |
| Cadencia de efemérides | 1 hora | Las transiciones entre muestras no se conocen al minuto |
| Cobertura lejana | Parcial; máximo nominal de 250 km | No se extrapola terreno fuera del DEM |

El archivo fuente regional es [LDEM_80S_80MPP_ADJ.TIF, NASA PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF). Su SHA-256 registrado es:

~~~text
82030dcbdd7c4bb0c7d858e9b4b293b9f2cda5a543ba31ec0f42784bd6beee5a
~~~

NASA publica productos locales de 5 m con mapas de error y realizaciones de terreno para estudiar la propagación de incertidumbre a pendientes e iluminación. Sus errores dependen del producto, la interpolación y la densidad de observaciones. Esos valores locales no se pueden copiar como barras de error del DEM regional de 80 m. [NASA PGDA, High-Resolution LOLA Topography](https://pgda.gsfc.nasa.gov/products/78).

## Algoritmo espacial

### 1. Dominio geográfico

Para latitud φ, longitud λ y radio R, la proyección usada es:

~~~text
ρ = 2 R tan((π/2 + φ)/2)
x = ρ sin λ
y = ρ cos λ

casquete: ρ ≤ 2 R tan(5°)
~~~

La capa de evaluación se recorta con ese dominio y utiliza la misma geometría que el relieve NASA. No se debe extender el resultado de una celda favorable a todo el cráter, ni interpolar el color hacia una región sin resultado.

El identificador de sector se obtiene por fila y columna de la rejilla, no buscando el marcador visible más cercano. La nueva textura de clasificación se inicializa como desconocida en las 128 × 128 posiciones y sólo sustituye valores por resultados de identificadores válidos; usa muestreo de vecino más cercano, sin interpolar riesgos. Un clic fuera de los círculos sigue teniendo un resultado regional o un estado explícito de datos insuficientes.

### 2. Pendiente desde datos nativos

Las derivadas se calculan en el DEM original, con vecinos válidos. La malla simplificada que utiliza el navegador para dibujar la Luna no alimenta la ciencia.

La corrección de escala de la proyección es:

~~~text
k(x,y) = 1 + (x²+y²)/(4 R²)
pendiente = atan(k · sqrt((∂z/∂x)² + (∂z/∂y)²))
~~~

Cada sector conserva pendiente mediana, P95 y máxima, cobertura y variación de elevaciones. Un P95 de 9° bajo un límite de 10° no demuestra que todo el sector esté por debajo de 10°. Tampoco la desviación de alturas en kilómetros mide el tamaño de las rocas.

Ejemplo auditado del candidato original polar:5:56: P95 de 9,4889°, máximo de 16,1644° y mediana de 3,9422°. Es una razón concreta para mostrar variabilidad y exigir refinamiento local, incluso si el criterio regional P95 se cumple.

### 3. Horizonte propio y cielo local

Para cada centro con datos suficientes, el perfil se obtiene del DEM de esa ubicación. No se reutiliza un único perfil central sobre todo el casquete.

Con distancia de arco d, elevación de terreno z y elevación del observador z₀, la elevación aparente geométrica del obstáculo es:

~~~text
δ = d / R
h = atan2((R+z) cos δ − (R+z₀+2), (R+z) sin δ)
H(azimut) = máximo h entre las muestras de ese rayo
~~~

Las consultas JPL aportan dirección aparente y distancia del Sol y de la Tierra. Se trasladan al marco este-norte-arriba de cada centro y se comparan con su horizonte. Horizons define azimut desde el norte hacia el este y elevación respecto al plano perpendicular al cenit local; la opción sin refracción es apropiada para este uso lunar. [JPL Horizons, definición de AZ-EL](https://ssd.jpl.nasa.gov/horizons/manual.html#obsquan).

La validación guardada frente a consultas independientes en tres ubicaciones y tres horas es una prueba parcial de esa transformación, no una validación de todos los horizontes, fechas o peligros. Véase [el informe de referencia](validation/global-reference-validation.json).

### 4. Criterios, sensibilidad y ordenación

Las decisiones conservan motivos legibles y valores medidos. El motor aplica este orden:

1. Comprobar cobertura y valores finitos.
2. Aplicar el criterio de terreno regional.
3. Evaluar el despeje de Sol y Tierra al llegar y en la estancia.
4. Calcular horas acumuladas, coincidencia y duración máxima de interrupciones.
5. Evaluar sensibilidad frente a los dos azimuts vecinos del perfil.
6. Ordenar primero candidatos que conservan cumplimiento en la sensibilidad; conservar los demás sectores en el mapa.

| Estado | Lectura correcta |
| --- | --- |
| Verde | Candidato regional que cumple los criterios y la regla de margen documentada |
| Amarillo | Resultado sensible o con condiciones que requieren precaución y refinamiento |
| Rojo | No cumple al menos un criterio de este escenario regional |
| Gris | Faltan datos o cobertura suficiente para esa decisión |

Rojo no demuestra que no exista ningún enclave aterrizable dentro del sector. Verde no demuestra que cualquier punto sea apto. Amarillo no debe expresar una probabilidad ni un intervalo de confianza si no existe un modelo de error que lo sostenga.

El motor calcula tres escenarios en cada época, usando los dos bins que rodean el azimut del astro:

~~~text
H_nom = interpolación lineal entre h_i y h_(i+1)
H_low = min(h_i, h_(i+1)) − 0,05°
H_high = max(h_i, h_(i+1))

despeje nominal = elevación del astro − H_nom
despeje inferior = elevación del astro − H_high
despeje superior = elevación del astro − H_low
~~~

Se evalúan el despeje en la llegada y las horas exigidas para ambos astros. Verde exige cumplimiento incluso usando H_high. Amarillo corresponde a cumplimiento nominal u optimista que no conserva el cumplimiento al usar H_high. Rojo exige un fallo de terreno o falta de cumplimiento incluso en los escenarios considerados. Un perfil insuficiente conserva el estado desconocido salvo que un criterio de terreno ya permita descartar el sector. El despeje de 0,3° es una decisión del modelo, no un estándar de certificación NASA.

Variar los bins vecinos de horizonte o un umbral angular permite estudiar sensibilidad al muestreo. No proporciona una cota física completa: entre dos azimuts de 5° puede existir un obstáculo no muestreado y entre muestras radiales puede existir relieve no resuelto. La cuantización de 0,05° tampoco engloba ese error.

### 5. Cobertura por superficie, no sólo por conteo

El área teórica del casquete es:

~~~text
A_cap = 2 π R² (1 − cos 10°)
      = 288.138,648654 km²
~~~

Los cuadrados proyectados no tienen idéntica área real. Para la esfera y esta proyección:

~~~text
dA_esfera = dx dy / k(x,y)²
A_sector = integral de dA_esfera en la intersección del cuadrado y el casquete
~~~

La auditoría inicial encontró una diferencia relevante en la preparación anterior:

- Sumar cuadrados completos de los 12.892 centros daría aproximadamente 288.662,23 km², superior al área del casquete.
- Aplicar las fracciones de borde preparadas da aproximadamente 287.390,98 km², cerca del 99,74% del área teórica.
- El borde restante, unos 747,67 km² según esa aproximación, no debe heredar la clasificación del centro vecino.

Una comprobación geométrica independiente integró el jacobiano esférico sobre cada intersección cuadrado–círculo: primitiva analítica en y y cuadratura de Gauss–Legendre en x, separando los cruces con los bordes. La convergencia de 32 a 256 nodos conservó estos resultados:

| Dominio geométrico de comprobación | Área aproximada |
| --- | --- |
| Cuadrados con centro preparado, recortados al casquete | 287.392,894168 km² |
| Fragmentos de 212 cuadrados cuyo centro queda fuera | 745,700093 km² |
| Casquete fuera del cuadrado fuente | 0,054393 km² |
| Casquete completo | 288.138,648654 km² |

La diferencia con la estimación basada en cap_fraction procede del muestreo y de aproximar el jacobiano por su valor central. El radio proyectado del paralelo 80°S es 304.005,608 m y el producto llega hasta ±304.000 m: la pequeña superficie exterior tampoco debe inventarse. Esta comprobación geométrica no añade datos de terreno ni perfiles a esos fragmentos.

Por tanto, la cobertura total mostrada debe cerrar contra el casquete: áreas clasificadas más superficie desconocida. Los fragmentos cuyo centro o perfil no esté preparado permanecen grises. No se utiliza un porcentaje de centros conocidos como si fuese cobertura espacial exacta.

## Contrato de visualización e inspección

La capa cubre todo el dominio renderizable y mantiene el relieve visible. El código y los controles permiten mostrar la evaluación completa o volver al relieve, además de seleccionar o señalar cualquier sector. El resultado completo se conserva en la respuesta del plan y el detalle horario de un sector se carga por identificador. Los contornos muestran cambios de clase, no curvas de nivel inventadas ni una elipse de aterrizaje certificada. La leyenda distingue las cuatro clases e indica la resolución del estudio.

Al tocar cualquier sector, la interfaz muestra sus métricas principales. La respuesta científica completa y la descarga conservan:

- Clase y motivos de decisión.
- Coordenadas del centro regional y escala de la celda.
- Pendiente P95 y máxima; cobertura de datos.
- Horas de Sol y Tierra, cuando se han evaluado.
- Cobertura de horizonte y sensibilidad, cuando estén disponibles.
- Requisitos de la misión que originan ese resultado.

El motor actual también evalúa Sol y Tierra en los sectores de pendiente desfavorable cuando existe un perfil suficiente. Si el perfil falta y la pendiente ya permite descartar, el sector sigue rojo con las métricas astronómicas sin calcular. La interfaz representa esos valores como ausentes; no sustituye una medición inexistente por cero horas.

Los marcadores de mejor candidato y alternativas ayudan a orientarse; el campo completo es la evidencia espacial principal. Cambiar fecha, estancia o criterios invalida el resultado anterior.

## Separación entre estadísticas regionales y observador central

La pendiente P95 y la máxima resumen píxeles nativos dentro de cada sector, mientras que el perfil de horizonte, la elevación del observador y las horas de Sol/Tierra representan su centro. La capa coloreada mantiene esa clasificación constante dentro del sector de 4,75 km para su interpretación cartográfica. No se han calculado perfiles astronómicos en cada píxel de 80 m ni se ha demostrado uniformidad de iluminación dentro del polígono.

Por tanto, «superficie completa» significa que todo el dominio visible tiene una clase o un estado desconocido y que no se limita a los marcadores. No significa que cada punto tenga una solución de aterrizaje independiente o que se haya validado una huella de nave en todo el área verde.

## Validación independiente realizada

Se auditaron fórmulas, orientación de ejes, unidades, filas de textura y selección sobre el terreno. La inversión usada por CPU y shader coincide con la geometría estereográfica del visor y la altura radial se cancela en la conversión a coordenadas. Los identificadores ausentes o riesgos no reconocidos conservan el estado desconocido.

Con las tres consultas originales NASA del ejemplo del 25 de diciembre se ejecutaron ambos motores y se compararon las 12.892 celdas por identificador. Coincidieron clase, horas solares y terrestres, horas simultáneas, cumplimiento nominal y de sensibilidad e interrupciones máximas: cero discrepancias en esos campos. La comprobación independiente de área con 256 nodos coincide con la integración de 8 nodos del motor en este dominio; se conserva la franja no representada como desconocida.

El ejemplo actualizado produce:

| Clase | Centros | Superficie aproximada, incluido el borde desconocido |
| --- | --- | --- |
| Verde | 9 | 198,092 km² |
| Amarillo | 2 | 34,029 km² |
| Rojo | 12.786 | 285.153,531 km² |
| Desconocido | 95 centros y borde sin centro preparado | 2.752,996 km² |

Las áreas pueden diferir en 0,001 km² al sumarlas por redondeo. El candidato regional principal sigue siendo polar:5:56. Los dos amarillos eran favorables nominalmente, pero resultaron sensibles al escenario de horizonte vecino. Los colores no se modificaron para producir una proporción deseada de zonas favorables.

Esta auditoría comprueba coherencia matemática y del escenario preparado. No sustituye validación externa de todo el DEM, ensayos de terreno, calibración integral de incertidumbre o certificación institucional. Las comprobaciones visuales y de interacción deben ejecutarse además en el navegador.

## Validaciones de regresión

| Prueba | Error que detecta |
| --- | --- |
| Cobertura completa del disco y borde desconocido | Huecos visuales o extensión de verde fuera de datos |
| Correspondencia fila/columna/coordenadas | Espejo, giro o desplazamiento de la capa |
| Área de las clases más desconocida igual al casquete | Porcentajes inflados y doble conteo |
| Pendientes obtenidas de la fuente nativa | Uso accidental de la malla visual para clasificar |
| Perfil faltante o terreno nodata | Conversión indebida a terreno plano o favorable |
| Cambios de clase con fecha y restricciones | Recomendaciones fijas o resultados obsoletos |
| Clic lejos de marcadores | Interfaz que sólo consulta la lista de puntos |
| Igualdad de motores Python y Worker | Divergencias entre ejecución local y otra plataforma |
| Horizonte geométrico y orientación ENU | Signos incorrectos, curvatura o norte equivocados |
| Error de proveedor externo | Aparición de una recomendación fabricada |

La publicación de una capa detallada visualmente no aumenta la resolución científica de los datos. Un estudio de aterrizaje operativo requeriría, entre otras tareas, análisis de elipse y dispersión, peligros y huella a escala local, incertidumbres de terreno propagadas, trayectoria y navegación, energía, térmica, radio y restricciones concretas del vehículo.
