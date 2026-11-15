# LUNAR ORACLE: decisiones de misión y evolución hacia un gemelo digital

Investigación: 15 de noviembre de 2026. Alcance del producto actual: casquete lunar 80–90°S, ejecución local. Este documento propone una secuencia de ingeniería; distingue funciones existentes, trabajo en integración y capacidades futuras.

## La mejora con mayor valor para el reto

El caso «quiero viajar el 1 de diciembre de 2026 a las 10 am» debe generar una decisión útil incluso cuando ningún sector satisface los requisitos. El resultado esperado es: explicar qué bloquea el escenario, buscar alternativas que conserven sus restricciones, comparar los cambios y permitir aplicar una propuesta para recalcular el mapa completo.

Esto responde directamente al texto del reto aportado por el usuario: ante retrasos y cambios de misión, las personas necesitan comparar fechas y lugares rápidamente y comprender sus consecuencias para la iluminación y la comunicación. La aplicación debe demostrar ese recorrido con un caso real reproducible.

La [página oficial del reto 2026](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/) no pudo recuperarse durante esta revisión: respondió con error de acceso. Para el contenido del reto se utilizó la copia íntegra adjunta por el usuario, identificada como «Lunar Landing Site Navigator», 2026, CLPS. No se usaron repositorios de otros participantes como autoridad científica o reglamentaria.

## Qué significa acercarse a un gemelo digital

El informe NASA/TM-20250008957 describe representaciones de entidades físicas con modelos predictivos y datos actualizados, y discute la sincronización con una frecuencia y fidelidad declaradas. La actualización no tiene que ser una transmisión cada segundo. Sí debe existir una relación explícita entre la entidad representada, sus observaciones, el modelo y las decisiones que se toman con él. [NASA NTRS, informe de sistemas complejos y gemelos digitales](https://ntrs.nasa.gov/citations/20250008957), sección 3.2.3.

Una representación ambiental del polo sur puede evolucionar con observaciones versionadas y validación contra ellas. Un gemelo operacional de una nave requiere además identificar su configuración y estimar estados físicos contrastables. Incorporar mapas NASA y una animación no demuestra por sí solo ese acoplamiento.

Para LUNAR ORACLE propongo tres niveles de alcance verificable:

| Nivel | Qué representa | Evidencia mínima |
| --- | --- | --- |
| Planificación científica, actual | Terreno regional y geometría de Sol/Tierra para escenarios hipotéticos | Fuentes, versiones, coordenadas, fechas, restricciones, incertidumbres y resultados reproducibles |
| Prototipo de gemelo ambiental | Una región lunar y su estado estimado, actualizado con observaciones identificadas | Política de actualización, observaciones de validación, cobertura y residuos entre predicción y observación |
| Prototipo de gemelo de misión | Región más una nave identificada, actividades y estados de recursos | Configuración de nave, estado inicial, flujo o importación de mediciones, estimador, predicción y validación de estados |

Las dos últimas filas son una hoja de ruta, no capacidades que el producto actual deba anunciar como validadas.

## Orden de implementación recomendado

| Prioridad | Función | Decisión que permite tomar | Estado en esta revisión |
| --- | --- | --- | --- |
| P0 | Rescate automático del escenario | Qué fechas o lugares satisfacen las mismas restricciones | Implementado y probado con respuestas NASA originales |
| P0 | Comparador del escenario original y propuestas | Qué cambió, qué se preservó y qué mejora realmente | Implementado: aplicación explícita y exportación de la comparación |
| P1 | Ventanas operativas y cuenta atrás | Cuándo se pierde o recupera Sol/Tierra y cuánto dura el peor corte | Implementado con cadencia horaria, intervalos y fin de datos explícitos |
| P1 | Modelo configurable de energía y memoria | Si la nave puede sostener la operación durante los cortes | Requiere parámetros de vehículo y actividades; no inferirlos de la apariencia del mapa |
| P2 | Planificación de actividades y frontera de compromisos | Qué observaciones ejecutar con energía y comunicaciones disponibles | Depende del modelo de recursos |
| P2 | Refinamiento local y validación independiente | Si la preselección regional se mantiene a escala de huella | Requiere datos locales y tolerancias de nave |
| P3 | Sincronización y evaluación de estados | Cómo cambia la predicción al incorporar una observación nueva | Requiere entidad, mediciones y protocolo de validación definidos |

Este orden es una recomendación de producto: prioriza una mejora comprobable de decisiones frente a añadir funciones cuya fidelidad todavía no puede demostrarse.

## P0: resolver el caso sin solución

### Contrato de la búsqueda

1. Conservar pendiente máxima, estancia, horas mínimas de Sol/Tierra, altura del observador y sentido de la fecha. «Viajar» y «alunizar» no son fechas equivalentes.
2. Evaluar primero qué sectores tienen terreno y horizontes suficientes. Los desconocidos no se convierten en favorables para aumentar el número de soluciones.
3. Diagnosticar la viabilidad temporal entre los sectores que superan el filtro estático. Que gran parte del polo tenga pendiente excesiva no explica por sí solo un bloqueo de fecha.
4. Explorar un intervalo y una cadencia declarados, con consultas NASA por lotes. Refinar alrededor de las opciones prometedoras conservando la rejilla temporal.
5. Devolver propuestas verificadas bajo el mismo modelo y distinguirlas de sugerencias pendientes de estudio.
6. Si el intervalo no contiene una solución, comunicar «sin solución en el intervalo explorado». Una búsqueda limitada no demuestra imposibilidad global.
7. Aplicar una propuesta de forma explícita y recalcular el mapa. La petición original y sus resultados deben seguir disponibles para comparación.

La búsqueda no debe hacer cambios implícitos como reducir 50 horas de Sol a 24 cuando la estancia baja a 24 horas. Las incompatibilidades deben mostrarse y resolverse por decisión del usuario.

### Datos de cada propuesta

- Fecha original y propuesta, zona horaria, significado de la fecha y desplazamiento.
- Llegada y estancia analizadas; tránsito etiquetado con su modelo.
- Sector candidato y escala de representación.
- Restricciones conservadas y resultado de cada una.
- Horas de Sol, Tierra y simultáneas; peores interrupciones y sensibilidad angular.
- Cambio respecto al escenario original.
- Fuentes, consultas, fecha de recuperación, resolución, cobertura y límites de la búsqueda.

La propuesta «más próxima entre las evaluadas» no debe presentarse como el primer instante continuo físicamente posible. Un muestreo diario con refinamiento horario puede omitir ventanas entre muestras o soluciones fuera del intervalo.

### Caso preparado para verificar el rescate

El motor dispone de un [caso reproducible con respuestas NASA originales](../data/prepared/rescue_example.json). Para la salida original del 1 de diciembre de 2026 a las 10:00 de Bolivia, con estancia de 72 horas, pendiente P95 máxima de 10° y mínimos de 12 horas de Sol y Tierra, el escenario no tiene candidatos favorables bajo el modelo.

La búsqueda examina 38 instantes dentro de 14 días: selecciona inicialmente días completos y refina por hora antes del primer día compatible. Entre los instantes examinados, encuentra una salida el 7 de diciembre a las 12:00 de Bolivia, un desplazamiento de 146 horas. La llegada estimada analizada es el 13 de diciembre a las 00:00 UTC y el centro candidato polar:32:95 presenta 72 horas de Sol y Tierra. Una consulta exacta posterior del escenario produce un sector verde en el mapa completo.

El centro tiene pendiente P95 nominal de 9,9843°: cumple el umbral de 10°, pero apenas dispone de margen nominal de pendiente. El escenario de sensibilidad angular del horizonte no cubre la incertidumbre del DEM ni demuestra tolerancia de la nave. Esta es una razón para comparar alternativas y solicitar refinamiento local, no para anunciar que el aterrizaje está validado.

Los resultados son evidencia del modelo y de su búsqueda acotada. No prueban que ese sea el primer instante físico posible ni que la trayectoria simplificada sea una ventana de lanzamiento real.

### Qué debe explicar la IA

El algoritmo calcula las propuestas. La IA puede traducir el resultado a una explicación breve, por ejemplo: «La fecha original no mantiene la Tierra por encima del horizonte en los sectores elegibles; esta alternativa cambia la salida y conserva la estancia y los requisitos». Esa frase sólo debe mostrarse si el diagnóstico calculado la respalda.

No debe atribuir a un único sector descartado la causa de la inviabilidad de todo el casquete. Tampoco debe proponer «usar un satélite» o «subir la antena» como soluciones verificadas sin el cálculo correspondiente.

## P1: convertir geometría en operaciones

Las publicaciones de CLPS distinguen capacidad de potencia, datos y supervivencia, y muestran que esas prestaciones dependen del vehículo y del concepto de operación. Eso justifica incluir parámetros de nave y actividades. No permite deducir los parámetros de una misión real a partir de una cantidad de horas de luz. [NASA Science, programa CLPS](https://science.nasa.gov/lunar-science/programs/clps/).

### Ventanas y cuentas atrás

Sobre la serie específica del sector seleccionado:

- Próximo intervalo de pérdida/recuperación de Sol y Tierra.
- Mayor interrupción continua y comienzo del próximo corte.
- Ventanas simultáneas para actividades que necesitan ambos.
- Cortes ya presentes al comenzar el intervalo.
- Eventos que no aparecen antes del final: «no observado en el intervalo», evitando inventar una hora posterior.

Con muestras horarias, un cruce se informa como intervalo entre muestras. No debe mostrarse una cuenta atrás precisa al minuto sin refinar la consulta o resolver el evento con un método apropiado. [NAIF/JPL, SPICE y búsqueda de eventos geométricos](https://naif.jpl.nasa.gov/naif/spiceconcept.html).

### Perfiles de vehículo y alturas

Un catálogo de ejemplos y archivos de perfil puede ayudar a explorar diseños, siempre que sus valores no se presenten como especificaciones verificadas de un fabricante. Los nombres comerciales no validan una altura de panel, una antena ni una tolerancia de pendiente.

El contrato científico es conservar el observador de referencia de 2 m mientras sus perfiles de horizonte sean los únicos preparados. Si se elige una altura diferente, la obstrucción y las horas del emisor cuya altura cambió quedan sin determinar hasta calcular un perfil propio para esa altura. Cambiar la posición del emisor o el tamaño de un modelo 3D no aporta ese perfil.

La pendiente máxima solicitada debe permanecer separada de una supuesta tolerancia del vehículo. La estabilidad depende de geometría de apoyo, masa, centro de gravedad, dinámica y terreno; un parámetro llamado «tolerancia del centro de gravedad» no demuestra por sí solo un ángulo admisible de aterrizaje. Si cambiar un perfil modifica un criterio de estudio, debe declararse como un escenario nuevo.

En una importación se deben distinguir metadatos, geometría y características de ingeniería. Los campos ausentes no deben convertirse silenciosamente en 15 m de panel, 12 m de antena o un umbral de pendiente. Un archivo GLB es binario; el JSON de un glTF y sus campos extras no certifican dimensiones de hardware o tolerancias. La especificación reserva extras para datos de aplicaciones y define un contenedor distinto para GLB. [Khronos, glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).

La animación de descenso con una configuración genérica debe seguir identificándose como tal mientras no reciba masa, empuje, combustible y leyes de guiado del vehículo considerado. Ni la malla importada ni un nombre de nave constituyen un gemelo de ese vehículo.

### Energía con hipótesis visibles

Un modelo inicial explícito puede usar:

~~~text
P_pv(t) = S_1AU × (AU / r_sol(t))² × A × η × f(t)
          × max(0, n_panel(t) · direccion_sol(t)) × visibilidad_sol(t)

P_balance(t) = P_pv(t) − P_carga(t)
E_siguiente = E_actual
              + η_carga × max(P_balance, 0) × Δt
              − max(−P_balance, 0) × Δt / η_descarga
~~~

Son ecuaciones propuestas para un modelo configurable, no resultados actuales ni parámetros certificados de NASA. Área, eficiencia, orientación, degradación, batería, límites de estado de carga, modos y consumos deben introducirse o vincularse a una ficha de vehículo. Calefacción, radio y cargas científicas forman parte del consumo.

Al agotarse la batería, el modelo debe registrar el déficit y el modo de fallo o reducción de carga; limitar la energía a cero no puede borrar el fallo. Los resultados útiles son estado de carga mínimo, energía no suministrada, duración de funcionamiento y reserva disponible.

La supervivencia térmica necesita su propio modelo o una capacidad de vehículo demostrada. Un balance eléctrico positivo no prueba que el equipo sobreviva al frío. El estudio CHIPS combina explícitamente objetivos térmicos y eléctricos en un concepto de aterrizador; sus cifras pertenecen a ese estudio y no se deben copiar como valores universales del proyecto. [NASA NTRS, modelado térmico CHIPS](https://ntrs.nasa.gov/citations/20220005798).

### Comunicación y memoria

La visibilidad de la Tierra es una condición geométrica. El enlace necesita también banda, potencia de transmisión, antenas, apuntamiento, pérdidas, estación terrestre y presupuesto de enlace. Una primera extensión honesta puede estimar una cola de datos con una tasa configurada y ventanas geométricas, etiquetando que la tasa no está validada por un cálculo RF.

Cuando el enlace no está disponible, los datos se acumulan; al recuperarse se transmite con la tasa configurada. Comparar memoria máxima usada, datos entregados antes del plazo y cortes mayores permite planificar actividades científicas.

Una alternativa con relé necesita órbitas y geometría de visibilidad de ese relé, capacidad de enlace y disponibilidad de servicio. Un horizonte recalculado para mayor altura requiere de nuevo terreno y geometría: no basta con reutilizar los perfiles preparados a 2 m. NASA trata este acoplamiento entre capacidades, objetivos y datos como parte de un proceso iterativo de selección. [NASA, Lunar Site Selection](https://www.nasa.gov/wp-content/uploads/2024/02/15-2024-architecture-workshop-white-paper-lunar-site-selection.pdf).

## P2: la innovación demostrable

Mi propuesta diferencial es un planificador que responda a cambios de misión y conserve un historial de decisiones:

- Comparar A/B/C con una misma línea temporal y unidades.
- Mantener una frontera de opciones no dominadas: demora, reserva energética, interrupción y tiempo de ciencia. No ocultar compensaciones en una puntuación sin explicar.
- Demostrar qué cambio mínimo, entre los explorados, permite cumplir: fecha, ubicación o una modificación de vehículo tratada como escenario nuevo.
- Explicar la diferencia entre un resultado nominal, uno sensible al muestreo y uno desconocido.
- Exportar un paquete reproducible con entradas, versiones, observaciones y reglas.

La demostración convincente sería: una misión falla, el sistema explica el bloqueo, ofrece propuestas trazables, el usuario aplica una, y el mapa, la línea temporal y los recursos cambian de manera coherente. Si después cambia el consumo o se retrasa el aterrizaje, el sistema vuelve a evaluar el mismo contrato.

Como referencia de ingeniería, un trabajo de NASA Stennis y sus colaboradores demuestra replanificación de actividades ante fallos y diagnóstico de un subsistema eléctrico mediante una arquitectura de gestión de vehículos. Incluye simulación representativa y visualización de estados. Su valor como referencia para este proyecto es el enlace entre condición física, fallo, explicación y cambio del plan; no implica afiliación ni validación de LUNAR ORACLE. [NASA NTRS, Risk-Reduction Autonomy Implementation to Enable NASA Artemis Missions](https://ntrs.nasa.gov/citations/20210022389).

## P3: datos y validación para un gemelo

Antes de anunciar un gemelo validado hay que definir:

| Elemento | Mínimo que debe registrarse |
| --- | --- |
| Entidad representada | Región, referencia geodésica, vehículo o configuración de diseño e identificador |
| Estado y unidades | Fecha, posición, orientación, batería, temperatura y modo según el alcance elegido |
| Observación | Valor, unidad, instante, origen, calidad, incertidumbre y si es medida, estimada o simulada |
| Sincronización | Frecuencia, latencia, reglas de actualización, versiones y tratamiento de datos ausentes |
| Predicción | Horizonte temporal, modelo, parámetros, condiciones iniciales y restricciones |
| Evaluación | Datos separados de calibración y validación, residuos, tolerancias justificadas y casos límite |
| Decisión | Acción propuesta, cambios aceptados, responsable y resultado posterior |

Las mediciones pueden llegar mediante archivos importados; no hace falta inventar una conexión con una nave. Si se usa una reproducción o telemetría sintética para una demostración, debe identificarse como tal. La consistencia Python/JavaScript es una prueba de implementación, no validación física independiente.

## Evidencia que conviene presentar

1. Caso original del 1 de diciembre de 2026 a las 10:00 de Bolivia, con restricciones y diagnóstico registrados.
2. Caso viable recalculado, sin alterar requisitos para fabricar una solución.
3. Escenario sin solución dentro del intervalo: resultado honesto y posibilidad de ampliar el alcance.
4. Comparación con consultas o herramientas independientes en varias regiones y fechas, con tolerancias declaradas antes de evaluar.
5. Pruebas de datos ausentes, caída del proveedor, zona horaria, duración, bordes y sensibilidad.
6. Mediciones de tiempo de respuesta y una prueba con usuarios que muestre rapidez para comparar y comprender las propuestas.

Las páginas de algunos eventos locales 2026 alojadas en el portal citan impacto, creatividad, validez, relevancia y presentación. Son contenidos de organizadores locales y no sustituyen el manual global ni las reglas de la sede del equipo. [Space Apps Ajmer 2026](https://www.spaceappschallenge.org/2026/local-events/ajmer/), [Space Apps Islamabad 2026](https://www.spaceappschallenge.org/2026/local-events/islamabad/). No se afirma que esta hoja de ruta garantice premios o interés institucional.

El mayor avance inmediato es cerrar el ciclo «evaluar, explicar, proponer, comparar y recalcular». El camino hacia el gemelo exige después conectar ese ciclo con estados y observaciones del sistema que se desea representar.


## Perfiles de nave: evidencia antes de comparar hardware

El chat permite importar un perfil JSON o metadatos JSON glTF y elegir ejemplos hipotéticos del catálogo. Cada archivo debe declarar altura de paneles, altura de antena y límite de pendiente; se rechazan números ausentes, booleanos y valores fuera de rango. El nombre se toma de los metadatos o del archivo. El límite es 1 MiB y no se admiten archivos GLB binarios. La apariencia y el nombre del objeto no verifican sus especificaciones físicas.

El conjunto actual de horizontes corresponde a un observador a 2 m. Una altura diferente requiere calcular su horizonte desde el terreno; hasta entonces, sus horas de Sol/Tierra quedan desconocidas y el rescate no propone una fecha ficticia. No se utiliza una distancia arbitraria a obstáculos para conceder visibilidad a vehículos altos. El límite efectivo de pendiente es el menor entre la preferencia del usuario y el límite declarado por el perfil; cargar un vehículo nunca relaja la preferencia.

Gemini recibe un resumen compacto de mediciones, fuentes y cobertura. Su explicación no convierte despeje solar en energía, visibilidad de la Tierra en capacidad de transmisión, ni pendiente regional en estabilidad mecánica o supervivencia. El descenso sigue siendo un ensayo de una nave genérica hipotética, sin parámetros dinámicos identificados de los objetos del catálogo.
