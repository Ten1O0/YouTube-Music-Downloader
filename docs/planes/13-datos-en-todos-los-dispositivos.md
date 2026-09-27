# 13 — Tus datos en todos tus dispositivos

**Estado:** hecho · desplegado · **Prioridad:** 🟡 Medio · **Depende de:** 10 (T1, escapar HTML), 11 (el modelo de canción con artista, canción y escuchas)
**Propuestas que cubre:** 9 (biblioteca y listas sincronizadas) y 10 (copia de seguridad y restauración).

> Hoy, lo único que viaja con tu cuenta son los favoritos y el historial de
> descargas. La biblioteca, las listas, lo que editaste y lo que escuchaste
> viven solo en el dispositivo donde pasó, y se pierden si se borran los datos
> de la app. Este plan hace que la cuenta lo guarde todo, y permite sacarlo a
> un fichero para llevarlo a otro sitio sin cuenta.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | La biblioteca no viaja | `ytdl_library` solo en `StorageModule` | En el ordenador no aparece lo descargado en el móvil |
| D2 | Las listas no viajan | `ytdl_playlists` | Una lista hecha en el móvil no existe en la web |
| D3 | Lo editado y lo escuchado no viaja | `artist`/`track`/`editado` y `ytdl_escuchas` (plan 11) | Cada dispositivo tiene sus títulos y sus contadores |
| D4 | Sin copia de seguridad | — | Borrar los datos de la app, cambiar de móvil o limpiar el navegador lo pierde todo; la APK solo guarda una copia interna de la biblioteca y las listas (`*_backup_v1.json` en `DATA`) que se pierde con la app |
| D5 | Sin forma de pasar datos sin cuenta | — | Quien no usa Google no tiene manera de llevarse su música de un dispositivo a otro |

---

## 2. Decisiones de diseño

### 2.1 Qué viaja y qué no

| Viaja | No viaja |
|---|---|
| La biblioteca como **lista de canciones** (metadatos) | **El audio**: son megas por canción y en otro dispositivo se vuelve a descargar |
| Listas propias con su orden, nombre y descripción | Canciones sin `videoId` (importadas del móvil): el otro dispositivo no puede conseguir su audio |
| Artista, canción y extra editados (plan 11) | Miniaturas en `data:`: se rehacen a partir del `videoId` (`i.ytimg.com/vi/<id>/mqdefault.jpg`) |
| Registro de escuchas (plan 11), que alimenta el plan 17 | La cola, lo que suena, la posición |
| Ajustes de reproducción (plan 12) e idioma | La elección de tema o de vista (cosas de cada pantalla) |

**Identidad de una canción entre dispositivos:** el `videoId`. El `src` es
distinto en cada sitio (`idb://…` en la web, una ruta de fichero en la APK) y
por eso no sirve.

### 2.2 Una canción que está en la cuenta pero no en este dispositivo

Aparece en la biblioteca **con un icono de nube** y un poco atenuada. Al tocarla
se descarga (con `downloadFromUrl`, como siempre) y empieza a sonar al terminar.
Arriba de la biblioteca, si hay alguna, «Descargar las que faltan (N)» las
descarga en lote respetando los límites del servidor.

Nada se descarga solo: en un móvil con datos, bajar 300 canciones por sorpresa
sería un problema.

### 2.3 El protocolo: cambios con número de secuencia

| Alternativa | Veredicto |
|---|---|
| Enviar y recibir la biblioteca entera cada vez | ❌ Cientos de KB en cada arranque, y quien envía último pisa al otro |
| «Última escritura gana» con la hora del dispositivo | ❌ Los relojes de los móviles no son de fiar |
| **Registro de cambios con número de secuencia del servidor** | ✅ **Elegida** |

- Cada usuario tiene un contador `sync_seq` en el servidor. Cada cambio aceptado
  lo incrementa y guarda el número en la fila que cambió.
- El cliente guarda el último número que conoce (`sync_cursor`) y pide
  «lo que ha cambiado desde N». La primera vez, N = 0: todo.
- Los cambios locales se apuntan en una cola (`sync_pendiente`) y se envían
  cuando hay red y sesión, **igual que los favoritos del plan 01**, que ya
  funciona así. Se reutiliza su forma.
- **Conflictos:** gana el último que **llega al servidor**, registro a registro.
  Una lista es un registro entero (nombre, descripción y orden de canciones):
  si se reordena la misma lista en dos móviles sin conexión, se queda uno de
  los dos órdenes. Para un solo usuario con varios dispositivos es aceptable;
  queda documentado.
- **Borrados con lápida:** borrar no elimina la fila, la marca `deleted = 1`
  con su número de secuencia, para que los demás dispositivos se enteren. Las
  lápidas de más de 90 días se purgan.

### 2.4 La primera sincronización de un dispositivo

Mismo criterio que los favoritos: la primera vez que un dispositivo con datos
propios inicia sesión, **se suman** a la cuenta (sin borrar nada de ninguno de
los dos lados). Después, la cuenta manda. Bandera `sync_primera_v1` por cuenta.

### 2.5 Borrar en un dispositivo borra en los demás, con red de seguridad

Si en el móvil quitas una canción de la biblioteca, desaparece también del
ordenador, y **su audio local se libera allí también**: si no, la biblioteca
crecería sin control. Dos protecciones:

1. Si una sincronización fuera a borrar **más de 10 canciones** de golpe, se
   pregunta antes de aplicarla.
2. **«Eliminadas recientemente»** en Ajustes: las lápidas de los últimos 30 días
   se pueden restaurar (vuelven como canciones en la nube).

### 2.6 La copia de seguridad: un JSON legible

```json
{
  "formato": "music-downloader",
  "version": 1,
  "creada": "2026-10-02T18:30:00Z",
  "app": "1.4.0",
  "biblioteca": [ { "videoId": "…", "title": "…", "channel": "…", "artist": "…", "track": "…", "extra": "…", "editado": true, "addedAt": "…", "duration": 213 } ],
  "listas": [ { "id": "…", "name": "…", "description": "…", "songs": ["videoId", …], "createdAt": "…" } ],
  "favoritos": [ "videoId", … ],
  "escuchas": [ { "videoId": "…", "t": 1727890000, "s": 184 } ],
  "ajustes": { "idioma": "es", "reproduccion": { … } }
}
```

- **Sin audio**, por tamaño. Al restaurar, las canciones llegan «en la nube» (§2.2).
- **Exportar:** en la web, se descarga el fichero (el `entregarFichero` que ya
  existe). En la APK, se guarda en `Documentos/YTMusic/copias/` con
  `Filesystem`, y se avisa de dónde está.
- **Importar:** selector de fichero (`<input type="file" accept=".json,application/json">`,
  que funciona también en la WebView de Capacitor). Antes de aplicar, un
  resumen: «312 canciones, 8 listas, 1.204 escuchas», y dos opciones:
  **Combinar** (por defecto: suma sin borrar) o **Sustituir** (con
  confirmación, pide escribir «sustituir»).
- Con sesión iniciada, lo importado se sube también a la cuenta, como cualquier
  otro cambio local.

---

## 3. Seguridad

Todo lo que llega de la sincronización o de un fichero de copia es **dato
externo**:

| Medida | Dónde |
|---|---|
| Validación estricta de cada campo, con los mismos límites en el servidor y en el cliente: `videoId` con `^[A-Za-z0-9_-]{11}$`, textos recortados (artista y canción ≤120, nombre de lista 1-40 como hoy, descripción ≤200), fechas ISO, números finitos | `backend/server.py` · `frontend/src/features/sync/validar.js` |
| Límites de tamaño: 10.000 canciones y 200 listas por cuenta, 1.000 canciones por lista, 500 cambios por petición, 2 MB por petición, 20 MB por fichero de copia | ídem, y `MAX_CONTENT_LENGTH = 2 MB` en Flask, que hoy no está fijado |
| Nada de lo recibido va a `innerHTML` sin `html\`…\`` (plan 10, T1) | todo el cliente |
| `JSON.parse` con una función que descarta las claves `__proto__`, `constructor` y `prototype` | `features/sync/validar.js` |
| Las miniaturas no se aceptan de fuera: se rehacen desde el `videoId` | cliente y servidor |
| Todas las rutas nuevas exigen sesión (`@auth_required`, como `/api/user/*`), y cada consulta filtra por `user_id` del token, nunca por uno del cuerpo | `backend/server.py` · `backend/database.py` |
| Límite de peticiones: 30 por minuto por usuario en sincronización | `flask-limiter` |
| La copia contiene tu historial de escucha: se avisa al exportar | texto del botón |

---

## 4. Alcance

**Dentro:** D1-D5.

**Fuera:**
- Sincronizar el audio entre dispositivos.
- Colaboración: listas compartidas con otras cuentas.
- Resolver conflictos campo a campo dentro de una lista (§2.3).
- Copias automáticas periódicas en la nube de Google Drive u otros servicios.

---

## 5. Tareas

### Bloque A — Servidor

#### T1 · Esquema

**Ficheros:** `backend/database.py`

```sql
ALTER TABLE users ADD COLUMN sync_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS library_items (
    user_id INTEGER NOT NULL, video_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', channel TEXT DEFAULT '',
    artist TEXT DEFAULT '', track TEXT DEFAULT '', extra TEXT DEFAULT '',
    editado INTEGER NOT NULL DEFAULT 0, duration INTEGER DEFAULT 0,
    added_at TEXT NOT NULL, seq INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    PRIMARY KEY (user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS playlists (
    user_id INTEGER NOT NULL, id TEXT NOT NULL,
    name TEXT NOT NULL, description TEXT DEFAULT '', songs TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, seq INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS listens (
    user_id INTEGER NOT NULL, device TEXT NOT NULL, local_id INTEGER NOT NULL,
    video_id TEXT NOT NULL, artist TEXT DEFAULT '', track TEXT DEFAULT '',
    t INTEGER NOT NULL, seconds INTEGER NOT NULL,
    PRIMARY KEY (user_id, device, local_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', seq INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_library_seq ON library_items(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_playlists_seq ON playlists(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_listens_t ON listens(user_id, t);
```

- **Migración:** `init_db` comprueba `PRAGMA table_info(users)` antes del
  `ALTER` (SQLite no tiene `ADD COLUMN IF NOT EXISTS`).
- `listens` con clave `(user_id, device, local_id)`: reenviar la misma escucha
  (un reintento) no la duplica.
- `listens` guarda artista y canción **copiados** en cada escucha: si la canción
  se borra de la biblioteca, el resumen del año (plan 17) sigue sabiendo qué era.
- **Copia de la base antes de desplegar**: `/var/lib/youtube-downloader/youtube_downloader.db`
  a `/root/copias/` con fecha.

#### T2 · Operaciones de base de datos

**Ficheros:** `backend/database.py`

- `aplicar_cambios(user_id, cambios)`: en **una transacción**, incrementa
  `sync_seq` una vez por cambio y hace `INSERT … ON CONFLICT DO UPDATE` con el
  nuevo `seq`. Devuelve el `seq` final.
- `cambios_desde(user_id, seq)`: filas de `library_items`, `playlists` y
  `user_settings` con `seq > N`, incluidas las lápidas.
- `registrar_escuchas(user_id, device, lista)`: `INSERT OR IGNORE`.
- `restaurar(user_id, video_ids)` y `eliminadas_recientes(user_id)`.
- `purgar_lapidas(dias=90)`, que se llama desde el barrido que ya existe (plan 03).

#### T3 · Rutas

**Ficheros:** `backend/server.py`

| Ruta | Qué hace |
|---|---|
| `GET /api/sync?desde=N` | `{ seq, biblioteca, listas, ajustes }` con lo cambiado desde N |
| `POST /api/sync` | Cuerpo `{ dispositivo, cambios: [ { tipo: 'cancion'\|'lista'\|'ajustes', accion: 'poner'\|'borrar', datos } ] }` → `{ seq }` |
| `POST /api/sync/escuchas` | `{ dispositivo, escuchas: [ { id, videoId, artista, cancion, t, s } ] }` → `{ ok }` |
| `GET /api/sync/eliminadas` | Lápidas de los últimos 30 días |
| `POST /api/sync/restaurar` | `{ videoIds }` |

Las cinco con `@auth_required`, validación de §3 y `30 per minute`.

### Bloque B — Cliente

#### T4 · Validación y fusión, sin DOM

**Ficheros:** `frontend/src/features/sync/validar.js` (nuevo), `frontend/src/features/sync/fusion.js` (nuevo)

- `validarCancion`, `validarLista`, `validarCopia`: devuelven el objeto limpio o
  `null`. Mismos límites que el servidor (un único módulo de constantes, `features/sync/limites.js`).
- `aplicarRemotos(local, remotos)`: fusiona lo que llega del servidor en la
  biblioteca y las listas locales, conservando `src` y `localPath` de lo que ya
  está descargado aquí y creando entradas «en la nube» (`nube: true`, sin `src`)
  para lo nuevo.
- `fusionarCopia(local, copia, modo)`: «combinar» y «sustituir» (§2.6).

Son funciones puras: todo el comportamiento difícil se prueba sin navegador.

#### T5 · La cola y el ciclo de sincronización

**Ficheros:** `frontend/src/features/sync/sync.js` (nuevo), `features/library/library.js`,
`features/playlists/store.js`, `features/player/listens.js` (plan 11), `features/auth.js`, `main.js`

1. `sync.js`: `apuntar(cambio)`, `sincronizar()`, `dispositivo()` (un UUID en
   `sync_dispositivo`, creado una vez).
2. Enganches: añadir y quitar canción, editarla, guardar y borrar lista, y cada
   escucha nueva, llaman a `apuntar`.
3. Cuándo se sincroniza: al arrancar con sesión (después de `auth.init()`),
   al volver la red (`online`), al volver la app al primer plano
   (`visibilitychange`) y 3 s después del último cambio local (agrupado).
4. Al recibir: `aplicarRemotos`, guardar, repintar biblioteca y listas, y
   borrar el audio local de las canciones con lápida (§2.5, con la pregunta si
   son más de 10).
5. Primera sincronización con suma (§2.4).

**Cosas que no hacer**
- No sincronizar sin sesión ni con la sesión caducada: los cambios se quedan en
  la cola hasta que haya una sesión válida, **asociados a esa cuenta** (como los
  favoritos: si cambia de cuenta, no se suben a la otra).
- No enviar la biblioteca entera tras cada cambio.

#### T6 · Canciones en la nube

**Ficheros:** `features/library/library.js` (`renderLibraryItem`, `render`), `styles.css`, traducciones

1. Fila atenuada con icono de nube; tocarla descarga y reproduce.
2. Botón «Descargar las que faltan (N)» con la descarga en lote que ya existe.
3. El reproductor salta las canciones en la nube al avanzar la cola, si no hay red.

#### T7 · Ajustes: copia de seguridad y eliminadas recientemente

**Ficheros:** `frontend/src/features/sync/backup.js` (nuevo), `frontend/index.html`
(sección en la hoja de ajustes o una hoja «Tus datos»), traducciones

1. Exportar e importar (§2.6), con el resumen antes de aplicar.
2. Lista de eliminadas recientemente con «Restaurar» (solo con sesión).
3. Estado de la sincronización: «Sincronizado hace 2 min» o «Pendiente: 3 cambios».

### Bloque C — Tests

#### T8 · Tests del plan

| Qué | Dónde |
|---|---|
| Esquema y migración idempotente (dos `init_db` seguidos) | `test/backend/test_database.py` |
| `aplicar_cambios`: `seq` crece, `ON CONFLICT` actualiza, lápidas, una sola transacción (si un cambio es inválido no se aplica ninguno) | ídem |
| Aislamiento: un usuario nunca ve ni cambia lo de otro, aunque mande un `user_id` en el cuerpo | `test/backend/test_sync.py` (nuevo) |
| Rutas: sin sesión 401, validación 400 con cada campo inválido, límites de tamaño 413, límite de peticiones 429 | ídem |
| Escuchas repetidas no se duplican | ídem |
| `validarCopia` con ficheros hostiles: `__proto__`, tipos cambiados, 100.000 canciones, HTML en los títulos, `videoId` falsos | `test/frontend/test_copia.mjs` (nuevo) |
| `aplicarRemotos`: conserva `src` local, crea canciones en la nube, respeta lápidas | `test/frontend/test_sincronizacion_biblioteca.mjs` (nuevo) |
| `fusionarCopia`: combinar y sustituir; nombres de lista repetidos | ídem |
| E2E 33 · dos contextos de navegador con la misma cuenta (token firmado con el secreto de E2E): una lista y una canción creadas en uno aparecen en el otro, la canción en la nube; tocarla la descarga | `recorridos.spec.js` |
| E2E 34 · exportar, borrar los datos del navegador, importar: vuelven las listas y las canciones en la nube | ídem |
| E2E 35 · borrar 12 canciones en un contexto hace que el otro pregunte antes de aplicarlo | ídem |

Para los E2E con sesión: un ayudante `iniciarSesionDePrueba(page, email)` que
firma un JWT con `JWT_SECRET` de `playwright.config.js` y lo deja en
`localStorage`, sin pasar por Google.

---

## 6. Orden de ejecución, commits y despliegue

```
T1 → T2 → T3            servidor (con copia de la base)   → desplegar (sin cambios visibles)
T4 → T5 → T6            sincronización                    → desplegar + APK
T7                      copia de seguridad y papelera     → desplegar + APK
T8 con cada tarea
```

El servidor va primero y solo: las rutas nuevas no las usa nadie hasta que
llega el cliente, así que desplegarlas no tiene riesgo.

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Una sincronización borra canciones que el usuario quería | Media | Pregunta si son más de 10, papelera de 30 días, lápidas de 90 |
| La primera sincronización duplica canciones | Media | Identidad por `videoId` y suma en `aplicarRemotos`; E2E 33 |
| Dos dispositivos reordenan la misma lista sin red | Baja | Documentado: gana el último que llega (§2.3) |
| La base de datos crece con el registro de escuchas | Baja | ~40 bytes por escucha: 10 escuchas diarias son unos 150 KB al año por usuario |
| El `ALTER TABLE` falla en producción | Baja | Comprobación previa con `PRAGMA`, copia de la base y prueba con una copia real antes de desplegar |
| Un fichero de copia malicioso | Media | §3: validación, límites, sin `innerHTML`, sin miniaturas de fuera |
| Descargas masivas sin querer en otro dispositivo | Baja | Nada se descarga solo (§2.2) |

---

## 8. Definición de hecho

- [x] Biblioteca, listas, ediciones, escuchas y ajustes viajan con la cuenta.
- [x] Lo que no está descargado aquí se ve en la nube y se baja al tocarlo.
- [x] Borrar se propaga con pregunta a partir de 10 y papelera de 30 días.
- [x] Exportar e importar una copia en la web y en la APK, con resumen y dos modos.
- [x] Todas las validaciones de §3 con su test, en cliente y servidor.
- [x] Todas las suites en verde, incluidos los recorridos 34-36 (el 33 ya lo usaba el arreglo de favoritos): 633 backend, 669 frontend, 36 E2E.

---

## 9. Registro de ejecución (2026-09-27)

**T1 a T8 hechas.** Desplegado el 2026-09-27 con copia previa de la base
(`/root/copias/youtube_downloader-20260927-175421-pre-plan13.db`, `integrity_check`
ok) y del código. En producción, tras desplegar: la columna y las tablas nuevas,
los mismos usuarios, favoritos, historial y eventos que antes, `integrity_check`
ok, las cinco rutas con 401 sin sesión y 413 con un cuerpo de 3 MB. La migración se probó en el
servidor contra una copia de la base de producción (8 usuarios, 77 favoritos,
125 del historial: los mismos antes y después; `integrity_check` ok; la copia,
borrada al terminar).

| Tarea | Qué quedó |
|---|---|
| T1 | `library_items`, `playlists`, `listens`, `user_settings` y `users.sync_seq` (con `PRAGMA` antes del `ALTER`) |
| T2 | `aplicar_cambios` en una transacción `BEGIN IMMEDIATE` (todos o ninguno), `cambios_desde`, `registrar_escuchas`, `eliminadas_recientes`, `restaurar`, `purgar_lapidas` (desde el barrido, una vez al día); límites de 10.000 canciones y 200 listas |
| T3 | Las cinco rutas, con sesión, validación campo a campo y 30 peticiones por minuto **por cuenta**; `MAX_CONTENT_LENGTH` de 2 MB |
| T4 | `sync/limites.js`, `sync/validar.js` (`parseSeguro`, validadores), `sync/fusion.js` (`diferencias*`, `aplicarRemotos`, `fusionarCopia`) |
| T5 | `sync/diario.js` y `sync/sync.js`: la cola con dueño, las vueltas, la primera vez, la pregunta a partir de 10 borrados, las escuchas |
| T6 | `sync/nube.js`: filas en la nube, tocar descarga y reproduce, «Descargar las que faltan» |
| T7 | `sync/backup.js` y `sync/datos.js`: la hoja «Tus datos» con el estado, la copia (combinar y sustituir) y la papelera; `ui/confirm.js` |
| T8 | `test_sync.py` (60), `test_copia.mjs`, `test_sincronizacion_biblioteca.mjs`; recorridos 34-36; `test/e2e/sesion.js` |

### Decisiones tomadas por el camino

- **Los cambios se capturan comparando, no con un enganche por sitio.**
  `saveLibrary` y `savePlaylists` son los dos únicos puntos por donde pasa
  todo; comparan el antes y el después y apuntan la diferencia en el diario.
  Nada se escapa, y aplicar lo que llega de la cuenta es hacerlo «en silencio».
- **Las canciones en la nube llevan un `src` sintético** (`nube://<videoId>`):
  todo lo que identifica canciones por `src` (el editor, las filas, borrar)
  sigue funcionando sin cambios.
- **La cola automática siempre salta las canciones en la nube**, no solo sin
  red: si no, avanzar la cola las descargaría solas, y el plan dice que nada se
  descarga sin pedirlo.
- **«Conservarlas aquí»**, en la pregunta de los borrados, las devuelve a la
  cuenta: si no, la misma pregunta saldría en cada sincronización.
- **Ajustes:** la primera vez manda la cuenta; los de este dispositivo solo
  suben si la cuenta aún no tenía. Después, solo viajan cuando el usuario los
  cambia (no al cargarlos al arrancar).
- **Escuchas:** solo suben (las usará el plan 17); los contadores de las listas
  automáticas siguen siendo de cada dispositivo. La última se reenvía siempre,
  y el servidor se queda con los segundos mayores, porque la reproducción en
  curso puede seguir sumando.
- **Cambio de cuenta en un dispositivo compartido:** lo local no se sube a la
  otra cuenta; se empieza desde el principio de la nueva.
- **Canciones importadas del móvil (sin `videoId`)** no viajan, y no se pierden
  de una lista cuando llega su versión remota: se conservan al final.

### Encontrado por el camino

- **🔴 En la APK, borrar una canción descargada nunca liberaba su audio.**
  El fichero se borraba en `DATA` y las descargas están en `DOCUMENTS` (solo
  las importadas van a `DATA`). Con la sincronización, que borra en cascada, el
  problema se habría multiplicado. Corregido en `liberarAudio`.
- **La cabecera de la biblioteca se partía en dos líneas en el móvil** con el
  botón nuevo: corregida y medida a 360 y 390 px.
- **`MAX_CONTENT_LENGTH` no estaba fijado**: cualquier ruta aceptaba cuerpos de
  cualquier tamaño. Ahora, 2 MB para todas.

### Después del despliegue

- `init_db` tolera que otro proceso añada `sync_seq` a la vez (dos workers
  arrancando juntos). Producción usa uno solo, pero así no depende de ello; el
  test reproduce la carrera entre la comprobación y el `ALTER`.
- **APK 1.4.0 publicada** (versionCode 9, la misma firma que la 1.3.0), con los
  planes 11 a 13. El aviso de actualización junta ahora las novedades de todas
  las versiones que el usuario se ha saltado: `app-version.json` guarda el
  historial, el servidor devuelve además los campos de la última (lo que leen
  las APK ya instaladas) y el aviso las enseña por versión en una zona con
  scroll, con los botones siempre a la vista. Probada la actualización encima
  de la 1.3.0 en el emulador: conserva los datos.

### Versión 1.4.1 (2026-09-27): lo que se vio al usarlo de verdad

- **🔴 Las canciones del móvil no llegaban a la cuenta** (la del usuario tenía 8,
  las del ordenador, y el móvil 40 y pico). Una canción solo viaja con su id de
  YouTube, y las descargadas pegando un enlace o buscando antes de ese día se
  guardaron con el id de la descarga: la sincronización las saltaba sin avisar.
  `sync/identidad.js` les devuelve su id en cada vuelta: de la miniatura o el
  fichero, del historial de descargas (mismo título, su enlace), de la canción
  de la cuenta con el mismo título y, por último, del buscador en segundo plano
  (una cada 6 s, una vez por canción, solo con el título exacto). Lo reparado
  sube solo a la cuenta.
- **«Modo Turbio» salía en la nube estando descargada** (la misma causa: aquí
  sin id, en la cuenta con el suyo). `aplicarRemotos` reconoce ahora por título
  una descargada sin id; y descargar desde la nube una que ya está reproduce la
  de aquí, quita la entrada sobrante, avisa desde cualquier vista y libera el
  audio recién bajado, que antes se quedaba huérfano.
- **Artistas, la cuenta de la biblioteca y las listas automáticas** cuentan
  solo lo descargado en el dispositivo.
- **Sin lápiz de editar en las filas**: en el móvil se pulsaba sin querer. Se
  edita desde la pantalla completa.
- **🔴 La biblioteca se desplazaba de lado en la APK**: lo introdujo el arreglo
  anterior de la cabecera (`white-space: nowrap` con el botón que solo sale en
  la APK). La cuenta va ahora bajo el título y los botones son iconos iguales
  que no crecen; el recorrido 37 lo vigila a 360 px en los seis idiomas.
- Recorridos 37 y 38; `test_identidad.mjs`. APK 1.4.1 (versionCode 10) publicada.
