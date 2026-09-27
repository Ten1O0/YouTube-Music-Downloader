# 15 — Importar listas de otros servicios (Spotify)

**Estado:** pendiente · **Prioridad:** 🟢 Bajo · **Depende de:** 10 (T1), 11 (T2, `limpiarTitulo`), 14 (T2, descargas que sobreviven)
**Propuesta que cubre:** 12 (importar una playlist de Spotify).

> Traer una lista hecha en Spotify (o en Apple Music, Deezer, Tidal…) y
> convertirla en una lista de la app: buscar cada canción en YouTube, dejar que
> el usuario revise lo que no esté claro, descargar y crear la lista.

### Decisión que tienes que tomar antes de empezar

La parte técnica es sencilla. La delicada es **de dónde se leen las canciones de
la lista de Spotify**:

| Vía | Cómo | Riesgo |
|---|---|---|
| **A · Fichero exportado por el usuario** (recomendada) | El usuario exporta su lista a CSV con una herramienta como Exportify, TuneMyMusic o Soundiiz, y la sube a la app | **Ninguno para nosotros**: no usamos la API de Spotify ni sus condiciones nos aplican. Sirve para cualquier servicio que exporte CSV |
| **B · Texto pegado** | Una canción por línea, «Artista - Canción» | Ninguno. Útil para listas escritas a mano o copiadas de una web |
| **C · Enlace de Spotify con su API oficial** | Registrar una app en developer.spotify.com y leer la lista con *client credentials* | Las condiciones para desarrolladores de Spotify **prohíben facilitar la descarga** de contenido, y usar sus datos para descargar de otro sitio encaja mal con eso. Pueden revocar la app. Además, las apps nuevas nacen en «modo desarrollo», con acceso limitado, y la ampliación pasa por una revisión que difícilmente aprobarían para este uso |
| ~~D · Leer la página web de Spotify~~ | Extraer los datos del HTML de `open.spotify.com` | ❌ Descartada: incumple sus condiciones y se rompe con cualquier cambio de su web |

**Recomendación:** A y B en este plan. C queda descrita en el bloque E y solo
se hace si, tras leer las condiciones actuales de Spotify, decides asumirlo.

---

## 1. Problema

| id | Defecto | Efecto |
|----|---------|--------|
| D1 | No hay forma de traer una lista de otro servicio | Quien viene de Spotify tiene que buscar sus canciones una a una |
| D2 | Buscar a mano da resultados dudosos | La primera coincidencia de YouTube puede ser un directo, una versión o un karaoke |

---

## 2. Decisiones de diseño

### 2.1 El recorrido del usuario

```text
Importar lista ──► elegir fichero CSV o pegar texto ──► vista previa (N canciones)
      ──► buscar en YouTube (con progreso) ──► revisar coincidencias
      ──► «Crear lista y descargar N»
```

- **Revisar** es el paso importante: cada fila con la canción de origen, la
  coincidencia elegida (carátula, título, canal, duración) y su confianza:
  **segura**, **probable** o **dudosa**. Las dudosas salen primero y marcadas.
- En cada fila: «Cambiar» (muestra las otras 4 candidatas) y «Quitar».
- Nada se descarga hasta pulsar «Crear lista y descargar».

### 2.2 Leer el fichero

`features/import/parse.js`, funciones puras:

- **CSV** según RFC 4180: comillas, comas y saltos de línea dentro de campos,
  BOM UTF-8, y separador `;` si lo exportó Excel en castellano (se detecta en la
  primera línea).
- Reconoce por nombre de columna, sin importar mayúsculas: título (`Track Name`,
  `Title`, `Name`, `Canción`), artista (`Artist Name(s)`, `Artist`, `Artista`),
  duración (`Duration (ms)`, `Duration`), ISRC (`ISRC`) y álbum. Así valen
  Exportify, TuneMyMusic, Soundiiz y exportaciones de Apple Music.
- **Texto:** una canción por línea; separa por ` - `, ` – ` o ` — `; ignora líneas vacías y numeración inicial («1. », «01) »).
- Varios artistas separados por `;` o `,` → el primero es el principal.

### 2.3 Buscar cada canción en YouTube

En el servidor, porque es quien tiene yt-dlp:

- Consulta: `ytsearch5:<artista principal> - <título>` (lista de argumentos, sin shell).
- **Si hay ISRC**, se intenta antes `ytsearch3:"<ISRC>"`: YouTube Music indexa
  el ISRC de los temas oficiales («- Topic») y suele dar el exacto.
- Se devuelven las 5 candidatas con título, canal, duración y miniatura.

**Puntuación** (en el cliente, función pura `puntuar(origen, candidata)`, 0-100):

| Señal | Peso |
|---|---|
| Título parecido tras `limpiarTitulo` (plan 11) y normalizar (similitud de Jaro-Winkler) | 40 |
| El artista aparece en el canal o en el título | 25 |
| Duración: ±3 s → 20; ±10 s → 12; ±20 s → 5; más → 0 | 20 |
| Canal oficial («- Topic», «VEVO», verificado si yt-dlp lo indica) | 10 |
| Coincidencia por ISRC | +30 (tope 100) |
| «live», «cover», «karaoke», «remix», «8D», «sped up», «slowed» que **no** estén en el origen | −30 cada una |

Segura ≥ 80 · probable 60-79 · dudosa < 60.

### 2.4 El trabajo en el servidor: un encargo con progreso

Buscar 300 canciones son 300 llamadas a yt-dlp (1-2 s cada una). Se hace como
las descargas: un encargo con id, que avanza en segundo plano y se sigue con el
progreso por SSE que ya existe (`/api/progress/stream/<id>`).

- `POST /api/import/match` con `{ canciones: [...] }` → `{ id, total }`.
- Hasta 3 búsquedas en paralelo por encargo, y como mucho 2 encargos a la vez en
  todo el servidor.
- El resultado se recoge con `GET /api/import/match/<id>` y se borra a la hora.

### 2.5 Crear la lista y descargar

- Se crea la lista propia con el nombre del fichero (editable en la revisión) y
  se descargan las elegidas con `start-batch-download`, en tandas de 100
  (`MAX_BATCH_VIDEOS`) respetando sus límites.
- Las que ya estén en la biblioteca (mismo `videoId`) no se descargan otra vez:
  solo se añaden a la lista.
- Las descargas sobreviven a cerrar la app (plan 14, T2).

---

## 3. Seguridad y límites

| Medida | Por qué |
|---|---|
| Fichero de 2 MB como máximo y 500 canciones por importación | Cada canción es una búsqueda en el servidor |
| Cada campo recortado (título y artista ≤200 caracteres) y sin caracteres de control | Lo que llega de un fichero es externo |
| La consulta a yt-dlp va siempre con prefijo `ytsearchN:` y como un argumento de una lista, nunca por shell | Un título que empiece por `--` no puede convertirse en una opción de yt-dlp |
| `POST /api/import/match`: 2 por hora por IP (y por usuario con sesión) | Es la ruta más cara de la app |
| Todo se pinta con `html\`…\`` (plan 10, T1) | Títulos de un fichero y de YouTube |
| El fichero no sale del dispositivo: se lee en el navegador y al servidor solo van título, artista, duración e ISRC | Privacidad |

---

## 4. Alcance

**Dentro:** vías A y B, búsqueda, revisión, creación y descarga.

**Fuera:**
- Vía C (bloque E), salvo que la decidas.
- Seguir una lista de Spotify: exigiría la vía C y el mecanismo del plan 14.
- Exportar listas de la app a CSV (sería trivial, pero no está pedido).

---

## 5. Tareas

### Bloque A — Leer

#### T1 · Analizadores de CSV y texto

**Ficheros:** `frontend/src/features/import/parse.js` (nuevo)

§2.2. `leerCsv(texto)` y `leerTexto(texto)` → `[{ titulo, artista, duracionMs, isrc, album }]`.

### Bloque B — Buscar y puntuar

#### T2 · Encargo de búsqueda en el servidor

**Ficheros:** `backend/server.py`, `backend/importar.py` (nuevo, la lógica sin Flask)

1. `buscar_candidatas(cancion)`: ISRC si lo hay, después búsqueda normal, y
   `--dump-json --flat-playlist` para no pedir más de lo necesario.
2. Rutas de §2.4 con los límites de §3.
3. Reutiliza el registro de progreso y el barrido del plan 03.

#### T3 · Puntuación

**Ficheros:** `frontend/src/features/import/score.js` (nuevo, puro)

`puntuar(origen, candidata)` y `mejor(origen, candidatas)` de §2.3, con
`limpiarTitulo` y `normalizarArtista` del plan 11.

### Bloque C — Interfaz

#### T4 · Hoja «Importar lista» y revisión

**Ficheros:** `frontend/index.html` (`#importSheet`, `#importReviewView`),
`frontend/src/features/import/import.js` (nuevo), `features/playlists/playlists.js`
(botón «Importar» junto a «Nueva lista»), `styles.css`, traducciones

1. Pestañas «Fichero» (con un enlace a cómo exportar desde Spotify con Exportify)
   y «Texto».
2. Vista previa → búsqueda con progreso (la isla o el banner del plan 09) → revisión (§2.1).
3. «Crear lista y descargar» (§2.5).

### Bloque D — Tests

#### T5 · Tests del plan

| Qué | Dónde |
|---|---|
| `leerCsv`: un CSV real de Exportify, uno de TuneMyMusic, uno de Excel con `;`, comillas y saltos de línea en campos, BOM, columnas en otro orden, filas incompletas | `test/frontend/test_importar.mjs` (nuevo) |
| `leerTexto`: separadores, numeración, líneas vacías | ídem |
| `puntuar`: tabla de casos (oficial contra directo, cover, remix pedido y no pedido, duración, ISRC) | ídem |
| Rutas: límites, validación, sin sesión funciona con el límite por IP, resultado caduca | `test/backend/test_importar.py` (nuevo) |
| Una consulta que empieza por `--` llega a yt-dlp como texto de búsqueda | ídem |
| E2E 38 · importar un CSV de 3 canciones con `fake_ytdlp` (una dudosa), cambiar la dudosa, crear la lista y ver las 3 descargadas en ella | `recorridos.spec.js` |

### Bloque E — Enlace de Spotify (solo si eliges la vía C)

#### T6 · Lectura con la API oficial

1. App en developer.spotify.com; `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`
   en el entorno del servicio (override de systemd, como `JWT_SECRET`), nunca
   en el repositorio ni en la APK.
2. `backend/spotify.py`: token de *client credentials* con caché hasta su
   caducidad y `GET /v1/playlists/{id}/tracks` paginado (campos: nombre,
   artistas, duración, ISRC).
3. `POST /api/import/spotify { url }`: valida `open.spotify.com/playlist/<id 22 caracteres>`
   y devuelve la misma estructura que `leerCsv`. A partir de ahí, el recorrido es idéntico.
4. Límites: 5 por hora por IP; listas de más de 500 canciones se cortan con aviso.

---

## 6. Orden de ejecución, commits y despliegue

```
T1 → T3                 lectura y puntuación (sin servidor)
T2                      búsqueda en el servidor            → desplegar
T4                      interfaz                           → desplegar + APK
T5 con cada tarea · T6 solo si se decide C
```

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Coincidencias equivocadas | Media | Puntuación con duración e ISRC, revisión obligatoria de las dudosas |
| Una importación grande ocupa el servidor | Media | 500 canciones, 3 en paralelo, 2 encargos a la vez, 2 por hora |
| Cambia el formato de las herramientas de exportación | Baja | Columnas reconocidas por nombre y con alias; test con ficheros reales |
| La vía C incumple las condiciones de Spotify | Alta si se hace | Fuera por defecto; decisión explícita |

---

## 8. Definición de hecho

- [ ] Decisión sobre la vía C tomada.
- [ ] Importar desde CSV (Exportify, TuneMyMusic, Excel) y desde texto.
- [ ] Revisión con confianza por canción, cambiar y quitar.
- [ ] La lista se crea y se descarga lo que falta, sin duplicar lo que ya está.
- [ ] Todas las suites en verde, incluido el recorrido 38.
