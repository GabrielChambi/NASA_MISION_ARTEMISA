# Exploración regional y copiloto Gemini

Esta revisión corrige una confusión de escala: el cuadrado coloreado anterior era una rejilla local de 1,05 km, no el alcance del mapa lunar. La entrada ahora empieza en todo el casquete de 80 a 90 grados sur y separa tres acciones: explorar, elegir y planificar.

## Evaluación regional

La fuente es el GeoTIFF NASA LDEM_80S_80MPP_ADJ.TIF original, de 80 m. Una rejilla de 128 × 128 conserva el dominio rectangular de la proyección y nodata, con 12.892 centros conocidos dentro del casquete. Cada celda mide 4,75 km. Se leen los píxeles originales con una corona para calcular gradientes, se corrige la escala estereográfica y se agregan mediana, percentil 95, máximo, relieve y cobertura.

La clase verde indica prioridad regional de estudio. El percentil 95 debe estar bajo el umbral con margen y sin pendientes máximas que obliguen a precaución. Amarillo conserva las zonas con pendientes locales pronunciadas o margen reducido. Rojo indica relieve regional exigente, no ausencia de enclaves aprovechables. Datos desconocidos no se convierten en terreno plano.

La cobertura de área es aproximada: 287.390,98 km² de un casquete analítico de 288.138,65 km². El borde finito de celdas y nodata se declara sin evaluar. No existe una certificación continua para cada metro de la Luna.

El mapa visual de ~791 m recibe las clases de la rejilla científica; el análisis NO obtiene sus pendientes de esa malla visual. La selección usa coordenadas lunares, puede acercar cualquier zona y permite comparar tres candidatos geográficamente separados. Es una búsqueda calculada determinista.

No se ha trasladado a toda la región el horizonte de un píxel central. El Sol, Tierra y descenso siguen siendo un análisis separado en las dos áreas con detalle y perfiles disponibles. Añadir horizontes por zona y contrastar los marcos con SPICE es una fase posterior.

## Copiloto

El servidor admite Gemini nativo con generateContent y respuesta JSON estructurada. La clave viaja en x-goog-api-key desde el servidor al proveedor. AI_PROVIDER, AI_MODEL y GEMINI_API_KEY se leen de configuración privada del servidor; el navegador nunca recibe la clave. El modelo por defecto es configurable.

El navegador envía un contexto acotado de la vista: selección, resolución, cobertura, evaluación, razones y alternativas conocidas. El contexto es información del cliente, no una nueva medición certificada por el servidor. El proveedor puede conocer el texto de la pregunta y ese resumen de misión; no se envían credenciales ni los grandes TIFF.

La explicación del modelo no incluye cifras, URLs ni afirmaciones de seguridad. Las mediciones visibles se extraen por separado de los campos estructurados que la aplicación ya muestra. Las acciones permitidas son volver al polo, abrir detalle, ir al análisis o seleccionar un candidato conocido. No se ejecutan automáticamente ni cambian las restricciones del usuario. Respuestas malformadas, destinos inventados y garantías se rechazan. Esto reduce errores, sin garantizar que todo texto de un LLM sea correcto.

Sin clave, modelo disponible o proveedor operativo se usa un texto determinista con etiqueta de guía sin IA. No es una inferencia real ni se cuenta como tal. La pantalla muestra explícitamente ese estado. Cada pregunta usa el contexto actual; una respuesta anterior se marca desactualizada si la selección o criterios cambian.

Límites: pregunta de 1.200 caracteres, petición de 12 KiB, respuesta de proveedor acotada a 64 KiB y tiempo de espera finito. El estado consulta los metadatos del modelo. Las pruebas Gemini interceptan el transporte para verificar formato, encabezados, acciones y fallos; la inferencia real sólo se verifica con una clave configurada.

## Verificación

- Pruebas de proyección contra pyproj y plano inclinado de pendiente analítica.
- Lectura y hash del raster original, gradientes nativos y propagación de nodata.
- Clasificación, cobertura del casquete y selección/ranking.
- Esquemas, límites de entrada, acciones del copiloto y manejo de proveedor ausente.
- Navegador: panorama inicial sin parche local, análisis de casquete, selección, recomendaciones, acercamiento, guía, persistencia al abrir detalle, móvil y fallo del dataset.
- Regresiones del análisis local, ventanas JPL y descenso físico.

La configuración de Gemini está en .env.example. Los secretos reales se guardan sólo en .env ignorado o en el almacén de secretos del despliegue. No se ha añadido una obligación de iniciar sesión para los visitantes.

Fuentes: [NASA LOLA regional](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF), [productos locales LOLA](https://pgda.gsfc.nasa.gov/products/78), [Gemini: generación](https://ai.google.dev/api/generate-content), [modelos Gemini](https://aistudio.google.com/docs/models).
