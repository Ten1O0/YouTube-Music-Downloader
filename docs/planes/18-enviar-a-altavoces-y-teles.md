# 18 — Enviar a altavoces y teles

**Estado:** pendiente · **Prioridad:** 🟢 Bajo · **Depende de:** 10 (T1), 12 (motor de reproducción)
**Propuesta que cubre:** 5 (Chromecast y reproducción remota).

> Pulsar un botón y que la música suene en la tele, en un Nest o en cualquier
> altavoz con Chromecast, con los controles en el móvil. Es el plan más incierto
> de la serie: por eso empieza con una prueba en un dispositivo real y va el último.

### Antes de empezar

- **Hace falta un dispositivo con Chromecast** (una tele con Google TV o
  Chromecast integrado, un Chromecast, un altavoz Nest…) para probar. El
  emulador no ve dispositivos de la red.
- Los altavoces Bluetooth ya funcionan hoy: los gestiona el sistema, no la app.

---

## 1. Problema

| id | Defecto | Efecto |
|----|---------|--------|
| D1 | No se puede enviar la música a otro dispositivo | Hay que conectar el móvil por cable o Bluetooth |
| D2 | El audio de la app no es alcanzable desde fuera | En la web vive en IndexedDB (`blob:`/`idb://`) y en la APK en un fichero del móvil: un Chromecast no puede pedirlo |

---

## 2. Decisiones de diseño

### 2.1 Cómo se envía: el SDK de Google Cast en los dos lados

| Alternativa | Veredicto |
|---|---|
| Remote Playback API del navegador (`audio.remote.prompt()`) | ❌ No acepta `blob:` ni fuentes de IndexedDB, no existe en la WebView de Android, y no permite enviar una cola |
| **SDK de Google Cast**: el de web en Chrome y el nativo de Android en la APK, contra el **receptor multimedia por defecto** de Google | ✅ **Elegida**: mismo modelo en los dos, cola de canciones en el receptor y controles del sistema incluidos |

- **Web:** `cast_sender.js` de `www.gstatic.com` (ya permitido en
  `allowNavigation`), solo en Chrome y Edge. En Firefox y Safari el botón no aparece.
- **APK:** un plugin de Capacitor con `play-services-cast-framework`. T1 decide
  entre un plugin de la comunidad compatible con Capacitor 5 o **uno propio
  pequeño** en Java (`mobile/android/app/src/main/java/.../CastPlugin.java`)
  con cinco métodos: `elegirDispositivo`, `cargarCola`, `control` (reproducir,
  pausar, buscar, siguiente, anterior), `estado` (eventos) y `desconectar`. Con
  el propio no se depende de un paquete sin mantenimiento.
- Receptor: el **Default Media Receiver** (`CC1AD845`). No hace falta registrar
  ni alojar un receptor propio.

### 2.2 Una dirección que el Chromecast pueda pedir

El receptor necesita una URL `https` pública para cada canción. El servidor la
ofrece así:

1. `POST /api/cast/token { videoId, formato }` → `{ url, caduca }`, con
   `url = https://music.dannarita.es/api/cast/<token>`.
2. El **token** es `base64url(videoId.formato.caducidad) + "." + HMAC-SHA256`
   con un secreto propio (`CAST_SECRET` en el entorno del servicio). Dura 6 horas.
3. `GET /api/cast/<token>`: comprueba firma y caducidad y sirve el audio con
   soporte de `Range` (el receptor lo pide a trozos) y `Content-Type: audio/mp4`
   o `audio/mpeg`.
4. **Caché de envío en el servidor** (`/var/cache/youtube-downloader/cast/`):
   si la canción ya está, se sirve al momento; si no, se descarga con el mismo
   constructor de comandos de siempre (`build_ytdlp_audio_cmd`) y se sirve al
   terminar. Tope de 2 GB con borrado de lo más antiguo, y 24 h de vida por fichero.
5. **Se pide el token de la siguiente canción mientras suena la actual**, para
   que el primer segundo de cada canción no espere a una descarga.

**Qué no se puede enviar:** las canciones importadas del móvil (sin `videoId`):
el servidor no tiene forma de conseguirlas. Se avisa: «Esta canción solo está en
tu móvil».

### 2.3 El reproductor mientras se envía

- El audio local **se pausa**, y los controles de la app (mini reproductor,
  pantalla completa, atajos del plan 10, sesión del sistema) pasan a mandar
  sobre el receptor. Se hace con un **adaptador de salida**:
  `salida.local` (el motor del plan 12) o `salida.remota` (el Chromecast), con
  la misma interfaz. `player.js` usa la salida actual y no sabe cuál es.
- **La cola viaja al receptor** (`queueLoad` con las 10 siguientes, y se va
  ampliando): si la APK se va a segundo plano o Android la congela, el
  Chromecast sigue con la siguiente canción sin esperar a la app.
- Indicador «Sonando en *Salón*» en el mini reproductor y en la pantalla completa.
- **Al desconectar**, la reproducción vuelve al móvil en el mismo punto, en pausa.
- **No se aplican** el fundido ni el volumen igualado del plan 12: el receptor
  reproduce el fichero tal cual. Se dice en los ajustes de reproducción.
- La radio (plan 16) funciona: sus canciones tienen `videoId`.

### 2.4 El botón

- Icono estándar de envío en la pantalla completa y en la barra del escritorio.
  **Solo aparece si hay algún dispositivo disponible** en la red (el SDK lo informa).
- Tocarlo abre el selector de dispositivos del sistema (Android) o de Chrome (web).

---

## 3. Seguridad y límites

| Medida | Por qué |
|---|---|
| Tokens firmados con HMAC y con caducidad; comparación en tiempo constante (`hmac.compare_digest`) | La ruta de envío no puede ser un proxy abierto de descargas para cualquiera |
| `CAST_SECRET` distinto de `JWT_SECRET`, en el override del servicio, fuera del repositorio | Si uno se filtra, el otro sigue a salvo |
| `videoId` validado y formato de la lista blanca de siempre (`m4a`, `mp3`) | Nada del cliente llega tal cual a yt-dlp |
| `POST /api/cast/token`: 60 por hora por IP | Cada token nuevo puede suponer una descarga en el servidor |
| La caché de envío tiene tope de disco y caducidad, y el barrido la vigila | Que no llene el VPS |
| `GET /api/cast/<token>` solo lee dentro de la carpeta de caché (`safe_join`) | Como el resto de rutas de ficheros |
| El SDK web se carga solo si el navegador es Chrome o Edge y solo al necesitarlo | No añadir un script de terceros a todo el mundo |

---

## 4. Alcance

**Dentro:** D1-D2 con Chromecast, en la web (Chrome y Edge) y en la APK.

**Fuera:**
- AirPlay (sin proyecto iOS, y en Safari de Mac es secundario).
- DLNA/UPnP y altavoces de otras marcas sin Chromecast.
- Receptor propio con diseño de la app en la tele: posible más adelante, con registro en la consola de Cast.
- Enviar canciones sin `videoId` (§2.2).

---

## 5. Tareas

### Bloque A — Prueba y decisión

#### T1 · Prueba con un dispositivo real

1. En Chrome de escritorio: página mínima con el SDK web que envía una URL de
   prueba al receptor por defecto, y una cola de dos canciones.
2. En la APK: probar el plugin de la comunidad más usado para Capacitor 5; si no
   compila o no mantiene la cola, prototipo del plugin propio.
3. Anotar aquí la decisión (comunidad o propio) y el peso que añade a la APK.

### Bloque B — Servidor

#### T2 · Tokens, ruta de envío y caché

**Ficheros:** `backend/server.py`, `backend/cast.py` (nuevo: firma y caché, sin Flask),
override de systemd (`CAST_SECRET`), `scripts/deploy.sh` (crear la carpeta de caché)

§2.2 y §3, reutilizando el soporte de `Range` de `/api/stream/<id>`.

### Bloque C — Clientes

#### T3 · Adaptador de salida

**Ficheros:** `frontend/src/features/player/output.js` (nuevo), `features/player/player.js`,
`controls.js`, `system-session.js`

`salidaLocal(engine)` y `salidaRemota(cast)` con la misma interfaz (`play`,
`pause`, `seek`, `currentTime`, `duration`, eventos `timeupdate`, `ended`,
`play`, `pause`). `player.js` pasa a usar `salida.actual()`.

#### T4 · Envío desde la web

**Ficheros:** `frontend/src/features/cast/web.js` (nuevo)

Carga perezosa del SDK, `CastContext` con el receptor por defecto, `queueLoad`,
`RemotePlayerController` para los controles y los eventos.

#### T5 · Envío desde la APK

**Ficheros:** según T1: `mobile/package.json` o `mobile/android/app/src/main/java/…/CastPlugin.java`
y su registro en `MainActivity`; `mobile/android/app/build.gradle`
(`play-services-cast-framework`); `AndroidManifest.xml` (`OptionsProvider` del
Cast SDK); `verification-metadata.xml` regenerado; `frontend/src/features/cast/native.js` (nuevo)

Misma interfaz que T4. La notificación y los controles de la pantalla de
bloqueo del envío los pone el propio SDK de Cast.

#### T6 · Botón e indicador

**Ficheros:** `frontend/index.html`, `features/player/full-player.js`, `styles.css`, traducciones

§2.4 y el indicador de §2.3.

### Bloque D — Tests

#### T7 · Tests del plan

| Qué | Dónde |
|---|---|
| Tokens: firma, caducidad, alterar un byte invalida, otro secreto invalida, `videoId` y formato validados | `test/backend/test_cast.py` (nuevo) |
| Ruta de envío: `Range`, tipo de contenido, token caducado 403, ruta fuera de la caché imposible | ídem |
| Caché: tope de disco y caducidad | ídem |
| Adaptador de salida: `player.js` funciona igual con una salida remota simulada; al desconectar vuelve al punto exacto | `test/frontend/test_salida.mjs` (nuevo) |
| La cola remota se amplía al acercarse al final | ídem |
| E2E 42 · con el SDK de Cast simulado en la página, pulsar enviar pausa el audio local, pide los tokens y manda la cola | `recorridos.spec.js` |

**Prueba manual obligatoria** con un Chromecast real: web y APK, cola de 5
canciones, APK en segundo plano durante 3 canciones, controles de la pantalla de
bloqueo, desconectar a mitad y retomar en el móvil.

---

## 6. Orden de ejecución, commits y despliegue

```
T1                      prueba con dispositivo real → decisión anotada
T2                      servidor (con CAST_SECRET)          → desplegar
T3                      adaptador de salida
T4                      web                                 → desplegar
T5 → T6                 APK e interfaz                      → APK
T7 con cada tarea
```

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| No hay plugin de Cast fiable para Capacitor 5 | Media | Plugin propio pequeño (T1) |
| El receptor por defecto rechaza el formato | Baja | `m4a` (AAC) y `mp3` son formatos soportados; T1 lo comprueba |
| La primera canción tarda en sonar si el servidor tiene que descargarla | Media | Tokens de la siguiente pedidos con antelación; mensaje «Preparando…» |
| El VPS sirve mucho tráfico | Baja (hoy) | Caché con tope; solo se envía lo que alguien está escuchando |
| La APK crece con Google Play Services | Segura | Se mide en T1; el SDK de Cast añade 1-2 MB |
| Un móvil sin servicios de Google | Baja | El botón no aparece; nada más cambia |

---

## 8. Definición de hecho

- [ ] T1 hecha y anotada.
- [ ] Enviar una cola a un Chromecast desde Chrome y desde la APK, con los controles de la app y del sistema.
- [ ] La cola sigue en el receptor con la APK en segundo plano.
- [ ] Tokens firmados y caducables; caché con tope.
- [ ] Todas las suites en verde, incluido el recorrido 42, y la prueba manual con un dispositivo real.
