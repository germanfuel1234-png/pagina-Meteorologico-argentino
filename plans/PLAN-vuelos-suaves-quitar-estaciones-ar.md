# Plan: quitar "Estaciones AR" y suavizar el movimiento de vuelos

Aprobado por el usuario el 2026-09-28.

## Contexto

El globo 3D (`globe.html`/`globe.js`) está inspirado en el proyecto open source real
[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (43.8k stars,
MIT). Se identificaron dos brechas concretas contra el original:

1. La capa "Estaciones AR" (Open-Meteo, 28 ciudades argentinas, Entities con etiqueta de
   texto permanente y color por temperatura) es la que más desentona visualmente del resto
   del globo (puntos lisos sin etiqueta: vuelos, satélites, militares). El proyecto real no
   tiene un equivalente — se quita sin reemplazo.
2. Los vuelos saltan de golpe cada 45s (poll de OpenSky) en vez de moverse suave. El
   proyecto real usa interpolación con "render 30s detrás del tiempo real" (confirmado
   leyendo su `src/layers/flights/motion.js` real, descargado en
   `/home/german/Descargas/gods-eye-view-main`). Nuestro poll es cada 45s, sin margen para
   ese delay — en cambio usamos DEAD RECKONING simple: proyectar la posición hacia adelante
   con rumbo+velocidad reportados (Cesium ENU frame), y cuando llega un fix real nuevo, no
   saltar: blendear desde la posición actual en pantalla hacia la nueva real en 1.5s.

No se portan: modelos 3D, billboards, ruta origen→destino, panel de "Contacts",
enriquecimiento adsbdb, ni rotación world-stable de íconos (no tenemos íconos direccionales).

## SUBPLAN A: Quitar "Estaciones AR" (Open-Meteo)

| # | Agente | Qué hace | Entrega | Depende de |
|---|---|---|---|---|
| T-001 | implementer | Borrar en globe.js el bloque de Estaciones AR: comentario + array AR_CITIES, WMO_LABEL, y el bloque "Capa: estaciones AR" completo (var stationsDS + initStations + loadStations) | globe.js | — |
| T-002 | implementer | Borrar en globe.js la línea `initStations(true);` en boot() y la línea `on('layer-stations', ...)` en wireLayerToggles | globe.js | T-001 |
| T-003 | implementer | Borrar en globe.html el bloque `<div class="hud-layer">` de Estaciones AR/checkbox layer-stations, y el `<span>Estaciones</span>` de la leyenda del footer | globe.html | — |
| T-004 | tester | `node --check globe.js` exit 0, y `grep -c "AR_CITIES\|stationsDS\|layer-stations\|Estaciones AR"` sobre globe.js y globe.html → 0 | — | T-002, T-003 |

CHECKPOINT tras T-004: no queda ninguna referencia a estaciones argentinas/Open-Meteo en el
globo; globe.js sigue siendo JS válido.

## SUBPLAN B: Vuelos — dead-reckoning + blend de corrección, tracking con color

| # | Agente | Qué hace | Entrega | Depende de |
|---|---|---|---|---|
| T-005 | implementer | Reemplazar en globe.js el bloque completo `initFlights`/`loadFlights` por el contenido literal con dead-reckoning que escribe Claude (no lo diseña el modelo local) | globe.js | T-004 |
| T-006 | implementer | Agregar el tick de animación (`viewer.scene.preRender`) que recalcula la posición de cada avión cada frame, y ajustar `trackPicked`/`stopTracking` para teñir de cyan el punto trackeado y restaurar su color original al soltar | globe.js | T-005 |
| T-007 | tester | `node --check globe.js` exit 0 | — | T-006 |
| T-008 | implementer | Actualizar README.md: quitar la fila "Estaciones AR" de la tabla de capas del globo, agregar una línea breve sobre el suavizado de vuelos | README.md | T-006 |

CHECKPOINT tras T-008: globe.js parsea sin errores; en el navegador, un avión se desliza
entre posiciones en vez de saltar cada 45s; al trackear un objeto el punto se tiñe cyan y
se restaura al soltar.

## Después del checkpoint

Claude prueba en el navegador (Claude_Preview) y, si todo anda, hace `git add/commit/push`
directo — nunca vía TASK, según la regla del protocolo de orquestación.

## Nota de ejecución (2026-09-28)

La persistencia de este mismo archivo vía TASK a `implementer` falló dos veces (0 escrituras
la primera, HTTP 500 de Ollama a mitad de generar la segunda — probablemente el tamaño/tabla
markdown del contenido). Siguiendo la regla de "máximo 2 reintentos, al tercero escalás", Claude
escribió este archivo directo.

T-003 (borrar bloque HTML de Estaciones AR) sí se delegó con éxito a `implementer` y salió
`STATUS: ok` a la primera. T-001/T-002 (borrar AR_CITIES/WMO_LABEL/initStations/loadStations en
globe.js) fallaron 3 veces con el ejecutor local — primero HTTP 500 de Ollama con el bloque
grande, después `MAX_ITERATIONS` sin poder hacer matchear el texto con tildes contra el archivo
real (el modelo probó re-escapar unicode, cambiar `\n` por `\r\n`, etc., sin éxito — parece un
problema de encoding entre lo que se le pasa por MCP y el contenido real del archivo, no de la
tarea en sí). Se resolvió: Claude aplicó T-001, T-002, T-005, T-006 y T-008 directo (edits ya
verificados con `node --check globe.js` → ok, y grep de confirmación → 0 referencias residuales).

Verificado en navegador: 6561 vuelos cargados desde el proxy; el dead-reckoning mueve la posición
correctamente entre polls (confirmado llamando el tick manualmente y comparando contra la fórmula
recalculada — la automatización vía `requestAnimationFrame` no se pudo observar en vivo porque el
navegador de testing tiene la pestaña en segundo plano, lo cual frena `preRender` a nivel del
propio Chrome; en un navegador real con la pestaña visible esto no aplica). El tinte cyan al
trackear no se pudo confirmar con un click sintético (el punto es de 5px y se mueve — precisión
de picking del tooling de test, no del código); la lógica en sí es simétrica y reusa el mismo
mecanismo de `trackedEntity` ya probado antes en la sesión con un satélite real.

Pendiente de verificación por el usuario en su propio navegador: el tinte cyan al hacer
click-to-track sobre un avión/satélite/militar.
