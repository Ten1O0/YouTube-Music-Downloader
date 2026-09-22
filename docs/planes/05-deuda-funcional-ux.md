# 05 — Deuda funcional y UX

**Estado:** código implementado · **SIN DESPLEGAR** · **Prioridad:** 🟢 Bajo · **Depende de:** —
**Puntos del análisis:** 4, 20 (+ cuatro hallazgos nuevos, ver D3 a D6)

> Plan corto y visible. Buen candidato para intercalar entre dos planes grandes.

---

## 1. Problema

Lo que el usuario ve y no cumple lo que promete.

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | El selector de calidad no hace nada | index.html:204-221 · server.py:683, 1041 | El usuario cree que elige 128/192/320 kbps; siempre recibe lo mismo |
| D2 | i18n a medias: 6 idiomas traducidos, 34 avisos en castellano incrustado | app.js (`showStatus`) | Un usuario en inglés ve «Añadido a favoritos» y «Esta canción ya está en la biblioteca» |
| D3 | **(nuevo)** El idioma por defecto es `'es'` sin mirar el navegador | app.js `LanguageManager` (~1964) | Un usuario inglés que entra por primera vez ve la app en castellano |
| D4 | **(nuevo)** Hay un ternario `currentLang === 'es' ? 'Salir' : 'Logout'` | app.js ~2491, ~2506 | Con 6 idiomas configurados, dos textos solo conocen dos |
| D5 | **(nuevo)** El servidor manda los mensajes de progreso en castellano y el cliente los pinta tal cual | server.py → `updateProgress(percent, data.message)` app.js ~2730 | La barra de progreso es intraducible desde el cliente |
| D6 | **(nuevo)** El camino nativo nombra el fichero con una extensión constante | `saveToNativeCapacitor`, app.js:3057 (`const fileExt = '.m4a'`) | Bloquea el selector de formato: un mp3 se guardaría llamándose `.m4a` |

### D1 · Por qué el selector de calidad no puede funcionar tal cual

El valor viaja entero hasta el final y muere ahí:

```
index.html #qualitySelect → app.js qualitySelect.value (3104, 3414, 3887)
   → POST {quality} → server.py:1041 quality = str(data.get('quality', '192'))
   → ...y no se vuelve a usar nunca
```

En la ruta de lote llega un paso más lejos —`run_parallel_batch(…, quality, …)` →
`download_single_item(video, folder, audio_quality)`— y el parámetro
`audio_quality` **tampoco se lee**: el comando lleva `--audio-quality 0` fijo
(server.py:573 y 799).

Y aquí está lo importante, que el análisis no podía saber sin mirar el comando:

```python
'-f', 'bestaudio[ext=m4a]/bestaudio',
'-x',
'--audio-format', 'm4a',
'--audio-quality', '0',
```

Cuando la pista de origen ya es `m4a`, yt-dlp **no re-codifica**: remuxea la
pista tal cual. `--audio-quality` solo aplica si hay re-codificación, así que en
este comando es inerte **aunque se cablease el valor del usuario**.

Peor: la mejor pista de audio que YouTube sirve en m4a es AAC de ~128 kbps
(itag 140). **«320 kbps» no existe en el origen.** Ofrecerlo solo puede
cumplirse re-codificando 128 → 320, que produce un fichero 2,5 veces más grande
y de peor calidad que el original.

Por eso el control no se cablea: **se sustituye por una elección que sí es real**
(ver §2.1).

### D2 · El alcance real de la i18n incompleta

| Medida | Valor |
|---|---|
| Idiomas en `TRANSLATIONS` | 6 (es, en, fr, de, pt, zh) |
| Claves por idioma | 59, las seis completas |
| Atributos `data-i18n` en `index.html` | 40 |
| `showStatus(i18n.t(...))` | 11 |
| **`showStatus('literal en castellano')`** | **34** |
| `confirm()` / `alert()` con texto fijo | 9 |
| `updateProgress(percent, 'literal')` | 8 |

O sea: la parte estática (el HTML) está traducida, y **la parte dinámica —justo
la que responde a lo que el usuario acaba de hacer— no lo está**.

---

## 2. Decisiones de diseño

### 2.1 Formato en vez de calidad — **decisión tomada**

El selector pasa de `128 / 192 / 320 kbps` a **`m4a` / `mp3`**, dos opciones y
nada más.

La diferencia con el control actual es que esta elección **sí tiene consecuencias
reales y distintas**:

| | **m4a (AAC)** — por defecto | **mp3** |
|---|---|---|
| Qué hace yt-dlp | Remuxea la pista original | **Re-codifica** con ffmpeg |
| Calidad | La del origen, intacta | Pérdida adicional (lossy → lossy) |
| Tamaño | ~3-4 MB por canción | ~5-6 MB |
| CPU del servidor | Prácticamente cero | **Alta**: es el cuello de botella |
| Tiempo de descarga | El de la red | La red **más** la conversión |
| Compatibilidad | Móviles, ordenadores, coches modernos | **Todo**, incluidos reproductores y radios de coche antiguos |

Es decir: **m4a es mejor en todo salvo en compatibilidad con cacharros viejos**,
y esa es justo la razón por la que alguien querría mp3. Elección legítima, y el
usuario puede entenderla sin saber qué es un bitrate.

**Por defecto se mantiene `m4a`**: es el comportamiento de hoy, así que quien no
toque nada no nota ningún cambio.

#### Lo que hay que vigilar al activar mp3

`server.py:45` lo dice literalmente:

```python
MAX_WORKERS = 5  # Parallel downloads (safe for M4A - no CPU-heavy conversion)
```

El pool de 5 descargas paralelas se dimensionó **asumiendo que no hay
conversión**. Cinco transcodificaciones simultáneas en el VPS son cinco procesos
de ffmpeg a pleno rendimiento, y eso degrada todo lo demás (el servidor, además,
no tiene rate limiting hasta el plan 02). Por eso T1 añade un semáforo que limita
las conversiones simultáneas, independiente del pool.

### 2.2 Los mensajes del servidor no se traducen en el cliente (D5)

`updateProgress(percent, data.message)` pinta literalmente lo que manda el
servidor: `'Descargando... 3 de 12 canciones'`, `'¡Completado! 5 archivos
descargados.'`, `'Creando archivo ZIP...'`. Desde el cliente no hay forma de
traducir eso sin adivinar con expresiones regulares.

La solución correcta es que el servidor mande **un código y unos parámetros**, no
una frase:

```json
{"status": "downloading", "code": "downloading_n_of_m", "params": {"current": 3, "total": 12},
 "message": "Descargando... 3 de 12 canciones"}
```

El campo `message` se conserva para no romper nada, y el cliente prefiere
`i18n.t(code, params)` cuando el código viene.

**Pero ese cambio se hace en el plan 07**, que reescribe el mecanismo de progreso
entero al pasar de polling a SSE. Hacerlo dos veces sería tirar trabajo. Por
tanto:

- **Este plan (05):** traduce todo lo que el cliente genera por su cuenta.
- **Plan 07:** añade `code` + `params` al protocolo de progreso.
- Las claves de traducción para esos códigos se añaden aquí, en T6, para que 07
  solo tenga que emitirlas.

---

## 3. Alcance

**Dentro:** el selector de formato de punta a punta (`index.html`, `app.js`,
`server.py`), la extensión del fichero en el camino nativo, y los textos que el
**cliente** genera (`showStatus`, `updateProgress`, `confirm`, `textContent`
sueltos) más la detección de idioma.

**Fuera:**
- Los mensajes que vienen del servidor → **plan 07** (§2.2).
- Los mensajes de error de la API (`jsonify({'error': 'La búsqueda debe tener al
  menos 2 caracteres'})`): mismo problema y misma solución que D5; se abordan con
  07 o en un plan propio de i18n del backend.
- Traducir `download.html` (la landing de la APK), que hoy es solo castellano.
- Añadir más formatos (opus, flac, wav): dos opciones es la decisión tomada.
- Convertir ficheros **ya descargados** de un formato a otro.
- Cambios de diseño visual.

---

## 4. Tareas

### Bloque A — Selector de formato

---

#### T1 · Formato de audio en el servidor

**Ficheros:** `server.py` (`download_single_item` ~562, `run_parallel_batch` ~610, `build_ytdlp_download_cmd` ~790, `start_download` ~1041, `start_batch_download` ~683)

**Qué hacer**

1. **Lista blanca**, nunca el valor del usuario tal cual:

   ```python
   AUDIO_FORMATS = {'m4a', 'mp3'}
   DEFAULT_AUDIO_FORMAT = 'm4a'

   def resolve_audio_format(data):
       fmt = str(data.get('format', DEFAULT_AUDIO_FORMAT)).lower()
       if fmt not in AUDIO_FORMATS:
           raise InvalidInputError(f'Formato no soportado: {fmt}')
       return fmt
   ```

   > Hasta ahora `quality` era inofensivo porque nadie lo leía. En cuanto el
   > valor del usuario **sí** llega al comando de yt-dlp, deja de serlo. No hay
   > riesgo de inyección de shell (el comando es una lista, no una cadena), pero
   > un valor arbitrario acabaría en `--audio-format` y provocaría un fallo
   > opaco. La lista blanca es obligatoria.

2. **Un solo constructor de comando.** Hoy hay dos listas de argumentos casi
   idénticas (`download_single_item` ~567 y `build_ytdlp_download_cmd` ~792),
   y duplicarlas otra vez para el formato sería el tercer sitio donde olvidarse
   de una bandera. Unificarlas:

   ```python
   def build_ytdlp_audio_cmd(target, audio_format=DEFAULT_AUDIO_FORMAT, *, single=True):
       if audio_format == 'mp3':
           # Re-codifica: la fuente es AAC ~128 kbps, así que V2 (~190 kbps VBR)
           # sobra. V0 solo inflaría el fichero sin ganar nada.
           fmt_args = ['-f', 'bestaudio', '--audio-format', 'mp3', '--audio-quality', '2']
       else:
           # Remuxea sin re-codificar: calidad intacta y CPU cero
           fmt_args = ['-f', 'bestaudio[ext=m4a]/bestaudio', '--audio-format', 'm4a', '--audio-quality', '0']

       cmd = [sys.executable, '-m', 'yt_dlp', '--no-check-certificates', '-x', *fmt_args,
              '--embed-thumbnail', '--add-metadata', '-o', '%(title)s.%(ext)s',
              '--ffmpeg-location', FFMPEG_PATH, '--ignore-errors', ...]
       if single:
           cmd.append('--no-playlist')
       cmd.append(target)
       return cmd
   ```

   Respetar las diferencias que sí existen entre los dos comandos actuales
   (`--user-agent` en uno, `--print after_video:` y `--encoding utf-8` en el
   otro) en vez de fundirlas a ciegas: son intencionadas.

3. **Semáforo de transcodificación** (§2.1):

   ```python
   MAX_TRANSCODES = 2   # ffmpeg simultáneos; el pool de descargas sigue en 5
   transcode_slots = threading.Semaphore(MAX_TRANSCODES)
   ```
   y en `download_single_item`, envolver la llamada a yt-dlp con el semáforo
   **solo si `audio_format == 'mp3'`**. Así una playlist en m4a sigue
   descargando 5 en paralelo como hoy, y una en mp3 convierte de dos en dos.

4. Propagar el formato: `start_download` y `start_batch_download` lo resuelven,
   lo guardan en `download_progress[download_id]['format']` (útil para el
   cliente) y lo pasan a las tareas de fondo.

5. **Aceptar `quality` y descartarlo**, para que una APK vieja sin actualizar
   siga funcionando. Ya se ignoraba de hecho.

**Por qué** Corrige D1 por la vía de §2.1. El punto 2 no es un extra: sin
unificar los dos comandos, el formato habría que cablearlo dos veces y la ruta de
lote se quedaría desincronizada tarde o temprano — que es exactamente lo que le
pasó a `audio_quality`.

**Verificación**

```bash
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"url":"<vídeo>","format":"mp3"}' http://127.0.0.1:5000/api/start-download
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"url":"<vídeo>","format":"flac"}' http://127.0.0.1:5000/api/start-download   # 400
```
Descargar el mismo vídeo en los dos formatos y comprobar con `ffprobe` que uno es
AAC y el otro MP3, que los dos llevan carátula (`--embed-thumbnail` con mp3
escribe un `APIC` de ID3: **hay que comprobarlo, no darlo por hecho**) y que los
dos conservan título y artista.

---

#### T2 · Selector de formato en la interfaz

**Ficheros:** `index.html` (~204-222), `app.js` (~1541, 3104, 3414, 3887, ~7366-7390 y `TRANSLATIONS`)

**Qué hacer**

1. Reaprovechar el control que ya existe —el `.custom-select` con su `<select>`
   oculto— y cambiarle el contenido: `id="formatSelect"`, dos opciones
   (`m4a` seleccionada por defecto, `mp3`). Así no se toca `styles.css`.

2. Etiquetas que expliquen la elección **sin hablar de códecs**:

   | Valor | Etiqueta | Descripción |
   |---|---|---|
   | `m4a` | «M4A · recomendado» | «Mejor calidad y descarga más rápida» |
   | `mp3` | «MP3 · compatible» | «Para reproductores y equipos antiguos» |

3. Sustituir las tres lecturas `qualitySelect.value` por `formatSelect.value` y
   mandar `{ format }` en lugar de `{ quality }` en las tres peticiones.

4. **Recordar la elección** entre sesiones, que hoy no ocurre:

   ```js
   const saved = await StorageModule.get('audio_format');
   if (saved) formatSelect.value = saved;
   formatSelect.addEventListener('change', () => StorageModule.set('audio_format', formatSelect.value));
   ```

5. En `TRANSLATIONS`, sustituir `quality_normal` / `quality_high` / `quality_max`
   por `format_m4a` / `format_mp3` / `format_label` en los seis idiomas.

6. Avisar al elegir mp3, una sola vez:
   `showStatus(i18n.t('format_mp3_notice'), 'info')` — «MP3 tarda más porque hay
   que convertir el audio». Gestiona la expectativa del usuario, que si no creerá
   que la app va lenta.

**Por qué** El usuario pasa a tomar una decisión con consecuencias visibles, y
recordarla evita que tenga que reelegirla en cada descarga.

**Verificación** `grep -rn "qualitySelect\|quality_normal\|quality_high\|quality_max" app.js index.html`
→ sin resultados. Elegir mp3, recargar y comprobar que sigue en mp3. Descargar
en los dos formatos desde búsqueda, desde playlist y desde favoritos (los tres
puntos que mandan la petición).

---

#### T3 · Extensión coherente en el camino nativo (D6)

**Ficheros:** `app.js` (`saveToNativeCapacitor` ~3054-3060, `runNativeGarbageCollector` ~808, `runNativeRecovery` ~6656)

**Qué hacer**

1. `saveToNativeCapacitor` fija la extensión a mano:

   ```js
   const fileExt = '.m4a';          // ← se guardaría un mp3 llamándose .m4a
   ```

   Derivarla de **lo que el servidor ha devuelto de verdad**, no de lo que se
   pidió, que es lo único robusto si la conversión falla y yt-dlp cae al formato
   original:

   ```js
   function extFromResponse(response, fallback = '.m4a') {
       const cd = response.headers.get('Content-Disposition') || '';
       const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
       const name = m?.[1] ? decodeURIComponent(m[1]) : '';
       const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
       return ['.m4a', '.mp3'].includes(ext) ? ext : fallback;
   }
   ```
   El servidor ya expone esa cabecera: `CORS(app, expose_headers=["Content-Disposition"])`
   (server.py:43) está puesto justo para esto.

2. El recolector de basura nativo solo borra huérfanos `.m4a`:

   ```js
   if (fileName.startsWith('ytmusic_') && fileName.endsWith('.m4a')) { ... }
   ```
   Ampliarlo a `.mp3`, o los mp3 huérfanos se acumularían para siempre en el
   móvil. `scanPublicFolder` (app.js:905) ya contempla los dos: usar el mismo
   criterio en los dos sitios.

3. Revisar `extractVideoId` (app.js:2963), que reconoce el patrón
   `ytmusic_VIDEOID.m4a`. Comprobar si la expresión regular depende de la
   extensión; si depende, ampliarla.

**Por qué** Es lo que convierte T1 y T2 de «funciona en el navegador» a
«funciona en la APK». Un fichero mp3 llamado `.m4a` puede reproducirse igual
—los reproductores miran el contenido— pero rompe el lector de metadatos, la
importación posterior y, sobre todo, deja de cumplir la promesa de
compatibilidad que era **la única razón** de ofrecer mp3.

**Verificación** En la APK: descargar en mp3, y comprobar con un explorador de
archivos que en `Documentos/YTMusic` aparece un `.mp3` de verdad. Borrarla de la
biblioteca y comprobar que el recolector se lleva el fichero.

---

### Bloque B — i18n del cliente

---

#### T4 · Detección de idioma del navegador (D3)

**Ficheros:** `app.js` (`LanguageManager.init` ~1967)

**Qué hacer**

```js
const SUPPORTED_LANGS = ['es', 'en', 'fr', 'de', 'pt', 'zh'];

function detectBrowserLang() {
    for (const tag of navigator.languages || [navigator.language || '']) {
        const base = tag.toLowerCase().split('-')[0];
        if (SUPPORTED_LANGS.includes(base)) return base;
    }
    return 'es';
}

async function init() {
    const stored = await StorageModule.get('language');
    this.currentLang = stored || detectBrowserLang();
    ...
}
```

Y de paso endurecer `setLanguage`, que hoy hace `TRANSLATIONS[lang][key]` sin
comprobar que `TRANSLATIONS[lang]` exista: un valor corrupto en IndexedDB deja la
app en blanco con un `TypeError`.

```js
const table = TRANSLATIONS[lang] || TRANSLATIONS.es;
```

**Por qué** Corrige D3. Traducir 6 idiomas y luego arrancar siempre en castellano
es trabajo hecho y no entregado: la mayoría de usuarios nunca abren el selector.
La elección explícita del usuario sigue teniendo prioridad, porque `stored` se
mira primero.

**Verificación** En un navegador con `navigator.language = 'en-US'` y sin dato
guardado, la app arranca en inglés. Tras elegir castellano a mano y recargar,
sigue en castellano.

---

#### T5 · Claves nuevas y sustitución de los 34 avisos (D2, D4)

**Ficheros:** `app.js` (`TRANSLATIONS` ~1591-1960 y los 34 puntos de `showStatus`)

**Qué hacer**

1. Inventariar los literales. Son 34 `showStatus`, 8 `updateProgress`, 9
   `confirm`/`alert` y 4 `textContent`. Agruparlos por familia antes de nombrar
   claves, porque muchos se repiten:

   | Familia | Ejemplos | Claves propuestas |
   |---|---|---|
   | Favoritos | «Añadido a favoritos», «Eliminado de favoritos» | `fav_added`, `fav_removed` |
   | Biblioteca | «Esta canción ya está en la biblioteca» | `lib_duplicate` |
   | Descarga | «¡Descargado! {title}», «Error en la descarga» | `dl_done`, `dl_error` |
   | Lotes | «Completado con {n} error(es)» | `batch_partial` |
   | Cola | «Se reproducirá a continuación» | `queue_next` |
   | Playlists | «La playlist está vacía…», «Playlist "{name}" creada…» | `pl_empty`, `pl_created` |
   | Almacenamiento | «No hay espacio suficiente…», «Acceso a archivos denegado…» | `storage_full`, `storage_denied` |
   | Sincronización | «¡Sincronizado! Se añadieron {n} canciones nuevas.» | `sync_added` |
   | Formato | «MP3 tarda más porque hay que convertir el audio» | `format_mp3_notice` (de T2) |

2. Usar la interpolación que `i18n.t` **ya soporta** (app.js ~2039:
   `text.replace('{k}', v)`), en vez de concatenar:

   ```js
   showStatus(i18n.t('sync_added', { count: newCount }), 'success');
   ```

3. Añadir las claves a los seis idiomas. Para fr/de/pt/zh, marcar las que no se
   puedan traducir con confianza y dejarlas **en inglés, no en castellano**: un
   respaldo en inglés es legible para más gente.

4. Sustituir los dos ternarios de D4 (`'Salir'`/`'Logout'`, `'Perfil'`/`'Profile'`)
   por `i18n.t('logout')` e `i18n.t('profile')`.

**Por qué** Corrige D2 y D4. Es el grueso del punto 20 y es trabajo mecánico:
lo único que exige criterio es el agrupado en familias, que evita acabar con 34
claves de un solo uso.

**Verificación**

```bash
grep -cE "showStatus\((['\`])" app.js    # 0
```
Y una pasada manual en inglés: marcar un favorito, descargar una canción, crear
una playlist, intentar añadir un duplicado. Ningún texto en castellano.

---

#### T6 · Claves preparadas para los mensajes del servidor (D5)

**Ficheros:** `app.js` (`TRANSLATIONS`), `docs/planes/07-progreso-y-cache.md`

**Qué hacer**

1. Añadir a los seis idiomas las claves que corresponden a los mensajes que hoy
   genera el servidor, con sus parámetros:

   | Código | Texto en castellano hoy | Origen |
   |---|---|---|
   | `srv_starting` | «Iniciando descarga...» | server.py:1055 |
   | `srv_downloading_n_of_m` | «Descargando... {current} de {total} canciones» | server.py:846 |
   | `srv_downloading_pct` | «Descargando: {percent} ({speed}) - ETA: {eta}» | server.py:889-895 |
   | `srv_zipping` | «Creando archivo ZIP...» | server.py:641 |
   | `srv_complete_n` | «¡{count} canciones descargadas!» | server.py:951 |
   | `srv_batch_complete` | «¡Completado! {count} archivos descargados.» | server.py:651 |
   | `srv_cancelled` | «Descarga cancelada» | server.py:547 |
   | `srv_error_none` | «No se pudo descargar ninguna canción» | server.py:953 |
   | `srv_converting` | *(nuevo con T1)* «Convirtiendo a MP3...» | el paso de ffmpeg |

2. Añadir al cliente el respaldo, listo para cuando 07 empiece a mandar `code`:

   ```js
   function progressText(data) {
       return data.code ? i18n.t(`srv_${data.code}`, data.params || {}) : data.message;
   }
   ```
   y usarlo en los tres `updateProgress(…, data.message)` y en
   `queueManager.update(...)`.

3. Anotar en el plan 07 que el servidor debe emitir esos códigos exactos.

**Por qué** Deja el cliente preparado sin bloquear a nadie: mientras el servidor
siga mandando solo `message`, el respaldo pinta lo de siempre y no hay regresión.
Cuando 07 añada `code`, la traducción aparece sola.

**Verificación** Con el servidor actual (sin `code`), la barra de progreso se
comporta exactamente igual que antes. Simular una respuesta con `code` desde
DevTools y comprobar que se traduce.

---

### Bloque C — Verificación automática

---

#### T7 · Tests de formato e i18n

**Ficheros:** `test/backend/test_download_helpers.py`,
`test/frontend/test_i18n.mjs` (nuevo)

**Qué hacer**

1. **Formato de audio (T1-T3).** Ampliar los tests de
   `build_ytdlp_download_cmd`, que hoy dan por sentado que el formato siempre
   es m4a:

   | Comprobación |
   |---|
   | Cada formato admitido produce su `--audio-format` correspondiente |
   | Un formato no admitido cae al valor por defecto, no se pasa sin validar al comando |
   | La extensión del fichero resultante coincide con el formato pedido |
   | El camino nativo (`saveToNativeCapacitor`) usa la misma extensión que el servidor (D6) |

   El segundo es de seguridad además de corrección: el formato viene del
   cliente y acaba en una línea de comandos.

2. **i18n (T4-T6).** Fichero nuevo `test/frontend/test_i18n.mjs`, usando el
   arnés existente:

   | Comprobación |
   |---|
   | Los 6 idiomas tienen **exactamente el mismo conjunto de claves** |
   | Ninguna traducción está vacía |
   | `t()` con una clave inexistente no devuelve `undefined` en la interfaz |
   | La detección de idioma del navegador cae al castellano ante un idioma no soportado |
   | **No quedan avisos con castellano incrustado**: `grep` de `showStatus\('[A-ZÁÉÍÓÚÑ¡]` sobre `app.js` da 0 |

   La primera es la que más valor tiene a largo plazo: añadir una clave y
   olvidarse de cinco idiomas es el fallo típico, y en la interfaz se ve como un
   hueco en blanco.

**Por qué** El objetivo del plan es que la app cumpla lo que promete. El test de
paridad de claves convierte "creo que están todas traducidas" en un hecho
comprobable, y el `grep` del punto 2 impide que la deuda vuelva a crecer en
cuanto alguien añada un `showStatus` con prisa.

**Verificación** `node --test test/frontend/` y `pytest test/backend/` en verde.

---

## 5. Orden de ejecución y commits

```
T1 → T2 → T3        (formato: servidor, interfaz, camino nativo)
T4 → T5 → T6        (i18n: detección, textos, preparación para 07)
T7                  (tests; el de paridad de claves, junto con T5)
```

T1 **antes** que T2: si la interfaz manda `format` y el servidor todavía no lo
entiende, no pasa nada (lo ignora), pero al revés tampoco aporta. Hacerlo en este
orden permite probar el backend con `curl` antes de tocar la interfaz.

T3 es obligatoria **antes de mergear**, no después: sin ella, la opción mp3
funciona en el navegador y produce ficheros mal nombrados en la APK, que es el
entorno principal.

Los dos bloques se tocan en un solo punto: T2 borra 18 claves `quality_*` y T5
añade unas 40. Conviene hacer el bloque A entero primero.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Cinco transcodificaciones a mp3 saturan la CPU del VPS** | **Media** | Semáforo `MAX_TRANSCODES = 2` en T1, independiente del pool de descargas |
| Un mp3 se guarda con extensión `.m4a` en la APK | **Alta sin T3** | T3 deriva la extensión de `Content-Disposition`; es obligatoria antes de mergear |
| `--embed-thumbnail` no escribe carátula en mp3 | Media | Verificación explícita con `ffprobe` en T1; si falla, `--embed-thumbnail --convert-thumbnails jpg` |
| Los mp3 huérfanos se acumulan en el móvil | Media | T3 punto 2 amplía el recolector de basura |
| Una APK vieja sigue mandando `quality` y el backend falla | Baja | T1 punto 5: el campo se acepta y se descarta |
| Unificar los dos comandos de yt-dlp pierde una bandera intencionada | **Media** | T1 punto 2 avisa de las tres diferencias reales; comparar los comandos generados antes y después |
| Traducciones automáticas de mala calidad en fr/de/pt/zh | Media | Respaldo en inglés para lo dudoso, no en castellano |
| Se escapa algún literal en un camino poco transitado | Media | El `grep` de T5 es el criterio de cierre, no la inspección visual |
| T6 rompe la barra de progreso | Baja | El respaldo a `data.message` mantiene el comportamiento actual byte a byte |

---

## 7. Definición de hecho

- [ ] `POST /api/start-download` con `format: "mp3"` produce un MP3 y con `"m4a"` un M4A (verificado con `ffprobe`).
- [ ] Un `format` no permitido devuelve 400.
- [ ] Los dos formatos conservan carátula, título y artista.
- [ ] `grep -rn "qualitySelect\|audio_quality\|quality_normal" app.js index.html server.py` → sin resultados.
- [ ] Solo hay **un** constructor de comandos de yt-dlp en `server.py`.
- [ ] El formato elegido se recuerda entre sesiones.
- [ ] En la APK, una descarga en mp3 produce un fichero `.mp3` en `Documentos/YTMusic`.
- [ ] El recolector de basura nativo borra huérfanos `.m4a` **y** `.mp3`.
- [ ] Una APK vieja que manda `quality` sigue descargando.
- [ ] `grep -cE "showStatus\((['\`])" app.js` → 0.
- [ ] Los seis idiomas tienen el mismo número de claves (comprobado con un script).
- [ ] En un navegador en inglés sin preferencia guardada, la app arranca en inglés.
- [ ] No queda ningún `currentLang === 'es' ? … : …`.
- [ ] Las claves `srv_*` existen en los seis idiomas y el respaldo a `data.message` funciona.
- [ ] `node --check app.js` y `python3 -m py_compile server.py` pasan.
- [ ] `node --test test/frontend/` en verde, con los 6 idiomas al mismo conjunto de claves y 0 avisos con castellano incrustado.


---

## 8. Registro de ejecución (2026-09-21)

**T1 a T7 implementados.** 34 tests nuevos (23 de backend sobre el formato,
26 en el nuevo `test/frontend/test_i18n.mjs`).

### Verificado con descargas reales

El plan insistía en comprobar que el mp3 conserva la carátula en vez de darlo
por hecho. Se descargó el mismo vídeo en los dos formatos en el VPS y se
verificó con `ffprobe`: códec correcto en ambos (`aac` y `mp3`), **carátula
embebida** (stream `png`) y título y artista intactos. El mp3 pesa 5,8 MB frente
a 4,0 MB del m4a, lo esperable de una recodificación V2.

### Resumen por tarea

| Tarea | Qué quedó |
|---|---|
| T1 | Lista blanca `{m4a, mp3}`, **constructor único** de comandos de yt-dlp y semáforo de transcodificación |
| T2 | Selector de formato en la interfaz, con la elección recordada entre sesiones |
| T3 | Extensión derivada de lo que el servidor devuelve, no de lo que se pidió |
| T4 | Detección del idioma del navegador, con la elección del usuario por delante |
| T5 | **47 claves × 6 idiomas**; los 34 avisos en castellano sustituidos |
| T6 | Respaldo `resolveProgressText()` listo para los códigos del plan 07 |
| T7 | 34 tests |

### Notas de la implementación

**Unificar los dos constructores de comandos era el cambio de fondo de T1.**
Había dos listas de argumentos casi idénticas, y fue esa duplicación la que
dejó `audio_quality` sin conectar en la ruta de lote. Las diferencias que sí
eran intencionadas se conservan mediante el parámetro `batch_item`.

**El semáforo de transcodificación importa más de lo que parece.** mp3
re-codifica con ffmpeg y el servidor tiene 2 núcleos: sin techo, una playlist de
50 canciones lanzaría 5 conversiones en paralelo. Con `MAX_TRANSCODES = 2`, m4a
sigue bajando 5 a la vez —solo remuxea— y mp3 convierte de dos en dos.

**Una colisión de nombres propia.** Llamé `progressText` a la función nueva de
T6, sin ver que ya existía una constante con ese nombre: el elemento del DOM de
la barra de progreso. La verificación de sintaxis lo detectó al instante.
Renombrada a `resolveProgressText`.

**`extractVideoId` no necesitaba cambios**, al contrario de lo que suponía T3
punto 3: su expresión regular corta en el identificador y nunca llega a la
extensión.

**`setLanguage` podía dejar la aplicación en blanco.** Hacía
`TRANSLATIONS[lang][key]` sin comprobar que la tabla existiera, así que un valor
corrupto en IndexedDB provocaba un `TypeError` que mataba el arranque.

### Pendiente

Probar el formato mp3 en la APK: el camino nativo está implementado y cubierto
por tests, pero la comprobación real —que en `Documentos/YTMusic` aparezca un
`.mp3` de verdad— necesita el entorno de compilación de Android.
