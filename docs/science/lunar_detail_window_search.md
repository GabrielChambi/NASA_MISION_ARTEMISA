# Detalle visual y búsqueda temporal

## Resolución y procedencia

El atlas regional original contiene una vista de 769 × 769 muestras, aproximadamente 791 m entre muestras. La escena táctica anterior dibujaba con salto de dos muestras (~1.581 m). Ahora el escritorio dibuja todas esas muestras y al acercarse carga una tesela de 193 × 193 a 395,78 m, preparada por interpolación bilineal desde el mismo DEM NASA original de 80 m. El móvil mantiene una malla general menos costosa y usa las mismas teselas al acercar.

Las teselas comparten bordes exactos. Su altura se cuantiza a un metro (error visual máximo de medio metro) y se almacena comprimida. No se usan para calcular pendientes de seguridad, horizonte ni energía. El sombreado de 1536² píxeles se deriva de gradientes del DEM, con una dirección de luz fija para distinguir cráteres. No es una fotografía ni una simulación de iluminación a la fecha de misión. Cada tesela incluye además sombreado local de 513² (~148 m entre muestras de imagen) para evitar estirar la imagen del casquete cuando se acerca una zona. Es un detalle visual derivado de alturas NASA; no añade observaciones nuevas.

El cargador verifica SHA-256 de la fuente, del archivo y de los datos descomprimidos. Admite tanto servidores que entregan gzip como bytes como servidores que añaden Content-Encoding:gzip y dejan que el navegador lo descomprima. Ambas rutas mantienen la verificación del contenido final. Una pieza o sombreado ausentes no producen datos científicos artificiales: se conserva el atlas base y se informa del fallo visual.

## Búsqueda de fechas

La entrada es una ejecución local válida, con punto, horizonte, criterios e intervalo ya fijados. La búsqueda prueba trece desplazamientos enteros de inicio: +0…+12 horas. Para cada uno evalúa cinco escenarios temporales −2…+2 horas. Se consulta NASA una vez por astro, cubriendo desde el inicio nominal −2 h hasta el fin nominal +14 h.

Cada candidato recorta la serie exacta por UTC sin interpolar ni hacer una nueva consulta por inicio. Las ventanas son semiabiertas y la muestra final no añade duración. Pendiente, relieve, margen del Sol y la Tierra al inicio y horas acumuladas deben cumplir los criterios vigentes. No se relajan restricciones.

El primer candidato que pasa puede diferir del primero que cumple en los cinco cambios ensayados. La ausencia de cobertura deja el resultado desconocido. Esto es robustez temporal en una rejilla pequeña; no una probabilidad de aterrizar, un análisis de incertidumbre del terreno, viabilidad orbital ni óptimo continuo de toda la Luna.

La aplicación de un candidato sólo modifica la fecha del formulario e invalida el escenario anterior. El usuario vuelve a analizar para confirmar la misión. La exportación conserva consultas originales ampliadas, fechas, criterios, escenarios, resultados y límites.

Caso reproducible Site01:2:0: −89.44228359269788°, −137.16853217174196°, pendiente máxima de celda y huella 4,1975°, relieve central 1,321 m. En las fechas del 14 al 17 de diciembre de 2026 y criterios de ejemplo, todos los trece inicios conservan 72 h de Sol y Tierra y pasan los cinco cambios. El resultado correcto es +0 h para ambos primeros candidatos; no se fabrica una mejora cuando no hace falta. Se incluyen los cuatro registros JPL originales, nominales y ampliados.

## Gemini

La clave se obtiene en https://aistudio.google.com/apikey con la cuenta del administrador. AI Studio puede crear un proyecto o permitir elegir uno existente. Se guarda en GEMINI_API_KEY dentro de .env local o como secreto del servidor publicado. No se introduce en el navegador, se comparte por chat ni se versiona.

El panel permite comprobar la conexión y leer instrucciones de activación. Los diagnósticos diferencian clave inválida/caducada, permisos, cuota, modelo ausente y respuesta inválida. Los cuerpos y claves del proveedor no se devuelven. Sin una clave válida, el producto se identifica como guía sin IA y las pruebas del proveedor usan transporte simulado.

## Verificación

Pruebas de resolución, integridad, bordes, interpolación de alturas, nodata, sombreado georreferenciado y transporte gzip. Pruebas de búsqueda con series NASA originales y fixtures de escenarios donde el primer inicio nominal y el robusto difieren. Pruebas de bloqueo por terreno, igualdad estricta en márgenes, cancelación, cobertura incompleta y errores del proveedor. Navegador: descarga de detalle al acercar, fallos visuales sin pérdida de evaluación, configuración Gemini, búsqueda, exportación y aplicación de fecha.

Fuentes: [NASA LOLA regional](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF), [JPL Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [claves Gemini](https://aistudio.google.com/docs/api-key).
