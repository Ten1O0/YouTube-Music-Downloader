# 11 — Biblioteca inteligente

**Estado:** pendiente · **Prioridad:** 🟡 Medio (experiencia) · **Depende de:** 10 (T1, escapar HTML)
**Propuestas que cubre:** 6 (títulos limpios y editor) y 7 (vista por artistas y listas automáticas).

> La biblioteca guarda lo que YouTube llama a cada vídeo, no lo que es cada
> canción: «Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)»
> con el canal «RickAstleyVEVO». Este plan separa artista y canción, deja
> corregirlos a mano, cuenta lo que se escucha y usa las dos cosas para ordenar
> la música por artistas y en listas que se hacen solas.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | El título es el del vídeo | `download/download.js` · `libEntry.title = finalProgressData.title \|\| videoInfo.title` | Ruido en cada fila: «(Official Video)», «[Lyrics]», «4K Remaster», «HD»; y el artista repetido en el título |
| D2 | El «artista» es el canal | `libEntry.channel` | «RickAstleyVEVO», «Luis Fonsi - Topic», «Warner Music Spain»: el canal no es el artista |
| D3 | No se puede corregir nada | — | Un título mal puesto se queda así para siempre |
| D4 | Nada cuenta lo que se escucha | `PlayerModule.play` | Sin «más escuchadas» ni «sin escuchar», y sin datos para el plan 17 |
| D5 | Una sola forma de ver la biblioteca | `#libraryList` | Con cien canciones, encontrar las de un artista es desplazarse |
| D6 | El servidor tira metadatos que ya tiene | `prefetch_video_metadata` · usa `title` e `id` del `--dump-json` y descarta `artist`, `track`, `album`, `channel`, `duration` | YouTube Music trae artista y canción separados para muchas canciones oficiales |

---

## 2. Decisiones de diseño

### 2.1 Tres fuentes, en este orden

1. **Lo que el usuario escribió** (`editado: true`): nunca se sobrescribe.
2. **Lo que YouTube sabe** (`artist`/`track` de yt-dlp, presentes en canales
   oficiales y en «- Topic»): fiable cuando existe.
3. **Lo que se deduce del título** con `limpiarTitulo`: para todo lo demás.

### 2.2 `limpiarTitulo(titulo, canal)`: reglas, no magia

Función pura en `core/titles.js`. Devuelve `{ artista, cancion, extra }`.

1. **Quitar ruido** entre paréntesis o corchetes, sin distinguir mayúsculas:
   `Official (Music|Lyric)? Video`, `Official Audio`, `Video Oficial`,
   `Audio Oficial`, `Videoclip`, `Lyrics?`, `Letra`, `Visualizer`, `HD`, `HQ`,
   `4K`, `(\d{4} )?Remaster(ed)?`, `MV`, `M/V`, `Clip Officiel`,
   `Offizielles Video`, `官方`… La lista, en una constante con tests.
2. **Conservar lo que importa**: `feat.`/`ft.`/`with` (se normaliza a
   `feat.`), `Live`/`En directo`, `Acoustic`, `Remix`, `Cover`, `Versión …`.
   Van a `extra` y se muestran pequeños tras la canción.
3. **Separar** por el primer ` - `, ` – `, ` — ` o ` | ` rodeado de espacios:
   izquierda artista, derecha canción.
4. **Sin separador**: la canción es el título limpio y el artista, el canal limpio.
5. **Limpiar el canal**: quitar `VEVO` final, ` - Topic`, `Official`, `Oficial`,
   `Music`, `Records` solo si queda algo después.
6. **Si algo sale vacío**, se vuelve al valor original: la función nunca pierde información.

Se acepta que falle en casos raros: para eso está el editor.

### 2.3 El modelo de datos: añadir, no sustituir

```js
{
  // Lo de siempre, intacto: src, localPath, videoId, thumbnail, addedAt…
  title,             // se conserva el título original de YouTube
  channel,           // se conserva el canal original
  artist,            // NUEVO · lo que se muestra como artista
  track,             // NUEVO · lo que se muestra como canción
  extra,             // NUEVO · «feat. X», «Live»… (opcional)
  editado,           // NUEVO · true si el usuario lo cambió a mano
}
```

- La interfaz muestra `track ?? title` y `artist ?? channel`. Así, lo que no
  esté migrado sigue viéndose como hoy.
- **Las copias:** una canción vive también dentro de cada lista (`pl.songs[]`) y
  en favoritos. Se actualizan por `src`, que es su identidad (plan 01).

### 2.4 Contar escuchas: 30 segundos o la mitad

Una reproducción cuenta cuando se han **escuchado** (no saltado) 30 s, o la mitad
de la canción si dura menos de un minuto. Es el criterio de Spotify y evita
contar lo que se salta al instante.

- Se mide con `timeupdate` sumando solo avances pequeños (<2 s entre eventos):
  arrastrar la barra no suma.
- Una vez por reproducción: volver a empezar la misma canción cuenta otra vez;
  pausar y seguir, no.

**Dónde se guarda** (el orden importa para el plan 17):

| Clave | Contenido | Para qué |
|---|---|---|
| `ytdl_escuchas` | `{ [clave]: { n, ultima, segundos } }` | Contadores rápidos para las listas automáticas |
| IndexedDB `escuchas` (almacén nuevo) | Registro `{ clave, artista, cancion, t, segundos }` por escucha | «Tu año en música» (plan 17) |

La clave es `videoId || src`. **El registro empieza aquí aunque el plan 17
llegue más tarde**: cuanto antes, más historia tendrá tu resumen del año.

### 2.5 La vista por artistas

- En la Biblioteca, un selector segmentado: **Canciones · Artistas**. Recuerda
  la última elección.
- Artistas agrupados por el **artista principal** (antes de `feat.`), sin
  distinguir mayúsculas ni tildes («Beyoncé» = «Beyonce»), en orden alfabético
  con `Intl.Collator` del idioma de la app.
- Cada artista: carátula de su canción más escuchada, número de canciones.
- Su detalle es una vista nueva, `#artistDetailView`, con «Reproducir» y
  «Aleatorio», integrada en la navegación y el botón atrás (`NavigationModule`).

### 2.6 Listas automáticas

En Listas, junto a Favoritos, tres tarjetas que se calculan al abrirlas:

| Lista | Regla |
|---|---|
| Más escuchadas | Las 25 con más escuchas, mínimo 2 |
| Añadidas recientemente | Las de los últimos 30 días, máximo 50, las más nuevas primero |
| Sin escuchar | Las que tienen 0 escuchas |

- **Solo lectura**: sin editar, borrar ni reordenar (no tienen un orden propio que guardar).
- Id con prefijo `auto:` (`auto:top`, `auto:recent`, `auto:unplayed`), para que
  `PlaylistModule` las distinga igual que distingue `favorites`.
- Una lista automática vacía no se muestra.

---

## 3. Alcance

**Dentro:** D1-D6.

**Fuera:**
- Etiquetas ID3 del fichero: se edita lo que ve la app, no el fichero (evita
  reescribir audio y el acceso de escritura en Android 11+).
- Álbumes: YouTube casi nunca los trae y deducirlos no es fiable.
- Buscar metadatos en servicios externos (MusicBrainz): otra dependencia y otra
  fuente de fallos, para un beneficio pequeño.
- Sincronizar los cambios entre dispositivos: es el plan 13, que los recoge.

---

## 4. Tareas

### Bloque A — Datos

#### T1 · El servidor devuelve artista y canción

**Ficheros:** `backend/server.py` (`prefetch_video_metadata`, `parse_video_json_output`, `/api/search`)

1. En `prefetch_video_metadata`, añadir al progreso: `artist` (de `artists[0]`,
   `artist` o `creator`), `track`, `channel` (o `uploader`) y `duration`.
2. En la búsqueda y en `playlist-info` (formato plano), `artist` y `track` casi
   nunca vienen: se añaden si están y se ignoran si no.
3. Nombres de campo en inglés, como el resto de la API.

**Cosas que no hacer** No añadir una segunda llamada a yt-dlp solo para esto: se
aprovecha el `--dump-json` que ya se hace.

**Verificación** `pytest`: con un JSON de yt-dlp de ejemplo con y sin `artist`,
el progreso lleva los campos o no los lleva, sin romper.

#### T2 · `limpiarTitulo`

**Ficheros:** `frontend/src/core/titles.js` (nuevo)

Implementar §2.2. Exportar también `normalizarArtista(a)` (minúsculas, sin
tildes, sin `feat.`), que usan la vista por artistas y el plan 17.

**Verificación** Tabla de al menos 50 casos reales en el test (§T9), incluidos
títulos en los seis idiomas de la app.

#### T3 · Rellenar artista y canción al guardar y migrar lo que ya hay

**Ficheros:** `features/download/download.js` (`libEntry`), `features/library/importer.js`,
`features/library/recovery.js`, `core/storage.js` (migración), `features/favorites/panel.js` (descarga de favoritos)

1. Función `completarMetadatos(song, datosServidor)` en `core/titles.js`: aplica §2.1.
2. Llamarla en los cuatro sitios que crean canciones: descarga suelta, lote de
   favoritos, importación y recuperación nativa.
3. **Migración** con bandera `ytdl_titles_v1`, en `migrateStorage()`: rellena
   `artist`/`track` en la biblioteca, en cada `pl.songs` y en favoritos, sin
   tocar las que tengan `editado`. Idempotente.

**Cosas que tener en cuenta** La biblioteca puede tener cientos de canciones:
la migración se hace en memoria y se guarda **una vez** por clave, no una por canción.

### Bloque B — Editor

#### T4 · Editar artista y canción

**Ficheros:** `frontend/src/features/library/editor.js` (nuevo), `frontend/index.html`
(`#editSongSheet`), `features/library/library.js` (acción en la fila), `features/player/full-player.js`
(acción en el reproductor), traducciones

1. Hoja con dos campos (Artista, Canción), el título original de YouTube debajo
   en pequeño como referencia, y «Restaurar» para volver a lo automático.
2. Se abre desde un botón «Editar» en el menú de la fila (y pulsación larga en
   el móvil) y desde el reproductor a pantalla completa.
3. Al guardar: marca `editado: true`, actualiza biblioteca, copias en listas y
   favoritos (T3 punto 3), y si es la canción que suena, la barra, la pantalla
   completa y la sesión del sistema (`updateMediaSession`).
4. Límites: 1-120 caracteres, recortar espacios; vacío = no se guarda.

**Seguridad** Lo escrito se muestra con `html\`…\`` (plan 10, T1): un «artista»
con HTML se ve como texto. Test incluido.

### Bloque C — Escuchas

#### T5 · Contar escuchas y empezar el registro

**Ficheros:** `frontend/src/features/player/listens.js` (nuevo), `features/player/player.js`,
`core/storage.js` (almacén `escuchas` en IndexedDB, subir la versión de la base)

1. `listens.js`: `crearContador({ audio, alContar })` que aplica §2.4 y llama a
   `alContar(song, segundos)` una vez por reproducción.
2. `alContar` actualiza `ytdl_escuchas` y añade una entrada al almacén `escuchas`.
3. `core/storage.js`: subir `DB_VERSION` de 2 a 3 y crear el almacén `escuchas`
   (`autoIncrement`, índice por `t`) en `onupgradeneeded`, sin tocar los que hay.
   Añadir `request.onblocked` (aviso para cerrar otras pestañas) y
   `db.onversionchange = () => db.close()`, que hoy no existen.

**Cosas que no hacer** No guardar la biblioteca entera en cada escucha (es lo que
pasaría si el contador viviera dentro de cada canción): por eso va en su clave.

### Bloque D — Vistas

#### T6 · Vista por artistas

**Ficheros:** `frontend/src/features/library/artists.js` (nuevo), `frontend/index.html`
(selector y `#artistDetailView`), `ui/navigation.js` (vista nueva), `features/library/library.js`, `styles.css`, traducciones

1. Selector segmentado Canciones/Artistas; la elección se guarda en `ytdl_library_view`.
2. `agruparPorArtista(biblioteca, escuchas)` pura (se prueba sin DOM).
3. Detalle con cabecera (carátula, nombre, «n canciones»), «Reproducir», «Aleatorio» y las filas de siempre (`renderLibraryItem`).

#### T7 · Listas automáticas

**Ficheros:** `frontend/src/features/playlists/auto.js` (nuevo), `features/playlists/playlists.js`
(`renderGrid`, `openPlaylistDetail`), traducciones

1. `listasAutomaticas(biblioteca, escuchas, ahora)` pura: devuelve las tres de §2.6.
2. `renderGrid` las pinta tras Favoritos; `openPlaylistDetail('auto:…')` las abre
   sin los botones de editar, borrar y reordenar.

### Bloque E — Tests

#### T8 · Recorridos y simulador

- `test/e2e/fake_ytdlp`: que devuelva `artist`/`track` para uno de sus vídeos y
  títulos con ruido para otro («Artista - Canción (Official Video) [HD]»).

#### T9 · Tests del plan

| Qué | Dónde |
|---|---|
| `limpiarTitulo`: ≥50 casos reales, idempotencia (limpiar dos veces = una), nunca devuelve vacío | `test/frontend/test_titulos.mjs` (nuevo) |
| `normalizarArtista` y `agruparPorArtista` | ídem |
| `completarMetadatos`: prioridad editado > YouTube > deducido | ídem |
| Migración `ytdl_titles_v1`: rellena biblioteca, listas y favoritos; respeta `editado`; segunda ejecución no cambia nada | `test_plan01_datos.mjs` o nuevo, con el arnés |
| Contador: 29 s no cuenta, 30 s sí; canción de 40 s cuenta a los 20; arrastrar no suma; una vez por reproducción | `test/frontend/test_escuchas.mjs` (nuevo) |
| `listasAutomaticas`: umbrales, orden, vacías no aparecen | `test/frontend/test_listas_auto.mjs` (nuevo) |
| Backend: campos nuevos con y sin `artist` en el JSON | `test/backend/test_download_helpers.py` |
| E2E 26 · descargar muestra artista y canción limpios; editar los cambia y sobrevive a una recarga | `recorridos.spec.js` |
| E2E 27 · la vista Artistas agrupa y el detalle reproduce | `recorridos.spec.js` |
| E2E 28 · tras escuchar una canción (audio simulado de 1 s: cuenta a la mitad), aparece en «Más escuchadas» cuando llega a 2 | `recorridos.spec.js` |

---

## 5. Orden de ejecución, commits y despliegue

```
T1 → T2 → T3        datos y migración              → desplegar
T4                  editor                         → desplegar
T5                  escuchas (cuanto antes, por el plan 17)
T6 → T7             vistas                         → desplegar + APK
T8 → T9 con cada tarea
```

T5 puede adelantarse a T1 si se quiere empezar a acumular historia ya.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La limpieza estropea un título bueno | Media | Nunca se pierde el original (`title`), «Restaurar» en el editor, y la tabla de tests |
| La migración tarda con bibliotecas grandes | Baja | En memoria y un guardado por clave; se mide con 2.000 canciones simuladas |
| Subir la versión de IndexedDB (hoy `DB_VERSION = 2`) bloquea con otra pestaña abierta | Media | `StorageModule` no gestiona `onblocked` hoy: T5 lo añade (aviso que pide cerrar las otras pestañas) y `onversionchange` en la conexión abierta, que la cierra para no bloquear a la pestaña nueva |
| Las copias en listas quedan desfasadas | Media | Actualización por `src` en un solo sitio (T3) y test de la migración |
| El contador se equivoca con la reproducción en segundo plano de la APK | Media | `timeupdate` sigue llegando con la pantalla apagada; se prueba en el emulador con la pantalla bloqueada |

---

## 7. Definición de hecho

- [ ] Las canciones nuevas y las que ya estaban muestran artista y canción limpios.
- [ ] Se pueden editar y restaurar, y el cambio llega a listas, favoritos, reproductor y sistema.
- [ ] Las escuchas se cuentan con la regla de §2.4 y quedan registradas para el plan 17.
- [ ] Biblioteca por artistas con su detalle y el botón atrás.
- [ ] Tres listas automáticas en Listas.
- [ ] Todas las suites en verde, incluidos los recorridos 26-28.
