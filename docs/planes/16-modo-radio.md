# 16 — Modo radio

**Estado:** pendiente · **Prioridad:** 🟢 Bajo-medio · **Depende de:** 10 (T1), 12 (motor de reproducción), 14 (T2, descargas que sobreviven)
**Propuesta que cubre:** 4 (al acabar la cola, seguir con canciones parecidas).

> Cuando la cola se acaba, la música se para. Con la radio, sigue: canciones
> parecidas a lo último que sonó, sacadas de YouTube, que se pueden guardar en
> la biblioteca si gustan o descartar si no.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | La cola se acaba y todo para | `PlayerModule.next()` sin más canciones y sin repetir | Silencio; hay que volver a elegir |
| D2 | La app solo reproduce lo descargado | `resolveStreamSrc` (idb://, fichero local) | Para «seguir con algo parecido» hace falta sonar canciones que no están en la biblioteca, que es justo lo que la app no sabe hacer |

---

## 2. Decisiones de diseño

### 2.1 De dónde salen las parecidas: las mezclas de YouTube

YouTube genera para cada vídeo una mezcla (`watch?v=<id>&list=RD<id>`) con
25-50 canciones relacionadas. El servidor ya sabe leerlas: `build_playlist_cmd`
trata las listas `RD…` y las corta a 35 (`--playlist-end 35`). No hace falta
ningún servicio de recomendaciones.

**Filtrado** de las candidatas (función pura en el cliente):
- Fuera las que ya sonaron en esta sesión de radio y las vetadas.
- Fuera los duplicados por título normalizado (`limpiarTitulo` del plan 11): la
  misma canción en vídeo oficial, audio y letra.
- Fuera lo que dure más de 10 minutos (mezclas y recopilatorios) o menos de 60 s.
- **Si la candidata ya está en la biblioteca, se usa la copia local**: suena al
  instante y no gasta datos.

**Semilla:** la última canción de la cola. Cuando quedan 3 canciones de radio,
se pide otra mezcla sembrada **alternando** entre la semilla original y la última
canción que sonó entera, para que la radio no se aleje demasiado del punto de partida.

### 2.2 Cómo suena lo que no está descargado

| Alternativa | Veredicto |
|---|---|
| El servidor retransmite el audio mientras lo baja | ❌ El `m4a` de YouTube se remuxea al final; empezar a sonar a mitad de descarga es frágil, y cada escucha tendría al servidor ocupado de principio a fin |
| El navegador pide el audio directamente a YouTube | ❌ Las URLs de `googlevideo.com` van firmadas para la IP del servidor: desde el móvil dan 403 |
| **Descargar por el camino normal, a una caché temporal, con antelación** | ✅ **Elegida** |

- La siguiente canción de radio **se descarga mientras suena la actual**. Una
  canción dura unos 3 minutos y descargarla lleva 5-20 s: cuando toca, ya está.
- Se usa el mismo camino que una descarga normal (`/api/start-download`,
  progreso y `/api/download/<id>`), pero el audio va a una **caché de radio**, no
  a la biblioteca.
- **La primera** canción de radio también se precarga: se empieza a pedir cuando
  a la cola le queda una canción, no cuando termina.
- Por ser audio local, el motor del plan 12 (fundido, sin cortes, volumen
  igualado) funciona igual con la radio.

### 2.3 La caché de radio

| | Web | APK |
|---|---|---|
| Dónde | IndexedDB, almacén de blobs con prefijo `radio:` | `DATA/radio/` con `Filesystem` (privado de la app, no en Documentos) |
| Tope | 10 canciones o 150 MB | 10 canciones o 150 MB |
| Se borra | La más antigua al pasar el tope; todo al desactivar la radio | Igual |

**«Guardar en la biblioteca»** (botón + en la canción de radio): mueve el audio
de la caché a la biblioteca **sin volver a descargarlo** (en la web, re-etiqueta
el blob; en la APK, mueve el fichero a `Documentos/YTMusic/`).

### 2.4 Cómo se usa

- En la hoja de la cola, junto a aleatorio y repetir: un interruptor **Radio**
  («Al acabar, sigue con canciones parecidas»). Se recuerda.
- En el menú de una canción: **«Iniciar radio»** (la reproduce y la usa de semilla).
- Las canciones de radio aparecen en la hoja de la cola en su propia sección,
  «Radio», con dos acciones: **Guardar** y **No me gusta** (salta y la veta; no
  vuelve a salir). Vetadas: `radio_vetadas`, hasta 500.
- Con «Repetir todo» activo, la radio no entra: repetir manda.
- **Sin conexión**, la radio no puede traer nada nuevo: al acabar la cola avisa
  («La radio necesita conexión») y para.
- **Datos móviles:** ajuste «Radio solo con Wi-Fi» en la APK, activado por defecto.

---

## 3. Seguridad y límites

| Medida | Por qué |
|---|---|
| El `videoId` de la semilla se valida (`^[A-Za-z0-9_-]{11}$`) y la URL `RD` la construye el servidor | Nada del cliente llega tal cual a yt-dlp |
| `GET /api/radio`: 20 por minuto por IP; caché en el servidor de 30 min por semilla | Cada mezcla es una llamada a yt-dlp |
| Las descargas de la radio cuentan contra los límites normales (10 por minuto, 100 por hora) | Una sesión de radio son 15-20 canciones por hora: cabe de sobra, y nadie puede usar la radio para saltarse los límites |
| Títulos con `html\`…\`` (plan 10, T1) | Vienen de YouTube |
| La caché de la APK en `DATA` (privada), no en Documentos | Que otras apps no vean ni reproduzcan lo que no se guardó |

---

## 4. Alcance

**Dentro:** D1-D2.

**Fuera:**
- Retransmitir en directo desde el servidor (§2.2).
- Emisoras temáticas («radio de rock»): exigiría búsquedas por género, otro diseño.
- Aprender de los gustos del usuario más allá de los vetos.

---

## 5. Tareas

### Bloque A — Servidor

#### T1 · Candidatas de radio

**Ficheros:** `backend/server.py`

1. `GET /api/radio?semilla=<videoId>`: construye `https://www.youtube.com/watch?v=<id>&list=RD<id>`,
   usa `build_playlist_cmd` y `parse_video_json_output`, y devuelve
   `{ candidatas: [ { id, title, channel, duration, thumbnail } ] }`.
2. Caché en memoria (`dict` con caducidad, tope de 200 semillas) para no
   repetir la llamada a yt-dlp.
3. Límites de §3.

### Bloque B — Cliente

#### T2 · Elegir las siguientes

**Ficheros:** `frontend/src/features/radio/pick.js` (nuevo, puro)

`elegir(candidatas, { sonadas, vetadas, biblioteca, n })` con el filtrado de
§2.1. Devuelve canciones listas para la cola: locales si están en la biblioteca,
`{ radio: true, videoId, … }` si no.

#### T3 · Descargar a la caché de radio

**Ficheros:** `features/download/download.js`, `features/download/save.js`,
`frontend/src/features/radio/cache.js` (nuevo), `core/storage.js`

1. `downloadFromUrl` y `saveDownloadToApp` aceptan un destino:
   `'biblioteca'` (como hoy) o `'radio'`. Con `'radio'`: sin historial, sin
   biblioteca, sin interfaz de descarga en la pantalla de inicio, y el audio a la caché.
2. `cache.js`: `guardar`, `resolver(videoId)` (URL reproducible), `mover a biblioteca`,
   `recortar()` al tope, `vaciar()`.

**Cosas que no hacer** No duplicar el camino de descarga para la radio: un
único `downloadFromUrl` con destino, o se repite la historia del plan 05
(dos constructores de comandos que se desincronizaron).

#### T4 · La radio en el reproductor

**Ficheros:** `frontend/src/features/radio/radio.js` (nuevo), `features/player/player.js`
(`next`, fin de cola), `features/player/queue-sheet.js` (sección e interruptor), traducciones

1. `radio.js`: estado (activa, semilla, sonadas, cola de radio), `alQuedarUna()`
   (pide mezcla y precarga), `siguiente()`, `guardar(cancion)`, `noMeGusta(cancion)`.
2. `player.js`: cuando a la cola le queda una, avisa a la radio; al acabar, si
   la radio está activa y hay una lista, sigue con ella.
3. Hoja de la cola: interruptor, sección «Radio» con Guardar / No me gusta.
4. Sesión del sistema: las canciones de radio se ven igual que las demás.

#### T5 · «Iniciar radio» y ajustes

**Ficheros:** menú de la fila (`features/library/library.js`), reproductor a
pantalla completa, hoja de ajustes de reproducción (plan 12), traducciones

«Iniciar radio» en el menú de una canción; «Radio solo con Wi-Fi» en Ajustes.

### Bloque C — Tests

#### T6 · Tests del plan

| Qué | Dónde |
|---|---|
| `/api/radio`: valida la semilla, construye la URL `RD`, caché, límite | `test/backend/test_radio.py` (nuevo, yt-dlp simulado) |
| `elegir`: sonadas, vetadas, duplicados por título, duraciones, preferencia por lo local | `test/frontend/test_radio.mjs` (nuevo) |
| Caché: tope por número y por tamaño, «guardar» mueve sin descargar, vaciar al desactivar | `test/frontend/test_cache_radio.mjs` (nuevo, arnés) |
| El camino de descarga con destino `'radio'` no toca biblioteca ni historial | `test_plan01_datos.mjs` o nuevo |
| E2E 39 · cola de una canción con radio activa: al acabar suena una canción de la mezcla simulada, aparece en la sección Radio y «Guardar» la lleva a la biblioteca | `recorridos.spec.js` + mezcla `RD` en `fake_ytdlp` |
| E2E 40 · «No me gusta» salta y la canción no vuelve | ídem |

---

## 6. Orden de ejecución, commits y despliegue

```
T1                  servidor                      → desplegar
T2 → T3             elegir y caché
T4 → T5             reproductor e interfaz        → desplegar + APK
T6 con cada tarea
```

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La siguiente no llega a tiempo y hay silencio | Media | Precarga desde que queda una; si aun así no está, el reproductor espera mostrando «Preparando la radio…» en vez de pararse |
| La radio se aleja del estilo original | Media | Semilla alternada (§2.1) |
| Gasta datos móviles sin que el usuario lo note | Media | «Solo con Wi-Fi» por defecto en la APK; la caché se vacía al apagarla |
| Carga del VPS con muchos oyentes | Baja (hoy) | Mismos límites que las descargas; la caché de mezclas evita repetir llamadas |
| YouTube cambia las mezclas `RD` | Baja | Si `/api/radio` falla, la radio avisa y para; nada más se rompe |

---

## 8. Definición de hecho

- [ ] Con la radio activa, la música sigue al acabar la cola, sin silencios.
- [ ] Guardar y vetar desde la cola; iniciar radio desde una canción.
- [ ] La caché respeta su tope y no ensucia la biblioteca.
- [ ] Todas las suites en verde, incluidos los recorridos 39-40.
