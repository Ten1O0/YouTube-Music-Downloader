# 01 — Integridad de datos en el cliente

**Estado:** implementado (pendiente de prueba manual T11) · **Prioridad:** 🔴 Crítico · **Depende de:** —
**Puntos del análisis:** 1, 2, 16, 23 (+ un hallazgo nuevo, ver D5)

---

## 1. Problema

La capa de persistencia del cliente tiene **dos fuentes de verdad conviviendo**
(`localStorage` e IndexedDB) y **no gestiona el ciclo de vida de los blobs de
audio**. De ahí salen cinco defectos que se refuerzan entre sí:

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | El `src` de las canciones descargadas en web es un `blob:` URL efímero | `downloadBlobAndSave`, app.js ~6301 | Toda canción descargada desde navegador deja de reproducirse al recargar |
| D2 | `saveFavorites()` escribe en `localStorage`, nadie lo lee | app.js ~3393 | Vía de pérdida/corrupción de favoritos vía `migrateStorage` |
| D3 | Capa legacy de favoritos duplicada sobre `FavoritesModule` | app.js ~3389-3423 | Dos caminos para lo mismo: es lo que permitió D2 |
| D4 | Los object URLs no se revocan | app.js ~6301 | Los blobs de audio quedan retenidos en memoria toda la sesión |
| D5 | **(nuevo)** `syncLocalData()` lee de `localStorage` tras la migración | app.js ~2147 | El sync al primer login envía siempre vacío y se marca como hecho |

### Por qué D2 es grave y no cosmético

`migrateStorage()` (app.js ~1086) se ejecuta en cada arranque y hace:

```js
const existing = await StorageModule.get(key);
if (!existing || (Array.isArray(existing) && existing.length < parsed.length)) {
    await StorageModule.set(key, parsed);   // ← sobrescribe IndexedDB
}
localStorage.removeItem(key);
```

`saveFavorites()` repuebla `localStorage['favorites']` con una copia obtenida de
IndexedDB. Si esa copia tiene **más** elementos que el estado actual de IndexedDB
—cosa que ocurre si el usuario borra favoritos después—, el siguiente arranque
**restaura los favoritos borrados** encima de los buenos. Es una condición de
carrera entre sesiones, no un error inmediato, y por eso pasa desapercibida.

### Por qué D5 apareció ahora

Mismo origen que D2: la migración a IndexedDB no se propagó a todos los lectores.
`AuthManager.syncLocalData()` sigue leyendo `localStorage.getItem(HISTORY_STORAGE_KEY)`
y `localStorage.getItem(FAVORITES_STORAGE_KEY)`, claves que `migrateStorage()` ya
ha borrado en el mismo arranque. Resultado: `localHistory` y `localFavorites` son
siempre `[]`, se entra por la rama «nothing to sync», se marca
`data_synced = 'true'` y **la biblioteca local previa del usuario no sube nunca a
la nube**. Al ser un flag persistente, el fallo no se reintenta jamás.

---

## 2. Restricción de diseño que condiciona todo el plan

**`song.src` es la clave primaria de facto de la aplicación.** Antes de tocarlo hay
que saber quién depende de él:

| Consumidor | Uso | Línea aprox. |
|---|---|---|
| `renderLibraryItem` | `data-src` en el DOM de cada ítem | 190, 204, 217 |
| `LibraryModule.removeSong(src)` | `lib.find(s => s.src === src)` | ~5380 |
| `LibraryModule.setPlaying(src)` | `el.dataset.src === src` | ~5425 |
| `PlayerModule` | `queue.findIndex(s => s.src === src)` | 4459, 4490, 4504, 4671-4673 |
| `renderQueuePanel` | `data-src` de cada ítem de la cola | 4800, 4815 |
| `removeSongFromPlaylist(plId, song.src)` | identidad dentro de la playlist | 586 |
| `isSongDuplicate` | `song.videoId \|\| song.src` como clave | 456 |

> ⚠️ **Por tanto: `src` debe seguir siendo un valor estable y persistible.**
> La tentación de «guardar el object URL bueno» es justo el error a evitar: un
> object URL es distinto en cada sesión, así que usarlo como `src` rompería la
> identidad de las canciones en playlists, cola y borrado.

### Decisión

Se replica el patrón que **el camino nativo ya hace bien**: persistir un
identificador estable y **resolver la URL reproducible en el momento de reproducir**.

- Nativo persiste `localPath` y resuelve con `Capacitor.convertFileSrc()`.
- Web persistirá `src = "idb://<songId>"` y resolverá con `URL.createObjectURL(blob)`
  a partir del blob guardado en IndexedDB.

Ambos caminos convergen en una única función `resolveStreamSrc(song)`.

### Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Guardar el blob como Data URL en el `src` | Un m4a de 5 MB se convierte en ~6,7 MB de string en IndexedDB, y se carga entero en memoria en cada render |
| Re-descargar del servidor al reproducir | Rompe el offline, que es la razón de ser de la biblioteca |
| Usar la File System Access API | Sin soporte en Firefox/Safari y requiere gesto del usuario por fichero |
| Cambiar la clave primaria a `videoId` | Refactor transversal de 7 consumidores; es trabajo del plan 08, no de una corrección crítica |

---

## 3. Alcance

**Dentro:** la capa de persistencia del cliente (`StorageModule`, `FavoritesModule`,
`LibraryModule`, `downloadBlobAndSave`, `resolveNativeStreamSrc`, `migrateStorage`,
`AuthManager.syncLocalData`).

**Fuera:**
- Partir `app.js` en módulos ES → plan 08.
- Tocar el esquema de la BD del servidor o los endpoints `/api/user/*` → plan 02/06.
- El camino nativo de Capacitor, que ya funciona: **solo se generaliza su resolver**, no se cambia su comportamiento.
- Los strings en castellano incrustados que aparezcan por el camino → plan 05.

---

## 4. Tareas

### Bloque A — Una sola fuente de verdad

---

#### T1 · Añadir `updateFavorite()` a `FavoritesModule` y eliminar `saveFavorites()`

**Ficheros:** `app.js` (`FavoritesModule` ~1110-1260; `saveFavorites` ~3393; `updateFavoriteItem` ~3402)

**Qué hacer**

1. Dentro de `FavoritesModule`, añadir junto a `toggleFavorite`:

   ```js
   async function updateFavorite(videoId, newData) {
       const favorites = await getFavorites();
       const idx = favorites.findIndex(item => (item.id || item.videoId) == videoId);
       if (idx === -1) return false;

       if (newData.title)     favorites[idx].title = newData.title;
       if (newData.thumbnail) favorites[idx].thumbnail = newData.thumbnail;

       await StorageModule.set(FAV_KEY, favorites);   // ← IndexedDB, nunca localStorage
       return true;
   }
   ```
   Exportarla en el `return` del módulo.

2. **Borrar por completo** `saveFavorites()` (app.js ~3393).

3. Reescribir `updateFavoriteItem()` para delegar:

   ```js
   async function updateFavoriteItem(videoId, newData) {
       const changed = await FavoritesModule.updateFavorite(videoId, newData);
       if (changed) await renderFavorites();
   }
   ```

**Por qué** Es la corrección puntual de D2. La escritura pasa a ir por el mismo
camino que el resto del módulo, así que deja de existir un estado en `localStorage`
que `migrateStorage` pueda resucitar.

**Verificación** `grep -n "localStorage.setItem(FAVORITES_STORAGE_KEY" app.js` no
devuelve nada. Marcar un favorito, descargarlo (dispara `updateFavoriteItem` desde
app.js ~2450) y comprobar en DevTools → Application → IndexedDB que el título y la
miniatura se actualizan.

---

#### T2 · Eliminar los envoltorios globales de favoritos

**Ficheros:** `app.js` (definiciones ~3389, 3416, 3420; llamadas en 2586, 2626, 2946, 2987, 3324, 3355, 3477, 3513, 3708)

**Qué hacer**

1. Borrar las tres funciones globales, que hoy son delegaciones puras de una línea:
   `getFavorites()`, `isFavorite(videoId)`, `toggleFavorite(video, btnElement)`.

2. Repuntar cada punto de llamada a `FavoritesModule.*`. Son 9 y todos son sustitución directa:

   | Línea aprox. | Contexto | Cambio |
   |---|---|---|
   | 2586 | `renderSearchResults` | `isFavorite(` → `FavoritesModule.isFavorite(` |
   | 2626 | botón ♥ de resultado de búsqueda | `toggleFavorite(` → `FavoritesModule.toggleFavorite(` |
   | 2946 | `renderPlaylistSelector` | ídem `isFavorite` |
   | 2987 | botón ♥ del selector de playlist | ídem `toggleFavorite` |
   | 3324 | render del historial | ídem `isFavorite` |
   | 3355 | botón ♥ del historial | ídem `toggleFavorite` |
   | 3477 | botón ♥ dentro de `renderFavorites` | ídem `toggleFavorite` |
   | 3513 | `updateFavSelectedCount` | `getFavorites()` → `FavoritesModule.getFavorites()` |
   | 3708 | descarga de favoritos seleccionados | ídem `getFavorites` |

3. **Conservar `renderFavorites()`**: no es un envoltorio, es el renderizador real de
   la vista legacy de favoritos y lo invocan `FavoritesModule.refreshAllUI` (~1256),
   `AuthManager` (2182, 2206, 2218) y el arranque (3916).

**Por qué** Corrige D3, que es la causa estructural de D2: mientras existan dos
caminos para escribir favoritos, alguien acabará usando el malo. Además elimina la
comprobación defensiva `typeof renderFavorites === 'function'` como patrón mental:
el módulo pasa a ser la única puerta.

**Verificación** `grep -nE "^(async )?function (getFavorites|isFavorite|toggleFavorite|saveFavorites)\(" app.js`
solo debe devolver las definiciones **internas** de `FavoritesModule` (~1122, 1131, 1157).
Prueba manual: marcar y desmarcar el ♥ desde los cinco sitios (búsqueda, historial,
biblioteca, playlist, reproductor) y comprobar que todos se sincronizan.

---

#### T3 · Arreglar el sync al primer login

**Ficheros:** `app.js` (`AuthManager.syncLocalData` ~2140-2186)

**Qué hacer**

1. Sustituir las dos lecturas de `localStorage` por lecturas a IndexedDB:

   ```js
   let localHistory   = await StorageModule.get(HISTORY_STORAGE_KEY)   || [];
   let localFavorites = await StorageModule.get(FAVORITES_STORAGE_KEY) || [];
   ```
   (eliminando los dos `try/catch` de `JSON.parse`, que dejan de hacer falta porque
   IndexedDB devuelve el objeto ya deserializado).

2. **No marcar `data_synced` si el sync no llegó a ocurrir.** Hoy la rama «nothing to
   sync» lo marca igualmente. Dejar que solo lo marque la respuesta `res.ok`, para
   que un fallo de red pueda reintentarse en el siguiente login.

3. Añadir un reintento para los usuarios ya afectados: si `data_synced === 'true'`
   pero hay datos locales que el servidor no tiene, permitir un sync manual. La forma
   barata es versionar el flag (`data_synced_v2`), de modo que todo el mundo reintente
   una vez con el código ya corregido.

**Por qué** Corrige D5. Sin el punto 3, los usuarios que ya arrastran
`data_synced = 'true'` nunca recuperarían su biblioteca en la nube, aunque el bug
quede arreglado para los nuevos.

**Verificación** Con biblioteca local y sesión cerrada, iniciar sesión y comprobar en
la pestaña Network que el `POST /api/user/sync` lleva `history` y `favorites`
poblados. Confirmar en la BD del servidor que las filas aparecen.

---

#### T4 · Endurecer `migrateStorage()`

**Ficheros:** `app.js` (`migrateStorage` ~1086)

**Qué hacer**

1. Añadir un flag de migración completada (`ytdl_migrated_v1`) en IndexedDB y salir
   temprano si está puesto. La migración es un evento único, no algo de cada arranque.

2. Mientras no esté el flag, cambiar la heurística de fusión: hoy compara longitudes
   (`existing.length < parsed.length`) y **sobrescribe el array entero**. Sustituirla
   por una fusión por clave que no pueda perder elementos:

   ```js
   const byKey = new Map();
   for (const item of existing) byKey.set(item.id || item.videoId || item.src, item);
   for (const item of parsed)   if (!byKey.has(item.id || item.videoId || item.src)) byKey.set(..., item);
   await StorageModule.set(key, [...byKey.values()]);
   ```

3. Borrar la clave de `localStorage` solo **después** de que el `set` haya resuelto
   sin error (hoy el `removeItem` está fuera del `if`, así que un fallo de escritura
   pierde el dato).

**Por qué** Es el mecanismo que convierte D2 y D5 de molestias en pérdida de datos.
Aunque T1 y T3 eliminan a los dos escritores culpables, la migración debe ser segura
por sí misma: es código que corre en cada arranque, sobre los datos de todo el mundo.

**Verificación** Test manual con las tres situaciones: (a) usuario nuevo sin
`localStorage`, (b) usuario con datos solo en `localStorage`, (c) usuario con datos
en ambos sitios y solapamiento parcial. En (c), el resultado debe ser la **unión**,
no el array más largo.

---

### Bloque B — Ciclo de vida del audio en web

---

#### T5 · Almacén de blobs en IndexedDB

**Ficheros:** `app.js` (`StorageModule` ~1024-1084)

**Qué hacer**

1. Subir `DB_VERSION` de `1` a `2` y crear un segundo object store en `onupgradeneeded`:

   ```js
   if (!db.objectStoreNames.contains('audio_blobs')) {
       db.createObjectStore('audio_blobs');
   }
   ```
   `onupgradeneeded` debe seguir creando `kv_store` si falta, para no romper a quien
   instale de cero.

2. Exponer tres funciones nuevas, parametrizando el store en los helpers actuales
   (que hoy tienen `STORE_NAME` fijo): `putBlob(id, blob)`, `getBlob(id)`, `deleteBlob(id)`.

3. Pedir almacenamiento persistente una sola vez al arrancar:

   ```js
   if (navigator.storage?.persist) await navigator.storage.persist();
   ```

4. Envolver `putBlob` para tratar `QuotaExceededError` de forma explícita y avisar al
   usuario con `showStatus`, en vez de fallar en silencio.

**Por qué** Los blobs de audio (3-8 MB cada uno) no deben ir al mismo store que las
claves de configuración: se leen con un patrón distinto (uno cada vez, bajo demanda)
y conviene poder borrarlos en bloque. Sin `persist()`, el navegador puede desalojar
la biblioteca entera bajo presión de disco, que es exactamente el fallo que estamos
corrigiendo.

**Verificación** DevTools → Application → IndexedDB: debe aparecer `YTMusicDB` en
versión 2 con los dos stores. Comprobar que un usuario existente con datos en
`kv_store` los conserva tras la subida de versión.

---

#### T6 · Caché de object URLs con revocación

**Ficheros:** `app.js` (nuevo helper, junto a las utilidades ~2371)

**Qué hacer**

1. Crear un módulo pequeño:

   ```js
   const AudioUrlCache = (() => {
       const urls = new Map();          // songId -> objectURL
       const MAX = 5;

       function put(songId, blob) {
           if (urls.has(songId)) return urls.get(songId);
           if (urls.size >= MAX) {
               const oldest = urls.keys().next().value;
               URL.revokeObjectURL(urls.get(oldest));
               urls.delete(oldest);
           }
           const url = URL.createObjectURL(blob);
           urls.set(songId, url);
           return url;
       }

       function drop(songId) { … }      // revoca y elimina una entrada
       function clear()      { … }      // revoca todas
       return { put, get: id => urls.get(id), drop, clear };
   })();
   ```

2. Llamar a `clear()` en `beforeunload`.

**Por qué** Corrige D4. Un object URL mantiene vivo su blob hasta que se revoca; sin
techo, reproducir 40 canciones en una sesión retiene ~200 MB. El límite de 5 permite
que la canción actual y sus vecinas inmediatas en la cola sigan resueltas, que es
todo lo que necesita el reproductor.

**Verificación** DevTools → Memory: reproducir 10 canciones seguidas y comprobar que
el heap retenido se estabiliza en vez de crecer monótonamente.

---

#### T7 · Unificar la resolución de audio: `resolveStreamSrc()`

**Ficheros:** `app.js` (`resolveNativeStreamSrc` ~386-405; `PlayerModule.play` ~4487)

**Qué hacer**

1. Renombrar `resolveNativeStreamSrc` → `resolveStreamSrc` y darle tres ramas
   explícitas, en este orden:

   ```js
   async function resolveStreamSrc(song) {
       // 1. Nativo con fichero local  → comportamiento actual, sin cambios
       if (IS_NATIVE && …Filesystem && song.localPath) { … }

       // 2. Web con blob persistido   → nuevo
       if (song.src?.startsWith('idb://')) {
           const songId = song.src.slice(6);
           const cached = AudioUrlCache.get(songId);
           if (cached) return cached;
           const blob = await StorageModule.getBlob(songId);
           if (blob) return AudioUrlCache.put(songId, blob);
           // blob desaparecido (desalojo del navegador) → fallback
           return song.videoId ? `${API_BASE}/api/stream/${song.videoId}` : null;
       }

       // 3. Cualquier otra cosa (URL http, legado) → tal cual
       return song.src;
   }
   ```

2. Actualizar la llamada en `PlayerModule.play` (~4508).

3. En `play()`, si `resolveStreamSrc` devuelve `null`, **no asignar `audio.src`**:
   mostrar un aviso al usuario. Hoy se asigna una URL muerta y el fallo se traga en
   el `.catch(e => console.warn(...))` de `audio.play()`, que es precisamente por lo
   que D1 pasó desapercibido tanto tiempo.

**Por qué** Deja un único punto donde se decide de dónde sale el audio, con el camino
nativo intacto. La rama 3 garantiza compatibilidad hacia atrás con las entradas
existentes.

**Verificación** Recorrer las tres ramas: canción nativa (APK), canción web nueva
(post-T8) y entrada legacy con `src` http. La cuarta situación —`idb://` cuyo blob
ya no está— se prueba borrando la entrada a mano desde DevTools.

---

#### T8 · Persistir el blob al descargar en web

**Ficheros:** `app.js` (`downloadBlobAndSave` ~6260-6324)

**Qué hacer**

1. En la rama no nativa (hoy app.js ~6300-6311), sustituir la lógica actual:

   ```js
   if (!audioSrc) {
       const songId = songMeta?.id || songMeta?.videoId || crypto.randomUUID();

       // a) guardar el blob para reproducción offline
       await StorageModule.putBlob(songId, blob);
       audioSrc = `idb://${songId}`;

       // b) entregar el fichero al usuario (comportamiento actual, sin cambios)
       const tempUrl = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = tempUrl; a.download = filename;
       document.body.appendChild(a); a.click(); a.remove();
       URL.revokeObjectURL(tempUrl);        // ← faltaba (D4)
   }
   ```

2. Añadir `songId` al objeto que se pasa a `LibraryModule.addSong` para que el borrado
   (T9) sepa qué blob eliminar.

**Por qué** Es la corrección de D1. Nótese que la descarga al disco del usuario y la
persistencia para la app pasan a ser **dos cosas distintas**: el `<a download>` usa
una URL temporal que se revoca al momento, y la reproducción usa el blob de IndexedDB.
Mezclar ambas era el error original.

**Verificación** En navegador: descargar una canción, **recargar la página (F5)** y
darle a reproducir. Es el caso exacto que hoy falla. Comprobar también que el fichero
sigue llegando a la carpeta de descargas del sistema.

---

#### T9 · Borrar el blob al borrar la canción

**Ficheros:** `app.js` (`LibraryModule.removeSong` ~5375)

**Qué hacer**

`removeSong` ya tiene una rama nativa que borra el fichero de Capacitor y una rama
`else` que avisa al servidor. Añadir la limpieza del blob:

```js
if (songToDel?.src?.startsWith('idb://')) {
    const songId = songToDel.src.slice(6);
    await StorageModule.deleteBlob(songId);
    AudioUrlCache.drop(songId);
}
```

Aplicar lo mismo en `cleanupNativeDuplicateSongFile` (~476) para el caso de duplicado
en web, que hoy solo contempla el camino nativo.

**Por qué** Sin esto, borrar una canción libera su fila de la biblioteca pero deja los
5 MB de audio en IndexedDB para siempre. En unos meses de uso el usuario se come la
cuota del navegador con audio de canciones que ya no existen — y al llenarse la cuota,
falla T5 y volvemos al punto de partida.

**Verificación** Descargar 3 canciones, anotar el uso de IndexedDB en DevTools →
Application → Storage, borrarlas y comprobar que el espacio se libera.

---

#### T10 · Migrar las entradas rotas que ya existen

**Ficheros:** `app.js` (nueva función, invocada desde el bootstrap ~6595)

**Qué hacer**

1. Añadir `repairLegacyBlobEntries()` que recorra la biblioteca y marque las entradas
   cuyo `src` empiece por `blob:`:

   ```js
   song.unavailable = true;
   song.unavailableReason = 'blob-expired';
   ```
   **No borrarlas**: conservan `videoId`, título, canal y miniatura, así que son
   re-descargables.

2. En `renderLibraryItem`, pintar esas entradas atenuadas con un botón «Volver a
   descargar» que llame a `downloadFromUrl(song.url, song)`.

3. Ejecutarla una sola vez, con su propio flag, desde el `DOMContentLoaded` principal.

**Por qué** El audio de esas entradas **es irrecuperable**: el blob nunca llegó a
guardarse en ningún sitio. Lo honesto es decírselo al usuario y ofrecerle la acción
que lo arregla, en lugar de dejar ítems que fallan en silencio al pulsarlos (que es
el comportamiento de hoy) o borrarle la biblioteca sin avisar.

**Verificación** Fabricar el estado a mano: inyectar en IndexedDB una entrada con
`src: "blob:http://localhost/abc-123"`, recargar y comprobar que aparece atenuada,
con su botón, y que la re-descarga la deja reproducible.

---

### Bloque C — Verificación

---

#### T11 · Guion de pruebas manuales

No hay tests automáticos todavía (eso es el plan 06), así que este plan se cierra con
una pasada manual reproducible. **Ejecutar en los dos entornos: navegador y APK.**

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Descargar canción en web → F5 → reproducir | Suena (hoy falla: D1) |
| 2 | Descargar canción en web | El fichero llega a la carpeta de descargas |
| 3 | Descargar canción en APK → reproducir | Suena desde el fichero local (sin regresión) |
| 4 | Marcar ♥ desde los 5 sitios | Todos los corazones se sincronizan |
| 5 | Marcar ♥, borrarlo, cerrar y reabrir | Sigue borrado (hoy puede resucitar: D2) |
| 6 | Con biblioteca local, iniciar sesión | El `POST /api/user/sync` lleva datos (hoy va vacío: D5) |
| 7 | Reproducir 10 canciones seguidas | La memoria retenida se estabiliza (D4) |
| 8 | Borrar una canción | Su blob desaparece de IndexedDB |
| 9 | Usuario con datos en `localStorage` e IndexedDB | Tras arrancar, el resultado es la unión |
| 10 | Entrada legacy con `src` `blob:` | Aparece atenuada y con botón de re-descarga |

---

## 5. Orden de ejecución y commits

El bloque A y el bloque B son independientes: A toca favoritos/sync, B toca
audio/biblioteca. Pueden ir en dos PRs o en uno solo con commits separados.

```
T4 → T1 → T2 → T3            (bloque A: migración segura primero, luego escritores)
T5 → T6 → T7 → T8 → T9 → T10 (bloque B: infraestructura, luego consumidores)
T11                          (cierre)
```

**T4 va antes que T1-T3** a propósito: mientras se toca el código de favoritos se
estará recargando la app muchas veces, y conviene que la migración ya sea segura
antes de exponerla a esas recargas con datos a medio migrar.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La subida de `DB_VERSION` a 2 corrompe datos existentes | Baja | `onupgradeneeded` solo crea stores, nunca borra; probar con una BD poblada antes de mergear |
| Regresión en el camino nativo al generalizar el resolver | **Media** | La rama nativa de `resolveStreamSrc` se copia literalmente, sin tocar; escenario 3 del guion es obligatorio |
| La cuota de IndexedDB se llena con bibliotecas grandes | Media | `persist()` + manejo explícito de `QuotaExceededError` (T5) + borrado de blobs huérfanos (T9) |
| Quedan puntos de llamada a las funciones borradas en T2 | Baja | Los 9 están inventariados; cerrar con un `grep` de verificación |
| Un usuario pierde favoritos durante el despliegue | Baja | T4 cambia sobrescritura por fusión: el peor caso pasa a ser un duplicado, no una pérdida |

---

## 7. Definición de hecho

- [ ] Los 10 escenarios de T11 pasan en navegador y en APK. ← **pendiente, requiere prueba manual**
- [x] `grep -n "localStorage.setItem(FAVORITES_STORAGE_KEY" app.js` → sin resultados.
- [x] No quedan funciones globales `getFavorites` / `isFavorite` / `toggleFavorite` / `saveFavorites`.
- [x] `grep -c "createObjectURL"` (3) y `grep -c "revokeObjectURL"` (5) cuadran: las 3 creaciones tienen revocación.
- [x] Ningún `src` nuevo escrito en la biblioteca empieza por `blob:`.
- [x] `node --check app.js` pasa; `python -m py_compile` pasa.
