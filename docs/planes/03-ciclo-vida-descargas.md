# 03 — Ciclo de vida de descargas y recursos

**Estado:** hecho · desplegado · **Prioridad:** 🟡 Medio · **Depende de:** —
**Puntos del análisis:** 3, 10, 17 (+ cuatro hallazgos nuevos, ver D4 a D7)

> **Objetivo del plan en una frase:** que el servidor aguante semanas sin
> reiniciarse.

---

## 1. Problema

El servidor solo sabe limpiar el caso feliz. Una descarga que el usuario recoge
deja el sistema como estaba; **cualquier otra cosa deja basura para siempre**.

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | `logger` no está definido (todo el fichero usa `app.logger`) | server.py:358 | El `except` de `stream_file` revienta con `NameError` al intentar registrar el error |
| D2 | `download_progress`, `download_cancellation` y `TEMP_DIR` solo se limpian si el usuario recoge el fichero | server.py:1115, 1151 | Toda descarga abandonada, fallida o interrumpida deja su entrada en RAM y su carpeta en disco |
| D3 | `get_playlist_count` definida dos veces y `/manifest.json` registrada dos veces | server.py:183 y 714 · 276 y 361 | Código muerto: gana la segunda definición y la primera ruta |
| D4 | **(nuevo)** `db.init_db()` y `os.makedirs(TEMP_DIR)` viven dentro de `if __name__ == '__main__'` | server.py:1541-1547 | Bajo gunicorn (plan 04) **no se ejecutan nunca** |
| D5 | **(nuevo)** `stream_file` carga en RAM el rango completo que le pidan | server.py:347-349 | `Range: bytes=0-` sobre un fichero de 80 MB reserva 80 MB de golpe |
| D6 | **(nuevo)** `/api/stream/<download_id>` apunta a carpetas que `/api/download/<id>` acaba de borrar | server.py:1148-1152 + `saveDownloadToApp` en app.js | En web, el `src` que se guarda en la biblioteca nace muerto |
| D7 | **(nuevo)** todo el estado de descargas vive en diccionarios del proceso | server.py:83-88 | Condiciona el plan 04: con más de un worker, el progreso deja de verse |

### Anatomía de la fuga (D2)

Las tres entradas se crean en `start_download` (server.py:1049-1060) y
`start_batch_download` (server.py:692-706), y solo se borran en dos sitios:

```python
# get_download, server.py:1148 — solo si el usuario recoge el fichero
@response.call_on_close
def cleanup():
    cleanup_temp_folder(download_folder)
    if download_id in download_progress:
        del download_progress[download_id]
```

y en `cancel_download` (server.py:551-556). Lo que queda fuera:

| Situación | ¿Se limpia? |
|---|---|
| Descarga completada y recogida | ✅ |
| Descarga cancelada explícitamente | ✅ (pero **no** borra `download_progress`, ver más abajo) |
| Descarga que **falla** (`status: 'error'`) | ❌ entrada y carpeta para siempre |
| Usuario que cierra la pestaña antes de recoger | ❌ entrada y carpeta para siempre |
| Descarga que termina mientras el servidor se reinicia | ❌ carpeta huérfana en `/tmp` |
| `run_parallel_batch` al terminar | ❌ nunca borra su `download_cancellation` |

Nótese el detalle de `cancel_download`: **reescribe** `download_progress[download_id]`
con el estado `cancelled` y borra las otras dos estructuras, pero deja la entrada
de progreso viva. Es intencionado (el cliente tiene que poder leer el estado
`cancelled` una última vez), pero nadie la borra después.

Cada entrada de `download_progress` son unos cientos de bytes; cada carpeta
abandonada, entre 3 y 80 MB. En un servidor que no se reinicia, `/tmp` se llena y
**todas** las descargas empiezan a fallar a la vez.

### Por qué D6 importa aquí y no en el plan 01

El plan 01 arregló la persistencia del audio en IndexedDB, pero lo hizo sobre
`downloadBlobAndSave`, que **no tiene ningún llamante** (es código muerto: se
comprueba con `grep -rn "downloadBlobAndSave" --include="*.js" --include="*.html" .`).
El camino web que se usa de verdad es
`downloadFromUrl` → `saveDownloadToApp` (app.js ~371), y ahí:

```js
let streamUrl = `${API_URL}/api/stream/${download_id}`;   // ← lo que se guarda como song.src
...
setTimeout(() => { globalThis.location.href = downloadUrl; }, 500);  // ← /api/download/<id>
```

Esa navegación dispara el `call_on_close` del servidor, que **borra la carpeta**.
Resultado: en web, `song.src` apunta a `/api/stream/<id>` de una carpeta que ya no
existe. Y el respaldo que dejó el plan 01 —
`` `${apiBase}/api/stream/${song.videoId}` `` — tampoco puede funcionar: la ruta
está indexada por `download_id` (un UUID de carpeta temporal), **no** por el
identificador de vídeo de YouTube.

Este plan se ocupa de la mitad del servidor: **definir qué garantiza
`/api/stream/` y durante cuánto tiempo**. La mitad del cliente (dejar de guardar
una URL efímera como `src`) es una reapertura del plan 01 y está anotada como
tal en `INDEX.md`.

---

## 2. Decisiones de diseño

### 2.1 Restricción que hereda el plan 04: el estado vive en el proceso

```python
download_progress = {}
download_cancellation = {}
download_processes = {}
```

Hoy funciona porque `app.run(threaded=True)` es **un proceso con varios hilos**:
todos los hilos ven los mismos diccionarios. En el momento en que el plan 04
ponga gunicorn con `--workers 4`, una descarga iniciada por el worker A será
invisible para el worker B, y `/api/progress/<id>` devolverá `404 Download not
found` de forma aleatoria en 3 de cada 4 peticiones.

> ⚠️ **Por tanto, el plan 04 tiene una restricción dura: `--workers 1 --threads N`**,
> o bien sacar este estado a un almacén compartido (Redis), que es un proyecto en
> sí mismo. Queda escrito aquí porque es aquí donde vive la causa.

No se cambia nada de esto en este plan: solo se documenta y se acota.

### 2.2 El barrido: hilo propio con TTL, no limpieza a la salida

| Alternativa | Por qué no / por qué sí |
|---|---|
| Limpiar en cada petición nueva (barrido perezoso) | Un servidor sin tráfico nunca limpia, y el coste recae en el usuario que llega |
| `cron` externo que borre `/tmp/youtube_downloader` | Borraría carpetas de descargas **en curso**: no conoce el estado en memoria |
| `tempfile.TemporaryDirectory` por descarga | El fichero debe sobrevivir a la petición que lo crea; no encaja |
| **Hilo daemon con intervalo fijo** | ✅ Conoce `download_progress`, corre aunque no haya tráfico, y es una función testeable por separado |

**TTL elegido: 1 hora** desde el último cambio de estado. `DOWNLOAD_TIMEOUT` ya es
de 30 minutos, así que una hora deja margen de sobra para que el usuario recoja
un fichero grande sin que nada activo se borre bajo sus pies.

### 2.3 Qué se promete en `/api/stream/` (D6)

Se elige la opción honesta y barata: **`/api/stream/<download_id>` es un recurso
temporal, no una biblioteca**. Se documenta como tal, se le pone la misma
caducidad que al resto de `TEMP_DIR` y se deja de tratarlo como almacenamiento
permanente.

| Alternativa | Por qué no |
|---|---|
| Guardar las descargas en el servidor indefinidamente, indexadas por `videoId` | Convierte el VPS en un servicio de alojamiento de audio: disco sin techo y otro perfil legal |
| Añadir `/api/stream/by-video/<videoId>` que redescargue bajo demanda | Es una descarga completa disfrazada de streaming; el cliente ya tiene `downloadFromUrl` para eso |
| **Documentar que es efímero y que el cliente persista el audio** | ✅ Es lo que hace el camino nativo, y lo que el plan 01 hizo para web |

---

## 3. Alcance

**Dentro:** `server.py` — el ciclo de vida de `download_progress`,
`download_cancellation`, `download_processes` y `TEMP_DIR`; el arranque del
proceso; `stream_file`; y la higiene de definiciones duplicadas del mismo fichero.

**Fuera:**
- Servir con gunicorn → **plan 04** (aquí solo se deja el arranque preparado).
- Rate limiting y CORS → **plan 02**.
- Sustituir el polling por SSE → **plan 07** (que reescribe el mecanismo de
  progreso que aquí se limpia: por eso 07 depende de 03).
- Cambiar `except Exception` por excepciones concretas → **plan 06**.
- La mitad cliente de D6 (`saveDownloadToApp`) → reapertura del **plan 01**.

---

## 4. Tareas

### Bloque A — Correcciones puntuales

---

#### T1 · `logger` indefinido en `stream_file`

**Ficheros:** `server.py` (~358)

**Qué hacer**

```python
    except Exception as e:
        app.logger.exception("Streaming error")       # antes: logger.error(f"...")
        return jsonify({'error': 'Error al servir el audio'}), 500
```

Dos cambios en una línea: `logger` → `app.logger` (la corrección de D1) y
`.error(f"{e}")` → `.exception(...)`, que es lo que hace el resto del fichero y
además registra la traza.

De paso, **dejar de devolver `str(e)` al cliente**: hoy la respuesta filtra la
ruta absoluta del fichero y detalles internos del servidor.

**Por qué** Corrige D1. Es una línea, pero está en el único camino que un error de
streaming puede recorrer: el fallo real queda enmascarado por un `NameError` y el
cliente recibe un 500 sin información útil en los logs.

**Verificación**

```bash
grep -n "[^.]logger\." server.py    # sin resultados: todo debe ser app.logger
```
Provocar el error a mano (crear `TEMP_DIR/<id>/x.m4a`, pedirlo y borrarlo entre
medias) y comprobar que en `journalctl` aparece la traza, no un `NameError`.

---

#### T2 · Eliminar las definiciones duplicadas

**Ficheros:** `server.py` (~183-208, ~276-283, ~361-364, ~714-740)

**Qué hacer**

1. **`get_playlist_count`** está definida en la línea 183 y otra vez en la 714.
   En Python gana la última, así que la de 183 es código muerto. Y no son
   equivalentes:

   | | Línea 183 (muerta) | Línea 714 (la que corre) |
   |---|---|---|
   | Estrategia | `--print %(playlist_count)s --playlist-items 1` | `--dump-single-json` y contar `entries` |
   | Coste | Barata: pide un solo ítem | Cara: descarga los metadatos de la playlist entera |
   | Timeout | 30 s | **ninguno** |
   | Devuelve al fallar | `None` | `0` |

   **Decisión:** conservar la versión de la línea 183 (la barata, con timeout),
   borrar la de 714 y ajustar su único llamante, `resolve_download_input`
   (server.py:761), que hace `get_playlist_count(search_query) or 0` — ese `or 0`
   ya absorbe el `None`, así que no hay que tocar nada más.

   > Esto no es solo higiene: la versión que corre hoy no tiene timeout y usa
   > `--dump-single-json` sobre playlists que pueden tener miles de vídeos. Es
   > una de las formas de dejar un `/api/start-download` colgado.

2. **`/manifest.json`** está registrada en la 276 (`serve_manifest`) y en la 361
   (`pwa_manifest`). Flask se queda con la primera, así que `pwa_manifest` nunca
   se ejecuta: borrarla entera.

3. Al borrarla, **fijarse en lo que destapa**: `serve_manifest` sirve el primero
   que encuentre entre `dist/`, `public/` y `.`, y los dos ficheros del repo **no
   son iguales**:

   ```
   $ diff manifest.json public/manifest.json
   <   "background_color": "#0a0a0a"      (raíz)
   >   "background_color": "#0A0C0A"      (public/)
   ```

   Como Vite copia `public/` dentro de `dist/`, el que se sirve en producción es
   el de `public/`, y el de la raíz solo se usa si no hay build. Anotarlo para el
   **plan 04**, que es quien ordena los artefactos de build; aquí no se toca.

**Por qué** Corrige D3. Dos definiciones del mismo nombre significa que alguien
leerá y editará la que no corre. En el caso de `get_playlist_count`, además, la
que corre es la peor de las dos.

**Verificación**

```bash
grep -c "def get_playlist_count" server.py     # 1
grep -c "@app.route('/manifest.json'" server.py # 1
curl -s https://music.dannarita.es/manifest.json | head -3
```
Y una descarga de playlist que siga informando del total correcto.

---

#### T3 · `stream_file` sin cargar el fichero en RAM (D5)

**Ficheros:** `server.py` (`stream_file` ~310-359)

**Qué hacer**

1. Acotar el rango servido a un tamaño máximo por respuesta:

   ```python
   MAX_RANGE_CHUNK = 4 * 1024 * 1024      # 4 MB por respuesta parcial

   length = file_size - byte1
   if byte2 is not None:
       length = byte2 + 1 - byte1
   length = min(length, MAX_RANGE_CHUNK)
   ```

2. Validar el rango antes de usarlo, que hoy no se hace:

   ```python
   if byte1 >= file_size or byte1 < 0:
       return Response(status=416, headers={'Content-Range': f'bytes */{file_size}'})
   ```

3. Usar `safe_download_path(download_id)` en vez de la comprobación artesanal
   `'..' in download_id or '/' in download_id` (alineado con T7 del plan 02).

**Por qué** `f.read(length)` con `Range: bytes=0-` reserva el fichero entero en
memoria del proceso. Con `--threads N` (la configuración a la que lleva 2.1),
varias peticiones simultáneas multiplican eso. Servir en trozos de 4 MB es el
comportamiento normal de un servidor de medios y el reproductor lo maneja sin
enterarse: pide el siguiente rango.

**Verificación**

```bash
curl -s -o/dev/null -D- -H 'Range: bytes=0-' http://127.0.0.1:5000/api/stream/<id> | grep -i content-range
# debe devolver 206 con un Content-Range de como mucho 4 MB
```
Y reproducir una canción entera desde el navegador, incluyendo saltar al minuto 3
con la barra de progreso (es lo que ejercita los rangos de verdad).

---

### Bloque B — Ciclo de vida

---

#### T4 · Marca de tiempo y registro central de descargas

**Ficheros:** `server.py` (cabecera ~83-88, `start_download` ~1049, `start_batch_download` ~692, `cancel_download`, `finalize_download_status`)

**Qué hacer**

1. Añadir un candado y una marca de tiempo. Los tres diccionarios los escriben
   varios hilos a la vez (el monitor, el lector de salida de yt-dlp, las
   peticiones HTTP) y hoy no hay ninguna sincronización:

   ```python
   download_lock = threading.Lock()
   ```

2. Que **toda** creación de entrada incluya cuándo se creó y cuándo se tocó por
   última vez:

   ```python
   def register_download(download_id, total_count, **extra):
       now = time.time()
       with download_lock:
           download_progress[download_id] = {
               'status': 'starting', 'current': 0, 'total': total_count,
               'message': 'Iniciando descarga...',
               'created_at': now, 'updated_at': now,
               **extra,
           }
           download_cancellation[download_id] = threading.Event()
   ```

   y que todo cambio de estado actualice `updated_at`. El sitio natural es un
   único `update_progress(download_id, **fields)` por el que pasen las escrituras
   que hoy están repartidas en `monitor_download_files`,
   `update_download_progress`, `run_parallel_batch` y `finalize_download_status`.

3. Añadir una función de borrado única, que limpie las tres estructuras y la
   carpeta:

   ```python
   def forget_download(download_id, remove_folder=True):
       with download_lock:
           download_progress.pop(download_id, None)
           download_cancellation.pop(download_id, None)
           download_processes.pop(download_id, None)
       if remove_folder:
           folder = safe_download_path(download_id)
           if folder:
               cleanup_temp_folder(folder)
   ```

   y usarla en `cancel_download` y en los dos `call_on_close` de `get_download`,
   que hoy hacen esa limpieza a mano y de forma incompleta.

**Por qué** Sin `updated_at` no se puede barrer por antigüedad, y sin un único
punto de creación y borrado el barrido tendría que conocer las cuatro formas
distintas en que hoy se escribe el progreso. El candado no es paranoia: hay
escrituras concurrentes reales sobre `download_progress[download_id]` desde el
hilo monitor y desde el lector de stdout.

**Verificación** `GET /api/progress/<id>` sigue devolviendo lo mismo que antes
(los campos nuevos son aditivos). Una descarga de playlist completa sin errores
en el log.

---

#### T5 · Barrido periódico por antigüedad

**Ficheros:** `server.py` (nueva sección antes de las rutas)

**Qué hacer**

```python
DOWNLOAD_TTL_SECONDS = 3600          # 1 hora sin cambios → se descarta
SWEEP_INTERVAL_SECONDS = 600         # barrido cada 10 minutos
ACTIVE_STATUSES = ('starting', 'downloading')


def sweep_stale_downloads():
    """Descarta descargas inactivas y sus carpetas. Devuelve cuántas quitó."""
    now = time.time()
    with download_lock:
        stale = [
            did for did, p in download_progress.items()
            if now - p.get('updated_at', p.get('created_at', 0)) > DOWNLOAD_TTL_SECONDS
            and p.get('status') not in ACTIVE_STATUSES
        ]
    for did in stale:
        app.logger.info(f"Barrido: descartando descarga inactiva {did}")
        forget_download(did)
    return len(stale)


def sweep_orphan_folders():
    """Borra carpetas de TEMP_DIR sin entrada en download_progress y antiguas."""
    now = time.time()
    removed = 0
    for entry in Path(TEMP_DIR).iterdir() if os.path.isdir(TEMP_DIR) else []:
        if not entry.is_dir() or entry.name in download_progress:
            continue
        if now - entry.stat().st_mtime > DOWNLOAD_TTL_SECONDS:
            cleanup_temp_folder(str(entry))
            removed += 1
    return removed


def start_sweeper():
    def loop():
        while True:
            time.sleep(SWEEP_INTERVAL_SECONDS)
            try:
                n = sweep_stale_downloads() + sweep_orphan_folders()
                if n:
                    app.logger.info(f"Barrido: {n} elementos liberados")
            except Exception:
                app.logger.exception("Error en el barrido periódico")
    threading.Thread(target=loop, daemon=True, name='sweeper').start()
```

Detalles que importan:

- **Nunca se barre una descarga activa**: el filtro por `status` lo garantiza, y
  `updated_at` se refresca cada segundo mientras yt-dlp escribe progreso.
- Una descarga **colgada** (proceso vivo pero sin salida durante una hora) sí se
  barre: es exactamente el caso que hoy se queda para siempre. Antes de olvidarla
  hay que matar su proceso — `forget_download` debe terminar
  `download_processes[download_id]` si sigue vivo, reutilizando la lógica que ya
  tiene `cancel_download` (server.py:526-539).
- El `except Exception` del bucle es deliberado y está justificado: si el barrido
  muere, la fuga vuelve en silencio. Es la excepción a la regla que el **plan 06**
  aplicará al resto del fichero, y conviene dejarlo escrito en un comentario.

**Por qué** Es el grueso de D2. Las dos funciones están separadas a propósito:
`sweep_stale_downloads` mira el estado en memoria y `sweep_orphan_folders` mira el
disco, que es lo que queda tras un reinicio. Y son dos funciones puras y cortas,
fáciles de cubrir con tests en el **plan 06**.

**Verificación** Bajar temporalmente `DOWNLOAD_TTL_SECONDS` a 30 y
`SWEEP_INTERVAL_SECONDS` a 5, lanzar una descarga, no recogerla, y comprobar en el
log que se descarta y que la carpeta desaparece de `TEMP_DIR`. Repetir la prueba
con una descarga **en curso** y comprobar que **no** se toca.

---

#### T6 · Arranque limpio e independiente del `__main__` (D4)

**Ficheros:** `server.py` (~1541-1564)

**Qué hacer**

1. Sacar la inicialización del bloque `if __name__ == '__main__'` a nivel de
   módulo, justo después de la configuración:

   ```python
   def bootstrap():
       """Inicialización que debe correr tanto con `python server.py` como bajo WSGI."""
       db.init_db()
       os.makedirs(TEMP_DIR, exist_ok=True)
       purge_temp_dir_on_boot()
       start_sweeper()

   bootstrap()
   ```

2. Añadir la limpieza de arranque, que es la otra mitad de D2:

   ```python
   def purge_temp_dir_on_boot():
       """Al arrancar no hay ninguna descarga en curso: todo lo que haya sobra."""
       if not os.path.isdir(TEMP_DIR):
           return
       for entry in os.listdir(TEMP_DIR):
           cleanup_temp_folder(os.path.join(TEMP_DIR, entry))
       app.logger.info("TEMP_DIR limpiado al arrancar")
   ```

3. Dejar en `if __name__ == '__main__'` **solo** el banner y `app.run(...)`.

**Por qué** Corrige D4 antes de que muerda. Hoy `db.init_db()` y la creación de
`TEMP_DIR` funcionan de casualidad, porque se arranca con `python server.py`. En
cuanto el plan 04 ponga gunicorn, ese bloque no se ejecuta: la base de datos no se
inicializa y la primera descarga falla con `FileNotFoundError` sobre `/tmp`.
Arreglarlo **aquí** hace que el plan 04 sea un cambio de una línea en el
`ExecStart` en vez de una depuración a ciegas en producción.

El purgado de arranque es correcto por construcción: tras un reinicio no queda
ningún `download_progress`, así que **nada** de lo que hay en `TEMP_DIR` es
recuperable.

**Verificación**

```bash
python3 -c "import server"     # debe inicializar sin arrancar el servidor
ls /tmp/youtube_downloader     # vacío tras el arranque
```
Y comprobar que la base de datos existe y responde: `GET /api/auth/me` con un
token válido.

---

#### T7 · Documentar el contrato de `/api/stream/` (D6)

**Ficheros:** `server.py` (`stream_file` ~310), `README.md`

**Qué hacer**

1. Escribir el contrato en el docstring de la ruta, sin ambigüedad:

   ```python
   @app.route('/api/stream/<download_id>', methods=['GET'])
   def stream_file(download_id):
       """Sirve un fichero recién descargado, con soporte de Range.

       CONTRATO: es un recurso TEMPORAL. La carpeta se borra cuando el cliente
       recoge el fichero por /api/download/<id>, y en cualquier caso a la hora
       (DOWNLOAD_TTL_SECONDS). NO es almacenamiento: el cliente debe persistir el
       audio por su cuenta (Filesystem en nativo, IndexedDB en web).

       El identificador es un download_id, NUNCA un videoId de YouTube.
       """
   ```

2. Devolver un 404 explicativo cuando la carpeta ya no está, para que el cliente
   pueda distinguir «expiró» de «nunca existió»:

   ```python
   return jsonify({'error': 'El fichero ha expirado', 'code': 'stream_expired'}), 404
   ```

3. Anotar en `INDEX.md` que la mitad cliente (dejar de guardar
   `/api/stream/<download_id>` como `song.src` en `saveDownloadToApp`) es una
   reapertura del plan 01.

**Por qué** El respaldo que el plan 01 dejó en `resolveStreamSrc`
(`/api/stream/${song.videoId}`) nunca puede acertar, porque la ruta no está
indexada por vídeo. Escribir el contrato evita que el siguiente intento vuelva a
construir una URL imposible, y el `code` da al cliente algo con lo que decidir
(por ejemplo, ofrecer «volver a descargar» en vez de fallar en silencio).

**Verificación**

```bash
curl -s http://127.0.0.1:5000/api/stream/00000000000000000000000000000000 | jq .code
# "stream_expired"
```

---

### Bloque C — Verificación automática

---

#### T8 · Tests del ciclo de vida

**Ficheros:** `test/backend/test_download_registry.py` (nuevo),
`test/backend/test_api_endpoints.py`, `test/backend/test_download_helpers.py`

**Qué hacer**

| Qué | Comprobación |
|---|---|
| `logger` indefinido (T1) | Forzar el `except` de `stream_file` con un fichero ilegible y comprobar que responde 500 con JSON, **sin `NameError`** |
| Duplicados (T2) | `server.py` define `get_playlist_count` una sola vez, y `/manifest.json` tiene un único endpoint registrado en `app.url_map` |
| `stream_file` sin RAM (T3) | Un fichero de 50 MB se sirve sin que la respuesta cargue los 50 MB de golpe: comprobar que devuelve un iterable/`send_file`, no `bytes` |
| Registro central (T4) | Alta, consulta y baja de una descarga; la marca de tiempo se fija al crearla |
| Barrido (T5) | Con entradas envejecidas artificialmente, el barrido borra las caducadas y **respeta las vivas**; `download_progress` y `TEMP_DIR` quedan coherentes |
| Arranque (T6) | `bootstrap()` es idempotente y no hace nada con `YTDL_SKIP_BOOTSTRAP=1` |
| Contrato de `/api/stream/` (T7) | `Accept-Ranges`, `Content-Range` y 206 en rangos; 416 en un rango imposible |

El test del barrido es el importante: es el que evita que vuelva la fuga de
memoria y de disco. Debe cubrir explícitamente que **no borra descargas en
curso**, que es la forma más fácil de estropearlo.

**Por qué** El barrido borra ficheros según una marca de tiempo. Un fallo ahí no
da error: borra descargas de usuarios que estaban a medias, o no borra nada y la
fuga sigue. Ninguna de las dos cosas se nota sin un test.

**Verificación** `pytest test/backend/test_download_registry.py -v` en verde, y
la suite completa sin regresiones.

---

## 5. Orden de ejecución y commits

```
T1 → T2 → T3          (bloque A: correcciones puntuales, mergeables por separado)
T4 → T5 → T6 → T7     (bloque B: el ciclo de vida, en este orden estricto)
T8                    (bloque C: tests; el del barrido, antes de activarlo)
```

T4 **antes** que T5 sin excepción: el barrido necesita `updated_at` y
`forget_download`, que es lo que T4 introduce. T6 después de T5 porque
`bootstrap()` arranca el barrido.

El bloque A puede ir en su propio commit y desplegarse el primer día; el bloque B
conviene mergearlo junto, porque T4 sin T5 solo añade campos que nadie usa.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El barrido borra una descarga en curso | **Media** | Filtro por `status` **y** por `updated_at`; prueba explícita con una descarga activa en T5 |
| El purgado de arranque borra algo útil | Baja | Tras un reinicio no queda estado en memoria: nada de `TEMP_DIR` es recuperable por definición |
| Mover `db.init_db()` a nivel de módulo rompe los tests del plan 06 (efecto secundario al importar) | Media | `bootstrap()` es una función: el plan 06 podrá importar `server` con una variable de entorno que la salte |
| El troceado de rangos rompe la reproducción en algún navegador | Baja | Es comportamiento estándar de servidores de medios; probar reproducción completa + salto en la barra |
| Hilos escribiendo en `download_progress` sin pasar por el candado nuevo | Media | Inventariar los cuatro escritores actuales al hacer T4 y cerrar con `grep -n "download_progress\[" server.py` |
| El barrido oculta fallos al capturar `Exception` | Baja | Registra con `app.logger.exception`: el fallo queda en el log, solo no mata el hilo |

---

## 7. Definición de hecho

- [ ] `grep -n "[^.]logger\." server.py` → sin resultados.
- [ ] `grep -c "def get_playlist_count" server.py` → 1, y es la versión con timeout.
- [ ] `grep -c "@app.route('/manifest.json'" server.py` → 1.
- [ ] Toda escritura de `download_progress` pasa por el candado (`grep -n "download_progress\[" server.py` revisado uno a uno).
- [ ] Con TTL reducido: una descarga abandonada desaparece de memoria y de disco; una activa sobrevive.
- [ ] `TEMP_DIR` queda vacío tras reiniciar el servicio.
- [ ] `python3 -c "import server"` inicializa la BD y el directorio temporal.
- [ ] `Range: bytes=0-` sobre un fichero grande devuelve como mucho 4 MB.
- [ ] Reproducción completa + salto en la barra de progreso, sin cortes.
- [ ] El contrato de `/api/stream/` está escrito en el código.
- [ ] Tras 24 h de uso normal: `ls /tmp/youtube_downloader | wc -l` se mantiene bajo.
- [ ] `python3 -m py_compile server.py` pasa.
- [ ] `pytest test/backend/test_download_registry.py` en verde, incluido el test de que el barrido **no borra descargas en curso**.


---

## 8. Registro de ejecución (2026-09-21)

**T1 a T8 implementados. 408 tests en verde** (35 nuevos en
`test/backend/test_download_registry.py`).

| Tarea | Qué quedó |
|---|---|
| T1 | `logger` → `app.logger.exception` en `stream_file`; el error ya no revienta con `NameError` |
| T2 | Eliminado el `get_playlist_count` duplicado (30 líneas muertas) y la ruta `/manifest.json` registrada dos veces |
| T3 | `MAX_RANGE_CHUNK` de 4 MB, `416` para rangos fuera del fichero y `safe_download_path` en vez de la validación artesanal |
| T4 | `download_lock`, `register_download`, `update_progress`, `forget_download` y `terminate_download_process` |
| T5 | `sweep_stale_downloads`, `sweep_orphan_folders` y `start_sweeper` (idempotente) |
| T6 | `bootstrap()` a nivel de módulo con salida `YTDL_SKIP_BOOTSTRAP`, y `purge_temp_dir_on_boot` |
| T7 | Contrato en el docstring de `stream_file` y en el README |
| T8 | 35 tests, incluido el de que el barrido **no toca descargas en curso** |

### Notas de la implementación

**`start_sweeper` se hizo idempotente**, cosa que el plan no pedía. Con varios
workers de gunicorn (plan 04) cada uno importa el módulo, y sin el guardia se
acumularía un hilo de barrido por worker.

**`forget_download` mata el proceso antes de olvidar la entrada.** El plan lo
mencionaba de pasada; se extrajo a `terminate_download_process`, reutilizando la
lógica que tenía `cancel_download`, que quedó reducida de 38 líneas a 8.

**Las ocho escrituras sueltas sobre `download_progress` pasan ahora por
`update_progress`**, que es lo que garantiza que `updated_at` se refresque
siempre. Sin eso, el barrido habría dado por colgada una descarga viva.

### Pendiente — requiere desplegar

Nada específico de este plan más allá del despliegue general. Al subirlo:

- `purge_temp_dir_on_boot()` vaciará `/tmp/youtube_downloader` en el arranque
  (hoy tiene 2,4 MB de restos). **Conviene desplegar sin descargas activas.**
- El barrido empieza a correr solo, sin configuración.
