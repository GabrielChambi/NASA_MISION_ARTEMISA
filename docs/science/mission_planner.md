# Planificador y descenso

Los datos NASA, las hipótesis de nave y los resultados numéricos se identifican por separado. No se declara certificación NASA ni evaluación perfecta del desafío. La matriz inferior corresponde al documento aportado por el usuario, no a una puntuación oficial.

## Consistencia

MissionPlanner reúne mapa, formulario UTC, condiciones, comparación y descenso. Un MissionContext comparte sitio, fechas, altura, horizonte, muestreo, retraso y criterios con las herramientas avanzadas. Se adquieren las cuatro series secuencialmente; las respuestas canceladas no se aplican.

Los resultados tienen una clave con todos los parámetros científicos. Cambiar el punto reutiliza la comparación calculada; cambiar la misión invalida el vuelo y los indicadores anteriores. Los criterios derivan ventanas desde las muestras, sin inventar posiciones. Un error retira los resultados y desactiva el descenso.

Mapa y gráficos usan la misma muestra UTC. El descenso integra cada 0,1 s; el cielo conserva la última muestra NASA anterior y declara su resolución. No se interpola una efeméride por fotograma. El descenso debe terminar dentro del intervalo analizado.

## Fuentes y marco

| Punto | Latitud | Longitud este | Elevación | Pendiente |
| --- | --- | --- | --- | --- |
| Site01 / Connecting ridge | −89,46315776° | 222,49801509° | 1944,767 m | 3,7994° |
| Site04 / Shackleton rim | −89,76674148° | 188,10719092° | 767,979 m | 32,7358° |

La elevación se refiere a la esfera del DEM, radio 1 737 400 m. El observador añade la altura solicitada. El mapa y ambas APIs usan estas coordenadas, no etiquetas estáticas de otro archivo.

GET/POST Python y Worker usan las mismas respuestas originales JPL y perfiles LOLA. La compatibilidad anterior usaba una semilla sin comprobar coordenadas/altura; se retiró de las rutas activas. El rango de Tierra y su velocidad radial requieren columnas Q20 medidas; no se asigna una distancia constante.

El horizonte es parcial: rayos locales/regionales finitos, curvatura lunar, resolución y cobertura declaradas. Si falta perfil no se sustituye por plano. La exageración es visual. El mapa no certifica aterrizaje ni hielo.

## Ventanas y comparación

    Sol visible: e_sol > h(az_sol)
    Tierra visible: e_tierra > h(az_tierra) + margen

La igualdad no es visible. Se exigen series finitas y alineadas UTC. Se integran intervalos semiabiertos [t_i,t_(i+1)) con la muestra izquierda; el endpoint sólo cierra el gráfico. Se calculan horas por astro, intersección, ventanas, oscuridad y ausencia de Tierra. No son potencias ni presupuestos RF.

El inicio ordena por cumplimiento de todos los criterios, horas simultáneas, horas solares y terrestres. Los empates no generan preferencia. La pendiente se evalúa sólo en el píxel. El módulo avanzado conserva su regla explícita de número de criterios satisfechos, intersección y Tierra.

Con 14–17 diciembre 2026, paso 60 min, altura 2 m y horizonte parcial:

| Punto | Sol | Tierra | Sol ∩ Tierra |
| --- | --- | --- | --- |
| Site01 | 72 h | 29 h | 29 h |
| Site04 | 72 h | 0 h | 0 h |

El escenario +12 h recalcula efemérides y produce 41 h de Tierra para Site01. Un margen de 5° reduce su visibilidad terrestre a 0 h en ese ejemplo. El informe conserva muestras, consultas, métodos y resultados para revisión.

## Descenso vertical

Constantes: μ = 4,902800118 × 10¹² m³/s²; R = 1 737 400 m; g₀ = 9,80665 m/s². Fuentes: [JPL DE440](https://ssd.jpl.nasa.gov/astro_par.html), [radio lunar](https://ssd.jpl.nasa.gov/sats/phys_par/) y [NASA Glenn](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/).

    dh/dt = v
    dv/dt = T/m − μ/(R + elevación_LOLA + h)²
    dm/dt = −T/(Isp · g₀)
    0 ≤ T ≤ T_max
    m ≥ masa_seca

Valores iniciales editables: 2000 m, descenso 25 m/s, masa total 12 000 kg, seca 6000 kg, empuje máximo 45 000 N, Isp 320 s y objetivo 0,8 m/s. Es una nave hipotética, no especificaciones Artemis.

La guía estima desaceleración disponible, limita la referencia a 45 m/s y ajusta empuje con compensación gravitatoria y corrección proporcional. Se integra por RK4 cada 0,1 s, manteniendo el empuje del paso. Se divide el paso al agotar combustible y se localiza contacto por bisección. No se impone una duración cinematográfica. Sin contacto en 1800 s se devuelve timeout.

La velocidad de contacto corresponde a h=0 antes de modelar colisión. ≤2 m/s se clasifica como contacto suave didáctico; >2, impacto. No se simulan patas, estabilidad, inclinación ni daños. La posición horizontal es fija; no se resuelve órbita ni seis grados de libertad.

Nave, anillo y vertical se colocan usando el punto geográfico y su dirección radial local. La altura usa kilómetros de escena; el símbolo se amplía para verlo. Al contacto se conserva el punto, se centra la cámara y se muestran coordenadas y telemetría.

## Verificación

- Caída libre contrastada con conservación de energía radial.
- Consumo contrastado con integral de empuje; agotamiento sin consumir masa seca.
- Convergencia de tiempo, contacto y consumo al reducir paso de 0,1 a 0,05 s.
- Empuje débil y tanque agotado provocan impacto; timeout no declara contacto.
- Ventanas, igualdad, margen y rechazo de series desalineadas/no finitas.
- GET/POST comparados muestra a muestra y con el catálogo del mapa.
- Distancia medida, altura, horizonte parcial y errores sin sustitución.
- Navegador: UTC variable, fecha nueva, criterios, JSON, contacto/impacto geográfico, fallo 503 y cuatro tamaños.

45 pruebas Python y 30 Node; verify-planner.mjs cubre el flujo visible.

## Matriz del documento aportado

| Prueba | Evidencia |
| --- | --- |
| Elegir dos sitios | Pines 01/04 y catálogo derivado NASA |
| Cambiar fecha | Consultas nuevas, fechas UTC y contraste con cálculo anterior |
| Analizar Sol | Azimut, elevación, horizonte, despeje y curva |
| Analizar Tierra | Mismo reloj, margen y geometría del centro terrestre |
| Calcular ventanas | Sol, Tierra, intersección, duraciones y huecos |
| Comparar alternativas | Criterios, motivos, empates y exportación |
| Verificar resultados | URL JPL original, inventario NASA y pruebas |

Pendientes: contraste SPICE, incertidumbre propagada, refinamiento de transiciones, horizonte completo, coordenadas arbitrarias y dinámica de nave/orbita validada. Impiden presentar el sistema como certificación operativa de vuelo.
