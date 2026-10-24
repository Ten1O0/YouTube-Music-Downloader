# Planes de implementación

Carpeta donde vive el trabajo planificado del proyecto. Cada plan es una unidad
que se puede implementar, probar y mergear por separado.

## Convenciones

- Un fichero por plan: `NN-nombre-corto.md` (numeración por orden de prioridad).
- Cada plan se corresponde con **una rama y un PR**.
- Estados: `pendiente` · `en curso` · `hecho` · `descartado`.
- La numeración marca prioridad, **no** obligación de orden estricto: los planes
  sin dependencias declaradas pueden adelantarse.
- Cada plan numera sus defectos como `D1`, `D2`… dentro de su propio documento.
  Los que no venían del análisis inicial se marcan como **(nuevo)** y se resumen
  al final de este índice.

## Regla: todo plan lleva su tarea de tests

Desde el 2026-09-21, **cada plan termina con una tarea de tests** que cubre lo
que ese plan introduce. Un plan no está hecho hasta que su tarea de tests está
en verde. Así la cobertura crece con cada entrega en lugar de acumularse como
deuda.

Cuando un plan arregla un defecto que la suite ya describe con un `xfail`, esa
tarea incluye **quitarle el decorador** al ponerse en verde: a partir de ahí el
test protege de regresiones.

## Plantilla de cada plan

```markdown
# NN — Título

**Estado:** pendiente | **Prioridad:** 🔴/🟠/🟡/🔵/🟢 | **Depende de:** —

## Problema
Qué falla hoy y por qué importa.

## Alcance
Puntos del análisis que cubre este plan.

## Fuera de alcance
Lo que explícitamente NO se toca aquí.

## Pasos
1. …

## Verificación
Cómo se comprueba que funciona.

## Riesgos
Qué puede romperse.
```

## Índice de planes

| # | Plan | Prioridad | Puntos del análisis | Estado | Depende de |
|---|------|-----------|---------------------|--------|------------|
| 01 | [Integridad de datos en el cliente](01-integridad-datos-cliente.md) | 🔴 Crítico | 1, 2, 16, 23 **+D5** | hecho · *el guion T11 lo cubren los recorridos E2E* | — |
| 02 | [Endurecimiento de seguridad del backend](02-seguridad-backend.md) | 🔴 **Crítico** | 5, 6, 7, 9 **+D0, D5, D6** | hecho · desplegado | — |
| 03 | [Ciclo de vida de descargas y recursos](03-ciclo-vida-descargas.md) | 🟡 Medio | 3, 10, 17 **+D4-D7** | hecho · desplegado | — |
| 04 | [Cadena de build y despliegue](04-build-y-despliegue.md) | 🟡 Medio | 8, 11, 19, 21, 22 **+D6-D8** | hecho · desplegado | 03 (recomendada) |
| 05 | [Deuda funcional y UX](05-deuda-funcional-ux.md) | 🟢 Bajo | 4, 20 **+D3-D6** | hecho · desplegado | — |
| 06 | [Tests y CI](06-tests-y-ci.md) | 🔵 Estructural | 14, 18 **+D3, D4** | hecho · desplegado | 01, 02, 03 · 04 T1 |
| 07 | [Entrega de progreso y caché](07-progreso-y-cache.md) | 🔵 Estructural | 12, 13 **+D3-D5** | hecho · desplegado | 03 (dura) · 02, 04 |
| 08 | [Modularización del frontend](08-modularizacion-frontend.md) | 🔵 Estructural | 15 **+D2-D4** | hecho · desplegado | 01, 06 (duras) · 05 |
| 09 | [Movimiento y materiales](09-movimiento-y-materiales.md) | 🟡 Medio (experiencia) | laboratorio *Muelles y cristal* **+D8, D11, D13-D16** | hecho · desplegado | 06, 07 (hechos) · coordinación con 08 |
| 10 | [Pulido y arreglos](10-pulido-y-arreglos.md) | 🔴 T1 · 🟢 resto | mejoras 17, 18, 22, 23, 24, 25 **+D1 (seguridad)** | **hecho · sin desplegar** | 08 |
| 11 | [Biblioteca inteligente](11-biblioteca-inteligente.md) | 🟡 Medio | mejoras 6, 7 | hecho · desplegado | 10 T1 |
| 12 | [Sonido](12-sonido.md) | 🟡 Medio | mejoras 2, 3, 19 | hecho · desplegado · probado en el vivo | 10 T1 · 11 T5 |
| 13 | [Tus datos en todos tus dispositivos](13-datos-en-todos-los-dispositivos.md) | 🟡 Medio | mejoras 9, 10 | hecho · desplegado | 10 T1 · 11 |
| 14 | [Listas que se siguen y avisos](14-listas-seguidas-y-avisos.md) | 🟡 Medio | mejoras 11, 16 **+D3** | hecho · desplegado · opción A | 10 T1 · 13 |
| 15 | [Importar listas de otros servicios](15-importar-listas.md) | 🟢 Bajo | mejora 12 | hecho · desplegado (APK 1.7.0) · *vías A y B; la C no se hace* | 10 T1 · 11 T2 · 14 T2 |
| 16 | [Modo radio](16-modo-radio.md) | 🟢 Bajo-medio | mejora 4 | hecho · con la APK 1.8.0 · *ventana adaptable; guardar sin volver a descargar* | 10 T1 · 12 · 14 T2 |
| 17 | [Tu año en música](17-tu-ano-en-musica.md) | 🟢 Bajo | mejora 15 | hecho · desplegado | 11 T5 · 13 |
| 18 | [Enviar a altavoces y teles](18-enviar-a-altavoces-y-teles.md) | 🟢 Bajo | mejora 5 | pendiente · *requiere un Chromecast para probar* | 10 T1 · 12 |
| 19 | [Rendimiento: la misma app, mucho más ágil](19-rendimiento.md) | 🟠 Alto | rendimiento en el móvil **(nuevo)**: D1-D14 | hecho · parte 1 desplegada (APK 1.7.0), parte 2 sin desplegar · *T0 en el Vivo descartada; T14 (release) preparada, sin adoptar* | 13 |
| 20 | [Descargas en lote: rápidas, a la biblioteca y con un solo aviso](20-descargas-en-lote.md) | 🟠 Alto | descargas de varias canciones e importar en la web **(nuevo)**: D1-D9 | hecho · desplegado | 14 |
| 21 | [Publicación: la app y el repositorio, listos para todo el mundo](21-publicacion.md) | 🔴 Alto | presentación pública en LinkedIn y GitHub **(nuevo)**: D1-D10 | en curso · desplegado con la APK 2.0.0; falta ordenar el servidor, limpiar el historial y publicar | 16 |
| 22 | [Letras: encontrar la buena, también cuando el título viene mal](22-letras.md) | 🟠 Medio | letras que no salen **(nuevo)**: D1-D6 | hecho · sin desplegar · *36/36 letras buenas en la medición real, 0 equivocadas* | 16, 11 |
| 23 | [Las listas y las ventanas, al nivel del resto de la app](23-listas-y-ventanas.md) | 🟠 Medio | ventanas antiguas, orden y duración de las listas **(nuevo)**: D1-D11 | hecho · sin desplegar · *probado en local por el usuario; el deshacer pasa al 24 (P9)* | 21 |
| 24 | [Las listas, como en una app de música](24-listas-como-en-una-app-de-musica.md) | 🟠 Medio | propuestas elegidas por el usuario **(nuevo)**: P1-P5, P7-P12 | hecho · sin desplegar · *en paralelo por dos sesiones* | 23 |
| 25 | [Recomendaciones variadas: muchos artistas, el mismo estilo](25-recomendaciones-variadas.md) | 🟠 Medio | recomendadas y radio de un solo artista **(nuevo)**: R1-R4 | hecho · sin desplegar · *en paralelo por dos sesiones* | 16, 24 |
| 26 | [Crear una lista al descargar una lista de YouTube](26-lista-al-descargar.md) | 🟢 Bajo | propuesta del usuario **(nuevo)**: T1-T3 | hecho · sin desplegar | 15, 20 |
| 27 | [Ninguna canción ni lista sin portada](27-ninguna-portada-vacia.md) | 🟡 Medio | portadas generadas y carátulas recuperadas **(nuevo)**: T1-T5 | hecho · sin desplegar · *en paralelo por dos sesiones* | 24 |
| 28 | [Animaciones fluidas en el móvil](28-animaciones-fluidas.md) | 🟠 Medio | vuelo y animaciones a 15–20 fps en el móvil **(nuevo)**: C1-C8, T0-T7 | hecho · versión 2.3.0 | 09, 19 |

## Orden recomendado

### Segunda serie: nuevas funciones (planes 10 a 18)

```
10  →  11  →  12  →  13  →  14  →  15  →  16  →  17  →  18
```

- **El plan 10 va primero sin excepción:** su T1 corrige una inyección de HTML
  por títulos de YouTube (ver D11 abajo) y todos los demás planes pintan datos
  de fuera apoyándose en su `html\`…\``.
- **Tareas adelantables:** el T5 del plan 11 (registro de escuchas) conviene
  hacerlo cuanto antes, porque de él vive el resumen del año del plan 17; y el
  T2 del plan 14 arregla un fallo real (cerrar la app a mitad de un lote pierde
  lo descargado) sin depender de nada.
- **Decisiones pendientes antes de empezar:** push con Firebase o solo avisos
  locales (plan 14) y la vía de Spotify (plan 15).
- Los recorridos E2E nuevos van numerados del 23 al 42 a lo largo de la serie.

### Primera serie (planes 01 a 09, ya hechos)

```
02 T0+T1  →  01 (reabrir D6)  →  02 resto  →  03  →  04  →  05  →  06  →  07  →  08
   ↑ hoy
```

La prioridad del plan 02 **subió a crítica** al redactarlo: T0 corrige una
exposición de datos personales que está activa en producción (ver D0 abajo) y no
espera a un PR ordenado.

Después, el orden original sigue en pie. Los cuatro primeros son correcciones
(bugs activos, secretos expuestos, fugas de recursos, build reproducible). Del 06
en adelante es trabajo estructural: **06 antes que 08** a propósito, para que la
modularización grande del frontend tenga una red de tests debajo.

### Dependencias que conviene no saltarse

| Dependencia | Por qué |
|---|---|
| 04 ← 03 | El plan 03 (T6) saca `db.init_db()` y `os.makedirs(TEMP_DIR)` de `if __name__ == '__main__'`. Bajo gunicorn ese bloque **no se ejecuta**: sin el 03, el cambio a WSGI arranca sin base de datos |
| 07 ← 03 | El endpoint SSE lee `download_progress` desde un hilo propio: necesita el `download_lock` y el `update_progress()` único del plan 03 (T4) |
| 08 ← 06 | Un refactor de 7.400 líneas se verifica con los recorridos de Playwright del plan 06 (T7), no leyendo |
| 08 ← 01 | No se mueve código y se arreglan bugs de datos a la vez |
| 06 ← 04 T1 | Este portátil no tiene Node ni Java: sin el 04, la parte JS de los tests no se puede ejecutar en local (en CI sí) |

### Restricción transversal: **`gunicorn --workers 1`**

El estado de las descargas vive en diccionarios del proceso (`download_progress`,
`download_cancellation`, `download_processes`). Con más de un worker, una descarga
iniciada por el worker A es invisible para el B y `/api/progress/<id>` devuelve
404 de forma aleatoria. Afecta a los planes **03**, **04** y **07**, y está
documentada en los tres.

---

## Hallazgos surgidos al redactar los planes

Defectos no detectados en el análisis inicial, encontrados al profundizar.
Ordenados por gravedad.

### 🔴 D0 · La base de datos de usuarios es descargable — **verificado en producción**

`server.py:42` crea la app con `Flask(__name__, static_folder='.', static_url_path='')`,
lo que publica **todo el directorio del proyecto** en la raíz web. Comprobado con
peticiones `HEAD` el 21-09-2026:

| Ruta | Respuesta |
|---|---|
| `/data/youtube_downloader.db` | **200 · 5.468.160 bytes** — SQLite con correos, nombres, fotos, historial y favoritos de todos los usuarios |
| `/server.py` | 200 · 55.718 bytes |
| `/database.py` | 200 · 10.542 bytes |
| `/requirements.txt` | 200 |

Que `data/` esté en `.gitignore` no protege nada: eso afecta a git, no a Flask.
Y agrava el punto 5 del análisis, porque el literal de `JWT_SECRET` está en el
código descargable.

→ **Plan 02, T0.** Es un hotfix de tres capas (nginx, Flask y mover `data/` fuera
del directorio servido), no un PR normal.

### 🔴 D6 (plan 01) · El arreglo del bug nº 1 se hizo sobre código muerto — **reabrir**

`downloadBlobAndSave` **no tiene ningún llamante**
(`grep -rn "downloadBlobAndSave" --include="*.js" --include="*.html" .`), ni antes
ni después del plan 01. El camino web que se usa de verdad es
`downloadFromUrl` → `saveDownloadToApp` (app.js ~371), que sigue guardando
`` song.src = `${API_URL}/api/stream/${download_id}` `` y acto seguido navega a
`/api/download/<id>`, cuyo `call_on_close` **borra la carpeta en el servidor**.

Consecuencia: en web, el `src` de la biblioteca nace muerto — y no solo tras
recargar, como decía el análisis, sino de inmediato. Además, el respaldo que el
plan 01 dejó en `resolveStreamSrc` (`/api/stream/${song.videoId}`) no puede
acertar nunca: esa ruta está indexada por `download_id`, no por `videoId`.

→ **Reabrir el plan 01** para la mitad cliente. La mitad servidor (definir que
`/api/stream/` es temporal) está en el **plan 03, T7**.

### 🟠 D5 (plan 01) · `syncLocalData()` leía de `localStorage` tras la migración

`AuthManager.syncLocalData()` leía historial y favoritos de `localStorage`, claves
que `migrateStorage()` ya había borrado en el mismo arranque. El sync del primer
login enviaba siempre vacío y se marcaba como completado con un flag persistente.
→ Corregido en el **plan 01** (T3, flag `data_synced_v2`).

### 🟡 Otros, por plan

| Plan | Hallazgo |
|---|---|
| 02 | `start_batch_download` crea un `threading.Thread` por petición, **sin pasar por el pool**: el límite de 5 workers no lo contiene |
| 02 | `/api/stream/` y `/api/download/` no piden autenticación y el id son 8 hex: acertar uno le quita la descarga a su dueño |
| 03 | `db.init_db()` y `os.makedirs(TEMP_DIR)` viven dentro de `if __name__ == '__main__'`: bajo gunicorn no se ejecutan nunca |
| 03 | `stream_file` carga en RAM el rango completo que le pidan: `Range: bytes=0-` sobre 80 MB reserva 80 MB |
| 03 | `run_parallel_batch` nunca borra su entrada de `download_cancellation` |
| 03 | Existen dos `manifest.json` (raíz y `public/`) **con contenido distinto**: `theme_color` ya ha divergido |
| 04 | Este portátil no tiene **ninguna** herramienta de build (node, npm, java, SDK de Android). El único despliegue posible es `./deploy.sh --no-build`, que **no regenera `dist/`**: los cambios de frontend desplegados desde aquí no llegan al usuario |
| 04 | `mobile/www/` es una copia versionada de `dist/`: el mismo build vive en cuatro sitios |
| 04 | El 95 % del repositorio son binarios: `ytmusic.apk` ocupa **42,7 de los 52,2 MiB** del pack (11 versiones) y dos mp3 de prueba que ya no están en `HEAD` otros 6,8 MiB. Todo el código de los 91 commits son 2,4 MiB. → **Decidido:** la APK se mantiene versionada (se quiere en el clon) y las versiones antiguas se podan del historial con `git filter-repo` (plan 04, T9) |
| 04 | `saveToNativeCapacitor` y el resto del camino nativo dependen de `Content-Disposition`, que `CORS(app, expose_headers=[...])` ya expone: útil para derivar la extensión real del fichero (plan 05, T3) |
| 05 | El selector de calidad no puede funcionar aunque se cablee: con `-f bestaudio[ext=m4a] --audio-format m4a` yt-dlp remuxea sin recodificar, y la mejor pista m4a de YouTube es AAC ~128 kbps. **«320 kbps» no existe en el origen**. → **Decidido:** se sustituye por un selector de **formato m4a/mp3**, que sí es una elección real |
| 05 | `saveToNativeCapacitor` fija la extensión del fichero a mano (`const fileExt = '.m4a'`, app.js:3057) y el recolector de basura nativo solo borra huérfanos `.m4a`: los dos bloquean la opción mp3 en la APK |
| 05 | `MAX_WORKERS = 5` se dimensionó con el comentario «safe for M4A - no CPU-heavy conversion»: activar mp3 invalida esa premisa y exige limitar las transcodificaciones simultáneas |
| 05 | Hay **dos** constructores de comandos de yt-dlp casi idénticos (`download_single_item` y `build_ytdlp_download_cmd`): es la razón de que `audio_quality` se quedase sin cablear en uno de ellos |
| 05 | El servidor manda los mensajes de progreso como frases en castellano y el cliente los pinta tal cual: la barra de progreso es intraducible desde el cliente (se resuelve en el plan 07, T2) |
| 05 | El idioma por defecto es `'es'` sin mirar `navigator.language`, con 6 idiomas ya traducidos |
| 06 | `except Exception: pass` en `update_download_progress` (server.py:910): si yt-dlp cambia el formato de sus líneas, la barra se congela sin dejar rastro |
| 06 | Las dos capturas de la verificación del token de Google devuelven 401 también cuando el fallo es interno del servidor |
| 07 | `cache.addAll` del Service Worker es atómico y la lista incluye una URL de Google Fonts: si el CDN falla durante la instalación, **no se cachea nada** |
| 07 | El `fetch` del SW cachea todo lo que no sea `/api/`, incluidas las miniaturas de `i.ytimg.com` y las banderas de `flagcdn.com`: caché sin techo ni caducidad |
| 08 | Dos constantes para la misma URL base (`API_BASE` en app.js:13 y `API_URL` en app.js:1581) con **lógica de detección distinta**, y la segunda es `const`: no se entera si Capacitor se inyecta después |
| 08 | 122 funciones y 93 constantes en el ámbito global, contra 14 módulos: hay más código suelto que código en módulos |
| 09 | Tocar una línea de la letra no salta a ese momento: `window.PlayerModule` es siempre `undefined`, porque `app.js` es un módulo (app.js:7773) |
| 09 | Reordenar usa `cubic-bezier(0.11, 0, 0.5, 0)`, una curva que **acelera al llegar**: la fila frena en seco |
| 09 | `.leaving` y `.pending` de la tarjeta de descarga no tienen CSS: sale sin animación y las descargas en espera no se distinguen |
| 09 | El botón dice «Descargar MP3» con M4A elegido, en los 6 idiomas, y en producción se ve la etiqueta de depuración `v=74 [N:false]` |
| 09 | Las letras sin sincronizar se pintan al 22 % de opacidad: casi ilegibles |
| 09 | El arnés de tests carga `app.js` como script: el primer `import` lo rompe. Y Playwright sirve `app.js` sin compilar si no hay `dist/` |
| 09 | Las playlists creadas por el usuario **no se abrían**, ni se podían borrar ni quitarles canciones: una refactorización (bc7d937) sacó ayudantes de `PlaylistModule` al nivel superior y dejó 9 llamadas sin prefijo. Lo detecta ahora `test_referencias_modulos.mjs` |
| 09 | Cada «añadir a la cola» lanzaba un error: llamaba a `updateFullPlayerSource`, que no existe, tras una comprobación de `.hidden` que siempre era cierta |
| 09 | En la APK, guardar una descarga lanzaría un `ReferenceError`: el selector de formato (092f18b) quitó `fileName` de `saveToNativeCapacitor`. La APK instalada es anterior y no lo tiene |
| 09 | Escape no cerraba ningún modal, y con dos abiertos el botón atrás cerraba el de debajo |
| 09 | Los contadores decían «2 canciónes», solo en castellano |
| 09 | En escritorio la carátula del reproductor medía 420 px fijos: en ventanas de menos de ~900 px de alto los controles quedaban fuera |
| 09 | Una regla con `transition: none !important` anulaba la animación con la que Sortable aparta las filas al reordenar |
| 09 | El yt-dlp simulado de los E2E devolvía un solo resultado en las búsquedas, y 17 recorridos superan el límite de 10 descargas por minuto: se desactiva solo para ellos (`YTDL_DISABLE_RATELIMIT`) |
| 09 | En la APK había que pulsar borrar tantas veces como letras escritas antes de que se borrara nada. `captureInput: true` (desde el 30-03-2026) sustituía la conexión real de Chromium con el teclado por una simulada con su propia copia del texto; teclados como el de vivo borraban primero de esa copia. En la web no pasaba. Se quita en la APK 1.1.2 |
| 09 | En la web, «añadir a la cola» desde la Biblioteca no daba ningún aviso visible: el mensaje se pinta en la vista de Inicio. Resuelto con un aviso flotante (src/ui/toast.js) |
| 09 | Había **dos** gestores de idioma: el que traducía la interfaz y `i18n`, que nunca se inicializaba. Los 70 textos generados desde JavaScript (avisos, contadores, descargas) salían siempre en castellano |
| 09 | Al modal de descarga de la APK le faltaba su `</div>` de cierre y envolvía al de permisos: en Android anterior al 13 el aviso de permisos de almacenamiento no se veía nunca |
| 09 | La APK no tenía forma de saber que había una versión nueva: ahora pregunta a `/api/app/version` al arrancar (src/ui/app-update.js) |
| 09 | Nada actualizaba yt-dlp en el servidor: un temporizador diario lo actualiza y comprueba que sigue extrayendo audio (scripts/servidor/actualizar-yt-dlp.sh) |
| 09 | En la APK, el enlace del café abría Buy Me a Coffee dentro de la propia app y el botón atrás ya no volvía: había que cerrarla. Los enlaces externos se abren ahora en el navegador del sistema |
| 09 | Importar audios del móvil solo mostraba el progreso en la tarjeta de Inicio. Ahora va en la isla o el banner, como las descargas, y se puede cancelar |
| 08 | Al separar `app.js` en módulos aparecieron trece piezas sin usar que en un único ámbito no se veían: entre ellas, el modal para ordenar las canciones de una lista y sus funciones, que nada abría porque se ordena arrastrando. Se borra el código y ESLint (`no-unused-vars`) lo vigila; el HTML del modal (`#playlistSortModal`) queda huérfano en `index.html` |
| 08 | `auth.init()` se llama dos veces al arrancar, desde dos `DOMContentLoaded` distintos. De ahí el aviso de Google «`initialize()` is called multiple times». **Anotado, no corregido**: el plan 08 no cambia comportamiento |
| 08 | El almacenamiento (`core/storage.js`) importaba los avisos y el idioma, los avisos importaban la descarga y la navegación importaba el reproductor: la base entera formaba un ciclo con las funciones de la app. Invertidas las tres dependencias; un test impide que vuelva |

- **D6** (plan 02) 🔴 **CRÍTICO**: `Flask(static_folder='.', static_url_path='')`
  publica el directorio del proyecto entero. Verificado en producción:
  `/server.py`, `/database.py`, `/requirements.txt` y **`/data/youtube_downloader.db`**
  (la base de datos de usuarios completa) se descargan sin autenticación.
  `server.py` además expone el valor por defecto de `JWT_SECRET`.
  Capturado en `test/backend/test_static_exposure.py`.

- **D7** (plan 02) 🟠: SSRF en `validate_youtube_url()`. Usa `re.search()`, que
  encuentra el patrón en cualquier posición en lugar de validar el host, así que
  `https://evil.com/?x=youtube.com/watch?v=<id>` pasa la validación y la URL
  completa del atacante llega a yt-dlp. Sin auth ni rate limiting, cualquiera
  puede hacer que el servidor descargue de donde le digan.
  Capturado en `test/backend/test_url_validation.py`.

- **D8** (plan 06) 🔴: el puerto 5000 de gunicorn está en `0.0.0.0`, no en
  `127.0.0.1`. Verificado desde internet: `http://213.165.80.130:5000/api/health`
  responde 200, saltándose nginx. Implica tráfico sin HTTPS (tokens JWT en
  claro), elusión de cualquier regla de nginx, y elusión del rate limiting,
  porque en conexión directa el cliente controla `X-Forwarded-For` y `ProxyFix`
  confía en ella. Arreglo: `--bind 127.0.0.1:5000` + bloqueo en ufw.

- **D9** (plan 08) 🔴: el patrón `globalThis.<Modulo> !== undefined` aparecía en
  cinco sitios y **siempre era falso**: los módulos son `const` de nivel superior
  y nunca están en `globalThis`. El corazón de favoritos no se pintaba activo al
  renderizar la biblioteca. Corregido.

- **D10** (plan 08) 🔴: el arreglo del plan 01 (D1) vivía en `downloadBlobAndSave`,
  una función **sin llamantes**. El camino web real dejaba el `src` apuntando a
  un recurso que el servidor borra al entregarlo. Corregido.

- **D11** (plan 10) 🔴: títulos y nombres de canal que llegan de YouTube se
  insertan como HTML sin escapar en 28 plantillas de 12 módulos (biblioteca,
  búsqueda, historial, favoritos, cola, letras, listas…); solo el HUD de
  descargas escapa. Un vídeo con un título preparado ejecutaría código dentro
  de la app, y en la APK ese código tendría acceso a los plugins nativos.
  Encontrado al redactar el plan 11. Corrección en el plan 10, T1.
