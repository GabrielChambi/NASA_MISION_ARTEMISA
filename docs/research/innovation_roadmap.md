# Mejoras para competir: IA, planificación y evidencia

Investigación del 14 de noviembre de 2026. **Propuesta y experimento; las funciones de IA descritas aquí todavía no están integradas en la web.** El código de la aplicación no se ha modificado con esta investigación.

## Recomendación

Desarrollar un **copiloto de misión que encuentre alternativas verificables y explique el cambio mínimo necesario para cumplir unos objetivos**. Añadir después análisis de robustez, incertidumbre del terreno y energía.

La propuesta central del producto: «Dime qué necesita tu misión y te mostraré dónde, cuándo y con qué margen puedes cumplirlo, bajo las condiciones analizadas».

La IA interpreta el objetivo y explica resultados. El cálculo astronómico, las ventanas, las restricciones y las alternativas se resuelven con el motor científico. La búsqueda matemática es optimización; no hay que presentarla como una red neuronal o un modelo entrenado.

## Qué respalda esta elección

1. El [reto oficial 2026](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/) pide comparar lugares y fechas rápidamente, mostrando Sol y Tierra frente al horizonte. La búsqueda automática y una explicación accesible responden directamente a ese problema. Su resumen oficial estaba indexado al investigar; la apertura directa devolvió 502.
2. Moon Trek ya ofrece análisis de iluminación y línea de visión con DEM y SPICE. Su [equipo describe esas herramientas](https://www.hou.usra.edu/meetings/planetdata2021/eposter/7063.pdf). Por tanto, construir otro mapa requiere una propuesta de decisión, usabilidad o evidencia que lo diferencie.
3. [NASA LOLA Product 78](https://pgda.gsfc.nasa.gov/products/78) ofrece incertidumbre de altura y pendiente y conjuntos de 100 clones del relieve, utilizados para estudiar también variaciones de iluminación. En nuestra aplicación esas incertidumbres aún no se propagan a las ventanas: existe una mejora científica concreta.
4. Un [informe NASA de operaciones polares](https://ntrs.nasa.gov/citations/20250004275) explica la necesidad de información adaptable ante un entorno dinámico. Esto respalda comparar planes y recalcularlos ante cambios.
5. Un [preprint del 9 de noviembre de 2026](https://arxiv.org/abs/2611.13292) estudia asistentes LLM que explican y comparan planes lunares mediante herramientas. Es un precedente para la arquitectura; no demuestra la precisión de nuestro futuro asistente ni permite afirmar que inventamos esta técnica.
6. La [guía de evaluación 2025 disponible](https://spaceapps-v2-staging.s3.amazonaws.com/media/documents/Final_Space_Apps_2025_Judging_Guidelines_for_web.pdf) considera impacto, creatividad, validez, relevancia y presentación. Se usa aquí como referencia estratégica de una edición anterior; **no se verificó una guía general completa de 2026 ni se atribuyen pesos oficiales a esta propuesta**.

La diferenciación propuesta es una hipótesis de producto, no un estudio exhaustivo de novedad mundial ni una garantía de premio.

## Experimento: ya hay una historia demostrable con nuestros datos

Se probaron dos puntos, una misión superficial de 72 horas, altura 2 m, horizonte LOLA parcial y paso de 60 minutos. Necesidades elegidas para el experimento: al menos 60 h de Sol, 36 h de Tierra visible acumulada y pendiente del píxel ≤10°.

Se unieron por UTC las series originales NASA de las ventanas nominal y +12 h. Las 244 muestras que coinciden entre respuestas concuerdan antes de unirlas. Luego se examinaron 26 ventanas: 13 inicios horarios entre +0 y +12 h para cada punto. Se usan exclusivamente muestras existentes, sin interpolación, sin consultas nuevas y sin IA.

| Alternativa en Site01 | Desplazamiento del inicio | Sol | Tierra acumulada | Peor Tierra en los cinco escenarios horarios cubiertos |
| --- | --- | --- | --- | --- |
| Ventana inicial | +0 h | 72 h | 29 h | Cobertura insuficiente para analizar −2 h; el nominal ya incumple |
| Primer inicio que cumple en la rejilla | +7 h | 72 h | 36 h | 34 h: incumple ante algunos cambios |
| Primer inicio robusto dentro de la rejilla con cobertura completa | +9 h | 72 h | 38 h | 36 h: cumple en los cinco escenarios |

Los cinco cambios de hora ensayados son −2, −1, 0, +1 y +2 h respecto al inicio propuesto. Para +9 h corresponden a inicios +7…+11 h; la Tierra visible varía de 36 a 40 h. Site04 no cumple dentro de los inicios probados: tiene 0 h de Tierra con este horizonte y su pendiente de referencia supera el umbral elegido.

**Interpretación:** escoger el primer plan que pasa deja poco margen. Una búsqueda que además somete el plan a cambios puede explicar por qué conviene otra alternativa. Esta es una demostración más fuerte que generar recomendaciones sin cálculo.

**Límites del experimento:** mínimos solamente en la rejilla y puntos probados, no un óptimo global ni continuo. Robustez ante cinco cambios temporales, no incertidumbre del terreno ni una probabilidad calibrada. Son horas acumuladas de centro terrestre visible, no un enlace de radio. El plan +7 h conserva un hueco de Tierra de 36 h; no se impuso aquí máximo de apagón, batería o temperatura. Desplazar la ventana superficial no calcula la viabilidad de lanzamiento u órbita. La cobertura insuficiente se conserva como desconocida.

Reproducir:

~~~powershell
api/.venv/Scripts/python.exe api/scripts/research_mission_repair.py
~~~

Evidencia: [mission_repair_experiment.json](mission_repair_experiment.json). Incluye cada candidato, casos de robustez, consultas NASA originales y SHA-256 de registros, catálogo y perfiles.

## Prioridades de implementación

Esta tabla expresa nuestra evaluación de producto y esfuerzo relativo, no una puntuación NASA.

| Prioridad | Mejora | Qué vería el usuario | Valor esperado | Esfuerzo / dependencia |
| --- | --- | --- | --- | --- |
| 1 | Búsqueda de lugar y fecha | Tres alternativas comparables bajo sus objetivos | Alto: reduce trabajo manual | Medio; se reutiliza el motor actual |
| 1 | Explicación del cambio mínimo | Motivo de incumplimiento y cambio de fecha/altura permitido | Alto: decisión entendible y demostrable | Medio; búsqueda acotada y restricciones explícitas |
| 1 | Copiloto IA con herramientas | Escribir una misión y recibir resultados calculados con fuentes | Alto: accesibilidad | Medio; backend LLM, esquemas y evaluación |
| 2 | Robustez temporal | Plan nominal y plan que soporta los escenarios ensayados | Alto: margen visible | Medio; el experimento ya demuestra el cálculo |
| 2 | Elipse y varios puntos | Calidad del área posible de llegada, cobertura y pendientes | Alto: supera el análisis de un solo píxel | Alto; horizontes y georreferenciación por punto |
| 2 | Incertidumbre LOLA | Bandas de duración y cambios de ranking según el relieve | Alto: profundidad científica | Alto; adquisición y procesado de conjuntos de terreno |
| 3 | Paneles y batería | Potencia modelada, reserva y déficit energético en el tiempo | Alto: conecta luz con operación | Medio/alto; orientación, área, eficiencia, carga y capacidad |
| 3 | Ruta de rover y regreso | Recorrido condicionado por hora, energía y sombras | Alto, pero más allá del núcleo | Alto; terreno, movilidad y estado temporal validados |

El alcance inicial recomendado es **dos puntos, búsqueda de fechas, cambio mínimo, pruebas temporales y copiloto**. Elegir una sola historia de misión y dejar las otras funciones como evolución.

## Copiloto: comportamiento concreto

Ejemplo de entrada:

> Quiero una misión de 72 horas. Necesito 60 horas de luz y 36 horas de Tierra visible. Puedo cambiar el inicio hasta 12 horas y no quiero aumentar la pendiente máxima de 10 grados.

El sistema convierte la petición en campos visibles: fechas, duración, mínimos acumulados, huecos máximos si se especifican, altura, horizonte y cambios permitidos. Si «comunicación continua» o «batería suficiente» no están definidos, explica la diferencia y solicita el dato necesario; no los interpreta como simples horas acumuladas.

Secuencia:

~~~mermaid
flowchart LR
    U["Objetivo del usuario"] --> I["IA interpreta y explica"]
    I --> V["Parámetros validados y visibles"]
    V --> P["Búsqueda y pruebas de escenarios"]
    D["NASA y perfiles LOLA trazables"] --> P
    P --> E["Resultados y evidencia estructurada"]
    E --> X["IA explica usando los resultados"]
    X --> W["Alternativas, mapa, reloj y fuentes"]
~~~

Herramientas propuestas: analizar misión, buscar ventanas, comparar planes, ensayar cambios, consultar fuentes y explicar restricciones. Las respuestas vinculan cada cifra a un campo del resultado y a su identificador de ejecución. La interfaz puede mostrar esas cifras directamente desde JSON, evitando depender de números escritos libremente por el modelo.

El modelo llama herramientas autorizadas; no modifica las ecuaciones, no inventa alturas sin perfil ni declara seguridad por el aspecto del mapa. Las restricciones obligatorias del usuario permanecen fijas. Una relajación se propone por separado y se muestra su consecuencia.

El visitante entra directamente a nuestra página. La integración de IA se realizaría desde el backend, con la credencial del proveedor fuera del navegador; no requiere que el visitante inicie sesión con ChatGPT. Si la IA no está disponible, se conserva la planificación determinista y se identifica ese modo.

## Optimización y velocidad

- Para buscar muchas fechas, adquirir una serie suficientemente amplia por cuerpo, punto y altura; reutilizar sus muestras en ventanas móviles. No hacer una consulta Horizons por cada hora candidata.
- Mantener los parámetros, fechas y procedencia del intervalo original al derivar ventanas. No presentar un recorte como si NASA hubiera respondido directamente a otra consulta.
- Minimizar primero el cambio permitido respecto a la misión y luego mostrar compromisos entre luz, Tierra, huecos y robustez. Conservar empates y casos sin solución.
- Declarar la resolución temporal y el universo examinado. «Primera solución en la rejilla probada» es diferente de «mejor fecha de toda la Luna».
- Al añadir puntos espaciales, calcular sus propios horizontes. No trasladar a toda una zona la iluminación del píxel central.

## La mejora científica más fuerte: incertidumbre del área

Una elipse de llegada representaría dispersión elegida por el usuario o por un modelo de navegación explícito; no una elipse real NASA inventada. Las celdas se mostrarían como cumplen, no cumplen o carecen de datos, según pendiente, relieve y ventanas calculadas.

Después se podría repetir el análisis con los clones LOLA y resumir la variación de ventanas y ranking. Conviene conservar las propiedades espaciales de los conjuntos publicados: añadir ruido independiente a cada píxel no equivale a reproducir la incertidumbre del producto.

Mostrar «cumple en N de M terrenos/escenarios» o bandas del conjunto evaluado. Eso no significa «N/M de probabilidad de aterrizar con éxito». El análisis requiere estudio de cobertura y calibración antes de una interpretación probabilística.

Antes de ampliar el dominio, cerrar el contraste de marcos y geometría con SPICE. [NAIF advierte que comparar cálculos exige alinear efemérides, marcos, modelos y correcciones](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/problems.html); no basta con usar el mismo nombre «Luna».

## Energía y rover: evolución posterior

La [documentación de operaciones de VIPER](https://science.nasa.gov/mission/viper/lunar-operations/) vincula itinerarios, sombras móviles y períodos sin comunicaciones. Un balance energético de nuestra herramienta necesitaría parámetros de panel, orientación, carga, batería y pérdidas; no se deduce una batería real de las horas de Sol.

La ruta temporal sería una extensión posterior con búsqueda de caminos y regreso a una zona con recursos. Existe [investigación de planificación consciente de fallos y energía](https://papers.starslab.ca/safe-mission-level-planning/), por lo que debe presentarse como adaptación y evaluación de métodos, no una invención sin antecedentes.

## Qué demostrar ante el jurado

1. Introducir los objetivos y comprobar que se interpretan correctamente.
2. Mostrar la ventana inicial que incumple una necesidad.
3. Encontrar el cambio mínimo dentro del rango permitido, con las ventanas antes/después.
4. Añadir los cinco errores horarios y mostrar que el primer plan pierde margen.
5. Elegir la alternativa robusta y explicar el coste de ese margen.
6. Abrir la fuente NASA de una cifra y exportar el informe reproducible.
7. Repetir el caso sin IA para verificar que la decisión numérica se conserva.

Evaluación propuesta: comparar el buscador con enumeración exhaustiva de una rejilla pequeña; verificar todos los escenarios declarados; probar peticiones ambiguas e imposibles; contrastar cada cifra de las respuestas IA con el JSON. Medir tiempo y errores de tarea con usuarios frente al flujo manual. Son pruebas y metas pendientes, no resultados ya obtenidos.

La presentación debe mostrar funciones terminadas. El prototipo de esta investigación aún no constituye un asistente IA desplegado. La versión actual también necesita resolver su publicación para que el jurado pueda abrir la revisión correcta sin permisos; una demo EN/ES y evidencia accesible mejorarían su alcance.

## Qué pospondría

Entrenar desde cero un modelo grande, usar aprendizaje por refuerzo para todo el descenso, un detector de hielo sin datos adecuados o una puntuación de seguridad sin calibrar. Esas tareas necesitan datos y validaciones adicionales y desplazarían el esfuerzo de la comparación de lugares y fechas.

La siguiente entrega concreta recomendada es **un buscador de ventanas con cambio mínimo y robustez temporal, seguido de una interfaz IA que utilice exactamente esos resultados**.
