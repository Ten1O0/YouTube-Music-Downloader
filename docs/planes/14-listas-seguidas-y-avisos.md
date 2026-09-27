# 14 — Listas que se siguen y avisos

**Estado:** pendiente · **Prioridad:** 🟡 Medio · **Depende de:** 10 (T1), 13 (cuenta con datos sincronizados)
**Propuestas que cubre:** 11 (seguir una lista de YouTube) y 16 (aviso al terminar las descargas largas).

> Dos caras de lo mismo: que la app haga cosas por su cuenta y te lo cuente.
> Seguir una lista de YouTube es pedirle que la vigile y traiga lo nuevo; los
> avisos son cómo se entera el usuario de que eso, o una descarga larga, ha
> terminado mientras hacía otra cosa.

### Decisión que tienes que tomar antes de empezar

| Opción | Qué consigue | Qué cuesta |
|---|---|---|
| **A · Solo avisos locales** (recomendada para empezar) | Aviso con la app en segundo plano. Si se cerró del todo, al volver a abrirla recoge lo terminado y avisa | Nada nuevo: el plugin `@capacitor/local-notifications` y el permiso `POST_NOTIFICATIONS` ya están en la APK |
| **B · Notificaciones push (Firebase)** | Aviso aunque la app esté cerrada del todo: «Tu lista tiene 3 canciones nuevas» | Un proyecto de Firebase, `google-services.json` en la APK, `@capacitor/push-notifications`, una cuenta de servicio de Google en el servidor y guardar el token de cada móvil. Google recibe esos tokens |

El plan está escrito para **A**, con el bloque E preparado para añadir **B**
después sin rehacer nada. La descarga en sí nunca ocurre con la app cerrada: lo
que hace el servidor es tenerla lista para cuando vuelvas.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | Una lista de YouTube se descarga una vez y ya | `features/youtube-playlist.js` | Si la lista crece (la de «novedades» de un artista, una lista de amigos), hay que volver a pegarla y elegir a mano lo nuevo |
| D2 | Una descarga larga no avisa al terminar | `features/download/queue.js` · `QueueManager` | Con 50 canciones en lote, el usuario sale de la app y no sabe cuándo acaba |
| D3 | 🔴 **(nuevo)** Cerrar la app a mitad de un lote pierde lo descargado | La cola vive en memoria (`QueueManager`, sin `StorageModule`); el servidor guarda lo terminado una hora (`DOWNLOAD_TTL_SECONDS = 3600`) | El servidor termina el trabajo, pero el cliente ya no sabe qué `download_id` tenía que recoger: se descarga para nada |

---

## 2. Decisiones de diseño

### 2.1 Seguir una lista: dónde se vigila

| Con sesión | Sin sesión |
|---|---|
| **El servidor** comprueba tus listas seguidas cada 6 horas y apunta las canciones nuevas | **El dispositivo** comprueba al abrir la app, como mucho una vez cada 6 horas por lista |
| Lo nuevo te espera en cualquiera de tus dispositivos | Solo en ese dispositivo |

En los dos casos, **la descarga la hace el dispositivo** cuando la app está
abierta, porque el audio acaba en el dispositivo.

### 2.2 Qué ocurre al seguir una lista

1. Pegas el enlace de una lista y eliges **«Seguir»** (junto a «Descargar
   seleccionadas», en el selector que ya existe).
2. Se crea una **lista propia vinculada**: se llama como la de YouTube, lleva
   un distintivo de YouTube y su origen (`origen: { tipo: 'youtube', lista: 'PL…' }`).
3. Las canciones que ya tienes se añaden a la lista; las que no, se descargan
   (o quedan en la nube si eliges no descargar ahora).
4. En adelante, cada canción nueva de la lista de YouTube:
   - se descarga sola si «Descargar automáticamente» está activado y hay Wi-Fi
     (en la APK, `navigator.connection.type === 'wifi'`; en la web, siempre), o
   - aparece «en la nube» en la lista vinculada para bajarla a mano.
5. **Lo que se borra de la lista de YouTube no se borra de la tuya.** Seguir es
   traer lo nuevo, no copiar la lista.

**Qué no se puede seguir:** las mezclas automáticas de YouTube (`list=RD…`), que
cambian en cada visita, y las listas privadas.

### 2.3 Descargas que sobreviven a cerrar la app (D3)

La cola de descargas se guarda: cada descarga en curso o terminada sin recoger
se apunta en `descargas_pendientes` (`{ downloadId, tipo, info, creada }`).

- Al abrir la app, para cada una: `GET /api/progress/<id>` y, si está
  completada, se recoge como si nunca te hubieras ido.
- Si el servidor ya no la tiene (más de una hora, o se reinició), se descarta y
  se avisa: «No se pudo recuperar la descarga de X».
- **Una hora es poco para una lista larga.** Se sube a **24 horas solo para lo
  completado y sin recoger** (`COMPLETED_TTL_SECONDS`), manteniendo la hora
  para lo que se quedó a medias. El barrido del plan 03 ya distingue estados.

### 2.4 Los avisos (opción A)

| Momento | Aviso | Condición |
|---|---|---|
| Termina una descarga de 5 o más canciones | «Listo: 23 canciones descargadas» | La app no está a la vista (`document.visibilityState === 'hidden'`) |
| Termina una descarga suelta | Ninguno | Sería ruido |
| Falla una descarga larga | «No se pudieron descargar 3 de 23» | Igual |
| Al abrir, se recogen descargas terminadas mientras estaba cerrada | Aviso dentro de la app (`ui/toast.js`), no del sistema | — |
| Una lista seguida trae canciones nuevas y se descargan solas | «Lista "X": 3 canciones nuevas» | La app no está a la vista |

- **Canal propio** «Descargas» en Android (`LocalNotifications.createChannel`),
  de importancia normal: sin sonido, para no competir con la música.
- **Tocar el aviso** abre la app en la biblioteca o en la lista (`actionTypeId`
  y `extra` con el destino).
- **Permiso:** el aviso de permisos (`features/permissions.js`) ya lo pide en
  Android 13+. Si se denegó, no se insiste: nada falla, solo no hay avisos.
- En la web no hay avisos del sistema: el permiso de notificaciones del
  navegador sin *service worker push* solo sirve con la pestaña abierta, y
  para eso ya están la isla y el banner.

> **Hay que comprobarlo primero (T1):** que el JavaScript de la WebView siga
> recibiendo el progreso con la app en segundo plano durante 10 minutos. Mientras
> suena música, el servicio en primer plano del reproductor mantiene el proceso
> vivo; sin música, Android puede congelarlo. Si pasa, el aviso llega al volver
> (§2.3), que es el mismo comportamiento que con la app cerrada.

---

## 3. Seguridad y límites

| Medida | Por qué |
|---|---|
| El `list=` se valida con `^[A-Za-z0-9_-]{10,64}$` y se rechazan los que empiezan por `RD` | Solo listas reales; nada de URLs arbitrarias hacia yt-dlp |
| Máximo 20 listas seguidas por cuenta y 500 canciones vigiladas por lista | La comprobación usa yt-dlp: sin tope, una cuenta podría ocupar el servidor |
| La comprobación del servidor: una lista a la vez, `timeout=60`, `nice`, y si una lista falla 5 veces seguidas se marca «no disponible» y deja de comprobarse | No machacar YouTube ni el VPS por una lista borrada |
| Rutas con `@auth_required` y filtro por `user_id` del token | Como el resto de la cuenta |
| Límite de 10 peticiones por minuto en seguir y dejar de seguir | — |
| Los títulos que llegan de YouTube van a la interfaz con `html\`…\`` (plan 10, T1) y a los avisos como texto plano | Un aviso del sistema no interpreta HTML, pero la lista vinculada sí se pinta en la app |
| Las descargas automáticas cuentan contra los mismos límites de `start-batch-download` (3 por minuto, 20 por hora) | Nadie puede usar «seguir» para saltarse los límites |

---

## 4. Alcance

**Dentro:** D1-D3, avisos de la opción A.

**Fuera:**
- Opción B (push), hasta que la decidas (bloque E, preparado).
- Descargar con la app cerrada.
- Seguir canales o artistas de YouTube (otra consulta, otro plan).
- Seguir listas de Spotify: es el plan 15, que reutilizará este mecanismo.

---

## 5. Tareas

### Bloque A — Comprobaciones y recuperación

#### T1 · Prueba en segundo plano

En el emulador y en tu vivo: lote de 20 canciones, salir de la app sin música y
esperar 10 minutos. ¿Llega el progreso? ¿Salta el aviso local? Anotar aquí el
resultado; decide si los avisos de §2.4 llegan en el momento o al volver.

#### T2 · Descargas que sobreviven (D3)

**Ficheros:** `features/download/queue.js`, `features/download/progress.js`,
`features/download/download.js`, `features/youtube-playlist.js`, `main.js`,
`backend/server.py` (`COMPLETED_TTL_SECONDS`, barrido)

1. `QueueManager` guarda y quita entradas de `descargas_pendientes` al empezar,
   al completarse y al recogerse.
2. `recogerPendientes()` en el arranque (tras `LibraryModule.render()`): §2.3.
3. Servidor: lo completado vive 24 h; lo demás, 1 h como hoy.

**Cosas que no hacer** No volver a lanzar en el servidor una descarga que se
perdió: si ya no está, se avisa y el usuario decide.

### Bloque B — Seguir listas

#### T3 · Servidor: listas seguidas

**Ficheros:** `backend/database.py`, `backend/server.py`, `backend/tareas.py` (nuevo),
`scripts/servidor/comprobar-listas.sh` (nuevo), `scripts/servidor/instalar-comprobar-listas.sh` (nuevo)

1. Tablas:
   ```sql
   CREATE TABLE IF NOT EXISTS followed_playlists (
       user_id INTEGER NOT NULL, list_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
       local_playlist_id TEXT NOT NULL, auto_download INTEGER NOT NULL DEFAULT 1,
       last_checked TEXT, failures INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       PRIMARY KEY (user_id, list_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   );
   CREATE TABLE IF NOT EXISTS followed_items (
       user_id INTEGER NOT NULL, list_id TEXT NOT NULL, video_id TEXT NOT NULL,
       title TEXT DEFAULT '', channel TEXT DEFAULT '', duration INTEGER DEFAULT 0,
       first_seen TEXT NOT NULL DEFAULT (datetime('now')), delivered INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (user_id, list_id, video_id)
   );
   ```
2. Rutas: `GET /api/follows` (listas y canciones nuevas no entregadas),
   `POST /api/follows` (seguir: valida, hace la primera lectura y guarda todo
   como ya visto), `DELETE /api/follows/<list_id>`, `POST /api/follows/entregadas`
   (el cliente confirma lo que ya tiene).
3. `backend/tareas.py comprobar_listas`: para cada lista disponible y con más de
   6 h desde la última comprobación, `build_playlist_cmd` + `parse_video_json_output`
   (ya existen), inserta lo nuevo con `INSERT OR IGNORE`. Se ejecuta **fuera de
   gunicorn**, con un temporizador de systemd cada hora (el mismo patrón que la
   actualización de yt-dlp), y un candado (`flock`) para no solaparse.
4. La primera lectura al seguir **no** cuenta como «nuevo»: lo que ya estaba se
   trata como ya visto y lo decide el paso 3 de §2.2.

#### T4 · Cliente: seguir, recibir y descargar

**Ficheros:** `frontend/src/features/follows.js` (nuevo), `features/youtube-playlist.js`
(botón «Seguir»), `features/playlists/playlists.js` (distintivo, «Dejar de seguir»,
«Buscar novedades ahora»), `main.js`, traducciones

1. Seguir (§2.2), con y sin sesión.
2. `comprobarNovedades()` al arrancar, al volver al primer plano y desde el botón
   «Buscar novedades ahora»: con sesión pregunta a `/api/follows`; sin sesión
   llama a `/api/playlist-info` de las listas locales que toque.
3. Lo nuevo entra en la lista vinculada (en la nube) y, si toca, se descarga con
   `start-batch-download`. Al terminar, `/api/follows/entregadas`.
4. En Ajustes: «Descargar automáticamente lo nuevo» y «Solo con Wi-Fi» (APK).

### Bloque C — Avisos

#### T5 · Avisos locales

**Ficheros:** `frontend/src/native/notifications.js` (nuevo, adaptador del plugin),
`features/download/queue.js`, `features/follows.js`, `main.js`, traducciones

1. `native/notifications.js`: `avisar({ titulo, texto, destino })`, que no hace
   nada fuera de la APK o sin permiso; crea el canal «Descargas» la primera vez;
   ids únicos para no pisar avisos.
2. Enganches de §2.4.
3. `LocalNotifications.addListener('localNotificationActionPerformed', …)` abre
   el destino con `NavigationModule`.

**Cosas que no hacer** No avisar con la app a la vista: para eso están la isla y
el banner.

### Bloque D — Tests

#### T6 · Tests del plan

| Qué | Dónde |
|---|---|
| Tablas y migración | `test/backend/test_database.py` |
| Rutas de seguimiento: sesión, validación de `list_id`, rechazo de `RD…`, tope de 20, aislamiento entre usuarios | `test/backend/test_follows.py` (nuevo) |
| `comprobar_listas`: con yt-dlp simulado, lo nuevo se apunta una vez; la primera lectura no cuenta; 5 fallos → no disponible | ídem |
| TTL de 24 h para lo completado y 1 h para el resto | `test/backend/test_download_registry.py` |
| `recogerPendientes`: completada → se recoge; desaparecida → se descarta y avisa; en curso → se sigue | `test/frontend/test_pendientes.mjs` (nuevo, arnés) |
| Qué avisos salen en cada caso de §2.4 (plugin simulado, visibilidad simulada) | `test/frontend/test_avisos_sistema.mjs` (nuevo) |
| E2E 36 · seguir una lista crea la lista vinculada; añadir una canción a la lista en el `fake_ytdlp` y «Buscar novedades» la trae | `recorridos.spec.js` |
| E2E 37 · recargar la página a mitad de un lote y, al volver, las canciones terminadas aparecen en la biblioteca | ídem |

Prueba manual (APK): seguir una lista real, cerrar la app, añadir un vídeo a esa
lista en YouTube, forzar la comprobación en el servidor y abrir la app.

### Bloque E — Push (solo si eliges la opción B)

#### T7 · Notificaciones push con Firebase

Queda descrito para no tener que rediseñar después:

1. Proyecto de Firebase, `google-services.json` en `mobile/android/app/` (fuera
   de git si se decide así) y `@capacitor/push-notifications`.
2. Tabla `push_tokens (user_id, device, token, updated_at)` y
   `POST /api/push/token`.
3. `backend/push.py`: API HTTP v1 de FCM con una cuenta de servicio (fichero en
   `/etc/youtube-downloader/`, `chmod 600`, fuera del directorio web).
4. `comprobar_listas` envía «Lista "X": N nuevas» a los dispositivos del usuario.
5. Tests con el cliente de FCM simulado.

---

## 6. Orden de ejecución, commits y despliegue

```
T1                      prueba en segundo plano → anotada aquí
T2                      descargas que sobreviven        → desplegar + APK (arregla D3 ya)
T3 → T4                 seguir listas                   → desplegar (servidor, con copia de la base) + APK
T5                      avisos                          → APK
T6 con cada tarea · T7 solo si se decide B
```

T2 arregla un fallo real y no depende de nada: puede ir antes que el resto del plan.

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| YouTube limita al servidor por comprobar muchas listas | Media | Cada 6 h, una a la vez, tope de 20 por cuenta, se deja de comprobar lo que falla |
| Las descargas automáticas gastan datos móviles | Media | «Solo con Wi-Fi» por defecto en la APK |
| Android congela la app en segundo plano y el aviso no sale | Media | T1; §2.3 recoge al volver igualmente |
| El usuario deniega el permiso de avisos | Segura en parte | Nada falla; en Ajustes se explica cómo activarlo |
| 24 h de ficheros completados llenan el disco del VPS | Baja | Se recogen casi siempre en minutos; el barrido sigue; aviso en el registro si `/tmp` pasa del 80 % |
| Una lista enorme al seguirla | Media | Tope de 500 canciones vigiladas; la primera descarga pregunta si son más de 50 |

---

## 8. Definición de hecho

- [ ] T1 hecha y anotada; decisión A o B tomada.
- [ ] Cerrar la app a mitad de un lote ya no pierde lo descargado.
- [ ] Se puede seguir una lista de YouTube, con y sin sesión, y lo nuevo llega solo o en la nube.
- [ ] Avisos locales en los momentos de §2.4, con canal propio y destino al tocarlos.
- [ ] Todas las suites en verde, incluidos los recorridos 36-37.
