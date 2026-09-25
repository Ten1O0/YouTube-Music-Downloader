# 07 — Entrega de progreso y caché

**Estado:** hecho · desplegado · **Prioridad:** 🔵 Estructural · **Depende de:** 03 (duro) · 02 y 04 (coordinación)
**Puntos del análisis:** 12, 13 (+ tres hallazgos nuevos, ver D3 a D5)

> Los dos puntos son la misma pregunta: **cómo llega información fresca al
> cliente**. Uno es el progreso de las descargas, el otro es el propio código de
> la aplicación.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | Progreso por sondeo cada segundo | `pollProgress`, app.js ~2756 | Cientos de peticiones por descarga larga, y hasta 1 s de retraso en cada actualización |
| D2 | El Service Worker sirve HTML obsoleto | `public/sw.js` | Si se olvida subir `CACHE_NAME`, los usuarios se quedan clavados en la build anterior |
| D3 | **(nuevo)** `cache.addAll` es atómico y una de las URLs es de terceros | public/sw.js:17 | Si Google Fonts no responde durante la instalación, **no se cachea nada** |
| D4 | **(nuevo)** El `fetch` del SW cachea todo lo que no sea `/api/` | public/sw.js:48-60 | Se cachean sin techo las miniaturas de `i.ytimg.com`, las banderas de `flagcdn.com` y las fuentes: caché que solo crece |
| D5 | **(nuevo)** El mensaje de progreso llega como frase en castellano | server.py → `updateProgress(percent, data.message)` | Impide traducir la barra de progreso (es D5 del plan 05) |

### El coste del sondeo (D1)

```js
const pollInterval = setInterval(async () => {
    const response = await fetch(`${API_URL}/api/progress/${downloadId}`);
    ...
}, 1000);
```

Una descarga de un vídeo suelto tarda 20-40 s: **20-40 peticiones**. Una playlist
de 50 canciones puede tardar 15 minutos: **900 peticiones** por una sola descarga,
cada una con sus cabeceras, su registro en nginx y su paso por Flask. Y si el
usuario tiene tres descargas en marcha, se multiplica.

Ninguna de ellas aporta nada la mayor parte del tiempo: el estado cambia cuando
yt-dlp emite una línea, no cada segundo exacto.

### El Service Worker sirve el pasado (D2)

```js
const CACHE_NAME = 'ytdl-v16';
const STATIC_ASSETS = ['/', '/index.html', '/favicon.png', '/manifest.json', '<google fonts>'];
```

con estrategia **cache-first para todo lo que no sea `/api/`**. Es decir: el
`/index.html` cacheado gana siempre al de la red. Como `index.html` es quien
referencia los assets con hash (`/assets/main-CyxADYqD.js`), servir un HTML viejo
significa servir **toda la aplicación vieja**, por muy bien que se haya
desplegado.

La única defensa es acordarse de subir `ytdl-v16` a `ytdl-v17` en cada despliegue,
a mano, en tres ficheros distintos (`public/sw.js`, `mobile/www/sw.js` y la copia
del VPS). Es exactamente el tipo de paso manual que se olvida.

Y hay dos fallos más en el mismo fichero:

- **D3:** `cache.addAll` falla entera si **una sola** URL falla. La lista incluye
  `https://fonts.googleapis.com/css2?...`: si el CDN tarda o está bloqueado
  durante la instalación, el `.catch` registra un aviso y el usuario se queda
  **sin caché ninguna**, sin enterarse.
- **D4:** el manejador de `fetch` no distingue origen. Cachea las miniaturas de
  `i.ytimg.com`, las banderas de `flagcdn.com` y las fuentes de `gstatic`, sin
  límite ni caducidad, y son respuestas opacas que no se pueden ni inspeccionar.
  La caché crece mientras se use la app y nada la poda.

---

## 2. Decisiones de diseño

### 2.1 SSE con un WSGI síncrono: cada conexión es un hilo

Esta es **la** restricción del plan y hay que tenerla clara antes de escribir una
línea. Tras el plan 04, el servidor corre con:

```
gunicorn --workers 1 --threads 8
```

Una conexión SSE abierta **ocupa un hilo mientras dure**. Y aquí las descargas
duran hasta 30 minutos. Con 8 hilos, **ocho descargas simultáneas dejan el
servidor sin capacidad de responder a nada más** — incluida la propia web.

| Alternativa | Veredicto |
|---|---|
| Subir `--threads` a 32-64 | ✅ **Elegida.** Los hilos de SSE están bloqueados en `sleep`, no consumen CPU; el coste es memoria de pila (~8 MB de dirección virtual, mucho menos residente) |
| `gevent` / `eventlet` | ❌ El plan 04 ya lo descartó: `subprocess` y los hilos de `monitor_download_files` no se llevan bien con el monkeypatching |
| WebSockets | ❌ Más máquinaria (handshake, proxy, reconexión a mano) para un flujo que va en una sola dirección |
| Dejar el sondeo, subiendo el intervalo a 3 s | 🤔 Reduce el tráfico a un tercio sin ningún riesgo. **Es el respaldo si SSE se complica** |

Además, límites obligatorios:
- **Tope de duración por conexión SSE** (p. ej. 35 min, algo por encima de
  `DOWNLOAD_TIMEOUT`), tras el cual el servidor cierra y `EventSource` reconecta.
- **Cierre en cuanto el estado sea terminal** (`complete`, `error`, `cancelled`):
  no tiene sentido mantener el hilo.
- **Tope de conexiones SSE simultáneas**, devolviendo 503 para que el cliente
  caiga al sondeo en vez de tumbar el servidor.

### 2.2 El sondeo no se borra: se convierte en el respaldo

`EventSource` puede no estar disponible o fallar: un proxy corporativo que
bufferiza, la WebView de Android con `CapacitorHttp` de por medio, una red móvil
mala. El cliente intenta SSE y, ante el primer error o si no hay datos en N
segundos, **cae al `pollProgress` de siempre**.

Esto hace además que el plan sea desplegable por partes y reversible: si SSE da
problemas en producción, se desactiva con una bandera y todo sigue funcionando.

### 2.3 Estrategias de caché, una por tipo de recurso

| Recurso | Estrategia | Razón |
|---|---|---|
| Navegaciones y `/index.html` | **network-first**, respaldo a caché | Es la causa de D2: el HTML debe ser fresco o no hay despliegue que valga |
| `/assets/<hash>.js|css` | **cache-first, inmutable** | El nombre lleva el hash: si cambia el contenido, cambia la URL |
| `/manifest.json`, `/favicon.png` | stale-while-revalidate | Cambian poco y no son críticos |
| Fuentes de Google | cache-first, **caché aparte** que no se purga en cada despliegue | Son grandes y estables |
| `i.ytimg.com`, `flagcdn.com` | **no cachear** (o caché con tope) | D4: son ilimitadas por naturaleza |
| `/api/*`, `/download` | no cachear | Ya lo hace |

### 2.4 La versión de la caché se genera, no se escribe

| Alternativa | Veredicto |
|---|---|
| Seguir subiendo `ytdl-vN` a mano | ❌ Es D2 |
| `vite-plugin-pwa` (Workbox) | Robusto y estándar, pero mete una capa grande para un SW de 70 líneas |
| **Plugin mínimo de Vite que inyecte la versión al copiar `sw.js`** | ✅ **Elegida**: ~15 líneas, control total, y el SW sigue siendo legible |

La versión puede ser el hash corto de git o la marca de tiempo del build. Lo
importante es que **cambie en cada build y que nadie tenga que acordarse**.

---

## 3. Alcance

**Dentro:** `server.py` (nuevo endpoint SSE y el `code` del progreso), `app.js`
(`pollProgress` y su nuevo hermano SSE), `public/sw.js`, `vite.config.js` y la
configuración de nginx y gunicorn en el VPS.

**Fuera:**
- Traducir los mensajes de progreso: las **claves** son del plan 05 (T4); aquí
  solo se emiten los códigos.
- El resto de la i18n → **plan 05**.
- Notificaciones push: la APK tiene `@capacitor/local-notifications` instalado
  pero eso es otro tema.
- Cachear el audio en el SW: el audio se persiste en IndexedDB (plan 01) y en el
  sistema de ficheros nativo; meterlo también en la caché del SW sería una
  tercera copia.

---

## 4. Tareas

### Bloque A — Progreso por SSE

---

#### T1 · Endpoint `text/event-stream`

**Ficheros:** `server.py` (junto a `get_progress`, ~493)

**Qué hacer**

```python
SSE_MAX_DURATION = 35 * 60
SSE_MAX_CONNECTIONS = 40
_sse_connections = threading.Semaphore(SSE_MAX_CONNECTIONS)
TERMINAL_STATUSES = ('complete', 'error', 'cancelled')


@app.route('/api/progress/stream/<download_id>', methods=['GET'])
@limiter.exempt
def stream_progress(download_id):
    if safe_download_path(download_id) is None:
        return jsonify({'error': INVALID_DOWNLOAD_ID_ERROR}), 400

    if not _sse_connections.acquire(blocking=False):
        # Sin hueco: el cliente debe caer al sondeo
        return jsonify({'error': 'Demasiadas conexiones', 'code': 'sse_unavailable'}), 503

    def generate():
        started = time.time()
        last_payload = None
        try:
            while time.time() - started < SSE_MAX_DURATION:
                with download_lock:
                    progress = download_progress.get(download_id)

                if progress is None:
                    yield format_sse({'status': 'unknown'})
                    return

                payload = json.dumps(progress, sort_keys=True)
                if payload != last_payload:
                    last_payload = payload
                    yield format_sse(progress)

                if progress.get('status') in TERMINAL_STATUSES:
                    return

                time.sleep(0.5)
        finally:
            _sse_connections.release()

    response = Response(generate(), mimetype='text/event-stream')
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'   # imprescindible con nginx delante
    response.headers['Connection'] = 'keep-alive'
    return response
```

Detalles que importan:

- **`X-Accel-Buffering: no`** no es opcional: sin él nginx acumula la respuesta y
  el cliente no recibe nada hasta el final, que es justo lo contrario del objetivo.
  Hay que comprobar además que el bloque de nginx tenga `proxy_buffering off;`
  para esa ruta.
- **Solo se emite cuando el estado cambia**, no cada medio segundo.
- El `finally` con `release()` es crítico: sin él, un cliente que se desconecta
  abruptamente consume un hueco para siempre.
- **`download_lock` viene del plan 03 T4.** Sin ese candado, este generador lee un
  diccionario que otros hilos están modificando. Es la dependencia dura con 03.
- Mantener `GET /api/progress/<id>` **intacto**: es el respaldo de §2.2.

**Por qué** Corrige D1. Nótese que el ahorro no es solo de peticiones: la
actualización pasa a ser inmediata en lugar de tener hasta un segundo de retraso.

**Verificación**

```bash
curl -N -H 'Accept: text/event-stream' \
     http://127.0.0.1:5000/api/progress/stream/<id>
```
Los eventos deben ir apareciendo **según ocurren**. Repetir contra
`https://music.dannarita.es` para verificar que nginx no bufferiza.

---

#### T2 · Códigos de mensaje en el progreso (D5)

**Ficheros:** `server.py` (los ocho sitios que escriben `message`)

**Qué hacer**

Añadir `code` y `params` a cada escritura de progreso, **conservando `message`**:

```python
download_progress[download_id].update({
    'status': 'downloading',
    'current': current_count,
    'total': total_count,
    'code': 'downloading_n_of_m',
    'params': {'current': current_count, 'total': total_count},
    'message': f'Descargando... {current_count} de {total_count} canciones',  # respaldo
})
```

Los códigos son los que el plan 05 T4 ya dejó como claves (`srv_starting`,
`srv_downloading_n_of_m`, `srv_downloading_pct`, `srv_zipping`, `srv_complete_n`,
`srv_batch_complete`, `srv_cancelled`, `srv_error_none`), sin el prefijo `srv_`,
que lo añade el cliente.

El sitio natural para hacerlo sin repetirse es el `update_progress()` único que
introdujo el plan 03 T4.

**Por qué** Es el punto exacto donde arreglar D5 sale gratis: ya se está tocando
cada escritura de progreso. Hacerlo aparte sería tocar los mismos ocho sitios dos
veces.

**Verificación** `GET /api/progress/<id>` durante una descarga devuelve `code` y
`params` junto a `message`. Con el cliente del plan 05 T4, la barra de progreso
sale traducida al cambiar de idioma.

---

#### T3 · Cliente con SSE y respaldo a sondeo

**Ficheros:** `app.js` (`pollProgress` ~2756 y sus tres llamantes)

**Qué hacer**

1. Extraer el cuerpo común (lo que hoy hacen `updateBatchETA`, `updateQueueUI` y
   `handlePollStatus`) a un `handleProgressUpdate(data, total, downloadId)`, para
   que los dos transportes compartan el tratamiento.

2. Añadir el transporte SSE:

   ```js
   function streamProgress(downloadId, total) {
       return new Promise((resolve, reject) => {
           const es = new EventSource(`${API_URL}/api/progress/stream/${downloadId}`);
           let gotAnything = false;

           const fallback = setTimeout(() => {
               if (!gotAnything) { es.close(); pollProgress(downloadId, total).then(resolve, reject); }
           }, 5000);

           es.onmessage = (ev) => {
               gotAnything = true;
               clearTimeout(fallback);
               const data = JSON.parse(ev.data);
               const result = handleProgressUpdate(data, total, downloadId);
               if (result?.done) { es.close(); resolve(result.value); }
           };

           es.onerror = () => {
               es.close();
               clearTimeout(fallback);
               // EventSource reintenta solo; aquí preferimos caer al sondeo,
               // que es el camino probado.
               pollProgress(downloadId, total).then(resolve, reject);
           };
       });
   }
   ```

3. Sustituir las tres llamadas a `pollProgress(...)` por `streamProgress(...)`,
   dejando `pollProgress` **tal cual** como respaldo.

4. Bandera para desactivarlo sin desplegar código nuevo:

   ```js
   const USE_SSE = (await StorageModule.get('use_sse')) !== false;
   ```

**Ojo con la APK:** `EventSource` **no** lo intercepta el plugin `CapacitorHttp`,
así que sale por la pila de red de la WebView y **sí** pasa por CORS. El origen
`https://localhost` tiene que estar en la lista blanca del plan 02 T2 o en la APK
no funcionará ni SSE ni nada. El respaldo del punto 2 cubre el caso, pero conviene
que no haga falta.

**Por qué** Corrige D1 en el cliente sin apostar: el camino viejo sigue entero y
se activa solo ante cualquier problema.

**Verificación** En DevTools → Network, una descarga de playlist debe mostrar
**una** conexión `event-stream` en vez de cientos de `progress`. Cortar el
servidor a mitad y comprobar que cae al sondeo y se recupera. Y la misma prueba
en la APK.

---

#### T4 · Ajustar hilos, nginx y límites

**Ficheros:** unidad de systemd y configuración de nginx en el VPS

**Qué hacer**

1. Subir los hilos de gunicorn (§2.1):

   ```
   --workers 1 --threads 32
   ```
   `--workers` sigue siendo 1 por la restricción del plan 03 §2.1: el estado de
   las descargas vive en memoria del proceso.

2. En nginx, para la ruta de streaming:

   ```nginx
   location /api/progress/stream/ {
       proxy_pass http://127.0.0.1:5000;
       proxy_buffering off;
       proxy_read_timeout 3600s;
       proxy_set_header Connection '';
       proxy_http_version 1.1;
   }
   ```

3. Revisar el `@limiter.exempt` de `/api/progress/<id>` que puso el plan 02 T4:
   con SSE funcionando, el sondeo pasa a ser excepcional y ese endpoint puede
   recuperar un límite razonable (p. ej. `120 per minute`, que da para un sondeo
   de un segundo durante dos minutos y corta el abuso).

**Por qué** Sin el punto 1, ocho descargas simultáneas bloquean el servidor. Sin
el punto 2, SSE simplemente no llega. Son las dos formas de que este plan parezca
funcionar en local y falle en producción.

**Verificación** Ocho descargas simultáneas desde pestañas distintas, y que
`https://music.dannarita.es/api/health` siga respondiendo mientras tanto.

---

### Bloque B — Service Worker

---

#### T5 · Estrategias por tipo de recurso (D2, D4)

**Ficheros:** `public/sw.js`

**Qué hacer**

Reescribir el manejador de `fetch` según §2.3:

```js
const HTML_DESTINATIONS = ['document'];
const IMMUTABLE = /\/assets\/[^/]+\.(js|css)$/;
const NEVER_CACHE_HOSTS = ['i.ytimg.com', 'flagcdn.com', 'accounts.google.com'];

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/download')) return;
    if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;          // D4

    // HTML: red primero, caché como respaldo offline               // D2
    if (HTML_DESTINATIONS.includes(event.request.destination)) {
        event.respondWith(
            fetch(event.request)
                .then((res) => { putInCache(CACHE_NAME, event.request, res.clone()); return res; })
                .catch(() => caches.match(event.request).then(c => c || caches.match('/index.html')))
        );
        return;
    }

    // Assets con hash: caché primero, son inmutables
    if (IMMUTABLE.test(url.pathname)) { event.respondWith(cacheFirst(event.request)); return; }

    // El resto: stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
});
```

Y arreglar la instalación (D3), que hoy es atómica:

```js
// cache.addAll falla entera si una sola URL falla, y una es de un CDN de terceros
await Promise.allSettled(
    STATIC_ASSETS.map((asset) => cache.add(asset).catch(err => console.warn('[SW] no cacheado:', asset, err)))
);
```

Sacar además la URL de Google Fonts de `STATIC_ASSETS` a una caché propia
(`ytdl-fonts`) que **no** se borre en el `activate`: son estables y grandes, y
purgarlas en cada despliegue es tirar ancho de banda del usuario.

**Por qué** Corrige D2, D3 y D4. El network-first del HTML es el cambio
importante: a partir de ahí, un despliegue llega al usuario aunque la versión de
caché no cambie.

**Verificación** Desplegar un cambio visible **sin** tocar `CACHE_NAME` y
comprobar que se ve tras recargar. En modo avión, la app debe seguir abriendo
(respaldo a caché). Y en DevTools → Application → Cache Storage, comprobar que
ya no aparecen entradas de `i.ytimg.com`.

---

#### T6 · Versión de caché generada en el build (D2)

**Ficheros:** `vite.config.js`, `public/sw.js`

**Qué hacer**

1. En `public/sw.js`, usar un marcador:

   ```js
   const SW_VERSION = '__SW_VERSION__';
   const CACHE_NAME = `ytdl-${SW_VERSION}`;
   ```

2. Plugin mínimo en `vite.config.js` que lo sustituya al generar el bundle:

   ```js
   import { execSync } from 'node:child_process';

   function swVersion() {
       return {
           name: 'sw-version',
           closeBundle() {
               const version = (() => {
                   try { return execSync('git rev-parse --short HEAD').toString().trim(); }
                   catch { return Date.now().toString(36); }
               })();
               const file = resolve(__dirname, 'dist/sw.js');
               writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__SW_VERSION__', version));
           },
       };
   }
   ```

   Se ejecuta en `closeBundle` porque Vite copia `public/` al final; el
   `try/catch` cubre el caso de compilar fuera de un repositorio git.

3. En desarrollo, `__SW_VERSION__` sin sustituir es un nombre de caché válido y
   constante: no molesta.

4. Comprobar que `sync-apk.sh` (plan 04 T2) copia `dist/sw.js` —no
   `public/sw.js`— a `mobile/www/`, o la APK se llevará el marcador sin sustituir.

**Por qué** Es la otra mitad de D2: T5 hace que un HTML viejo ya no se sirva, y
T6 hace que la caché de assets se invalide sola en cada despliegue. Deja de haber
un paso manual que olvidar en tres ficheros.

**Verificación** Dos builds seguidos con un commit en medio producen
`CACHE_NAME` distintos. Tras desplegar, DevTools → Application → Cache Storage
muestra la caché nueva y el `activate` ha borrado la anterior.

---

### Bloque C — Verificación automática

---

#### T7 · Tests de SSE y de estrategias de caché

**Ficheros:** `test/backend/test_sse.py` (nuevo),
`test/frontend/test_sw_strategies.mjs` (nuevo)

**Qué hacer**

1. **SSE (T1-T4).**

   | Comprobación |
   |---|
   | El endpoint responde `Content-Type: text/event-stream` y `Cache-Control: no-cache` |
   | El formato de cada evento es válido (`data: …\n\n`) y su JSON parsea |
   | Al completarse la descarga se emite el evento de cierre y el flujo termina |
   | Un `download_id` inválido se rechaza igual que en el resto de rutas |
   | Los códigos de mensaje (D5) son estables: el cliente traduce por código, no por texto |
   | El cliente cae a sondeo si `EventSource` no existe o el flujo falla |

   El del respaldo es el importante: si SSE falla en un navegador y no hay
   respaldo, la barra de progreso se queda congelada para siempre y el usuario
   cree que la descarga está rota.

2. **Service Worker (T5-T6).** El SW no se puede cargar en el arnés actual
   (necesita `self`, `caches` y eventos `fetch`), así que se prueba su **lógica
   de decisión** extraída a una función pura: dada una URL y su tipo, qué
   estrategia corresponde.

   | Comprobación |
   |---|
   | `/api/*` y `/download` nunca se cachean |
   | La navegación usa *network-first* con respaldo a caché |
   | Los assets con hash usan *cache-first* |
   | La versión de caché cambia con el build (T6) y el activate borra las viejas |

**Por qué** El progreso por SSE sustituye a un mecanismo que hoy funciona. Un
fallo aquí no rompe la descarga, pero deja al usuario mirando una barra parada,
que es peor: no sabe si esperar o reintentar. Y las estrategias del SW son la
causa de que la gente vea código viejo tras un despliegue, que es un fallo caro
de diagnosticar sin un test que lo fije.

**Verificación** `pytest test/backend/test_sse.py -v` y `node --test
test/frontend/` en verde.

---

## 5. Orden de ejecución y commits

```
T1 → T2 → T3 → T4     (progreso: servidor, protocolo, cliente, infraestructura)
T5 → T6               (service worker: independiente del bloque A)
T7                    (tests; el del respaldo a sondeo, junto con T3)
```

Los dos bloques no se tocan entre sí y pueden ser dos PRs. Dentro del bloque A,
T4 va **antes de mergear**, no después: desplegar SSE con `--threads 8` y sin
`proxy_buffering off` da un fallo que parece del código y es de configuración.

**Dependencia dura con el plan 03:** T1 usa `download_lock` y T2 usa el
`update_progress()` único, ambos introducidos en el plan 03 T4. Sin ellos, este
plan lee y escribe estado compartido sin sincronizar.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Las conexiones SSE agotan los hilos y el servidor deja de responder** | **Alta sin T4** | `--threads 32`, semáforo de 40 conexiones con 503, cierre en estado terminal y tope de 35 min |
| nginx bufferiza el stream y no llega nada | **Alta si se olvida** | `X-Accel-Buffering: no` + `proxy_buffering off`; se verifica con `curl -N` contra el dominio real |
| `EventSource` no funciona en la WebView de Android | Media | Respaldo automático a `pollProgress` (T3) + origen en la lista blanca de CORS del plan 02 |
| Un cliente que se desconecta deja el hueco del semáforo tomado | Media | `release()` en `finally`; probar cerrando la pestaña a mitad de descarga |
| network-first deja la app sin abrir cuando no hay red | Media | Respaldo explícito a `caches.match('/index.html')`; probar en modo avión |
| El plugin de Vite no sustituye el marcador en `mobile/www` | Media | T6 punto 4: la APK debe copiar de `dist/`, no de `public/` |
| Se pierde el respaldo al borrar `pollProgress` «porque ya no se usa» | Media | Está escrito en §2.2 y en el código con un comentario |

---

## 7. Definición de hecho

- [ ] Una descarga de playlist genera **una** conexión `event-stream` en vez de cientos de peticiones.
- [ ] `curl -N` contra `https://music.dannarita.es/api/progress/stream/<id>` emite eventos según ocurren.
- [ ] Cortar el servidor a mitad de descarga hace que el cliente caiga al sondeo y se recupere.
- [ ] La APK descarga con barra de progreso (por SSE o por el respaldo).
- [ ] Ocho descargas simultáneas no impiden que `/api/health` responda.
- [ ] El progreso lleva `code` y `params`, y la barra sale traducida al cambiar de idioma.
- [ ] Un despliegue **sin** tocar `CACHE_NAME` se ve en el navegador tras recargar.
- [ ] La app abre en modo avión.
- [ ] No hay entradas de `i.ytimg.com` ni `flagcdn.com` en Cache Storage.
- [ ] Dos builds con un commit en medio producen `CACHE_NAME` distintos.
- [ ] `node --check public/sw.js` y `python3 -m py_compile server.py` pasan.
- [ ] `pytest test/backend/test_sse.py` y `node --test test/frontend/` en verde, incluido el respaldo a sondeo.


---

## Nota del plan 05 (T6) — códigos que debe emitir el servidor

El cliente ya tiene el respaldo puesto: `resolveProgressText(data)` traduce con
`i18n.t('srv_' + data.code, data.params)` si la respuesta trae `code`, y cae al
`message` literal si no. Las claves existen ya en los seis idiomas.

Cuando este plan implemente T2 (códigos de mensaje en el progreso), el servidor
debe emitir **exactamente** estos, con estos parámetros:

| `code` | `params` | Sustituye a |
|---|---|---|
| `starting` | — | «Iniciando descarga...» |
| `downloading_n_of_m` | `current`, `total` | «Descargando... {n} de {m} canciones» |
| `downloading_pct` | `percent`, `speed`, `eta` | «Descargando: {p} ({s}) - ETA: {e}» |
| `zipping` | — | «Creando archivo ZIP...» |
| `complete_n` | `count` | «¡{n} canciones descargadas!» |
| `batch_complete` | `count` | «¡Completado! {n} archivos descargados.» |
| `cancelled` | — | «Descarga cancelada» |
| `error_none` | — | «No se pudo descargar ninguna canción» |
| `converting` | — | «Convirtiendo a MP3...» (paso de ffmpeg del plan 05) |

Mientras el servidor siga mandando solo `message`, no hay regresión: el cliente
pinta lo de siempre.


---

## 8. Registro de ejecución (2026-09-22)

**T1 a T7 implementados. 498 tests de backend + 128 de frontend en verde, ruff
limpio.** 33 tests nuevos (16 de SSE, 17 del Service Worker).

### Verificado en vivo

El endpoint SSE se probó contra el servidor real con el `yt_dlp` simulado del
plan 06. Una descarga de playlist produjo exactamente **tres eventos** —uno por
cambio de estado, no uno cada medio segundo—, cerró al llegar a `complete`, y
devolvió las cabeceras correctas incluido `X-Accel-Buffering: no`. Los `code` y
`params` de T2 viajan en cada evento.

### Dos fallos propios que cacé por el camino

**Un `detenerSondeo()` fuera de ámbito.** Al sustituir los `clearInterval(pollInterval)`
con una expresión regular, toqué también el del temporizador de 30 minutos de
`pollProgress`, donde esa función no existe. `node --check` no lo detecta porque
es válido sintácticamente: habría sido un `ReferenceError` en tiempo de
ejecución, y solo en descargas que agotasen el tiempo.

**`deploy.sh` y `deploy.bat` subían `public/sw.js`.** Ese fichero lleva el
marcador `__SW_VERSION__` **sin sustituir**, así que la caché nunca se habría
invalidado entre despliegues: justo el problema que T6 venía a resolver. Ahora
ambos priorizan `dist/sw.js`. De paso, `deploy.bat` seguía subiendo el
`manifest.json` de la raíz, que el plan 04 eliminó.

### Resumen por tarea

| Tarea | Qué quedó |
|---|---|
| T1 | `/api/progress/stream/<id>` con semáforo de 40 conexiones, emisión solo al cambiar y `finally` que libera el hueco |
| T2 | `code` y `params` en las 9 escrituras de progreso, conservando `message` |
| T3 | `streamProgress()` con respaldo a sondeo por cuatro vías: sin `EventSource`, error al abrir, sin eventos en 5 s, o error de conexión |
| T4 | Configuración de nginx y gunicorn documentada en el README (aplicar en el VPS) |
| T5 | Service Worker reescrito: red primero para HTML, caché primero para assets con hash, *stale-while-revalidate* para el resto, y nada de terceros |
| T6 | `__SW_VERSION__` sustituido por el commit en `closeBundle` de Vite |
| T7 | 33 tests |

### Notas de la implementación

**El respaldo al sondeo tiene cuatro vías de activación**, no una. La apuesta es
asimétrica a propósito: si SSE funciona se gana, y si no, el camino viejo sigue
entero. `pollProgress` no se tocó más que para extraerle el tratamiento común.

**El Service Worker expone `elegirEstrategia()`** como función pura. No se puede
cargar el SW entero fuera de un navegador, pero su lógica de decisión —que es
donde estaban los tres defectos— sí se puede probar, y son 17 tests.

**El HTML pasa de cache-first a network-first.** Es el cambio que hace que un
despliegue llegue al usuario sin tener que acordarse de subir `CACHE_NAME`.

### Pendiente — requiere el VPS

| Qué | Por qué |
|---|---|
| `location /api/progress/stream/` con `proxy_buffering off` | Sin esto SSE **no llega**: nginx acumula la respuesta |
| `--threads 32` (con `--workers 1`) | Cada conexión SSE ocupa un hilo mientras dura la descarga |
| Revisar el `@limiter.exempt` de `/api/progress/<id>` | Con SSE, el sondeo pasa a ser excepcional y puede recuperar un límite |
| Probar SSE en la APK | `EventSource` no lo intercepta `CapacitorHttp`, así que **sí** pasa por CORS: depende de que `https://localhost` esté en la lista blanca del plan 02 |
