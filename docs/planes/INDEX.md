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
| 01 | [Integridad de datos en el cliente](01-integridad-datos-cliente.md) | 🔴 Crítico | 1, 2, 16, 23 **+D5** | **implementado** (ver D6 abajo: **reabrir**) | — |
| 02 | [Endurecimiento de seguridad del backend](02-seguridad-backend.md) | 🔴 **Crítico** | 5, 6, 7, 9 **+D0, D5, D6** | pendiente · **T0 es un incidente abierto** | — |
| 03 | [Ciclo de vida de descargas y recursos](03-ciclo-vida-descargas.md) | 🟡 Medio | 3, 10, 17 **+D4-D7** | pendiente | — |
| 04 | [Cadena de build y despliegue](04-build-y-despliegue.md) | 🟡 Medio | 8, 11, 19, 21, 22 **+D6-D8** | pendiente · *decisión tomada: la APK se queda; se poda el historial (T9)* | 03 (recomendada) |
| 05 | [Deuda funcional y UX](05-deuda-funcional-ux.md) | 🟢 Bajo | 4, 20 **+D3-D6** | pendiente · *decisión tomada: formato m4a/mp3* | — |
| 06 | [Tests y CI](06-tests-y-ci.md) | 🔵 Estructural | 14, 18 **+D3, D4** | pendiente | 01, 02, 03 · 04 T1 |
| 07 | [Entrega de progreso y caché](07-progreso-y-cache.md) | 🔵 Estructural | 12, 13 **+D3-D5** | pendiente | 03 (dura) · 02, 04 |
| 08 | [Modularización del frontend](08-modularizacion-frontend.md) | 🔵 Estructural | 15 **+D2-D4** | pendiente | 01, 06 (duras) · 05 |

## Orden recomendado

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
