# 02 — Endurecimiento de seguridad del backend

**Estado:** código implementado · **SIN DESPLEGAR** · **Prioridad:** 🟠 Alto · **Depende de:** —
**Puntos del análisis:** 5, 6, 7, 9 (+ tres hallazgos nuevos, ver D0, D5 y D6)

---

## 1. Problema

Todo lo que se configura en la cabecera de `server.py` está en su valor por
defecto de desarrollo, y el servidor lleva meses expuesto en `music.dannarita.es`
con esa configuración.

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| **D0** | **(nuevo)** `static_folder='.'` publica **todo el directorio del proyecto** en la raíz web | server.py:42 | **`/data/youtube_downloader.db` es descargable por cualquiera: la base de datos completa de usuarios.** También `/server.py` y `/database.py` |
| D1 | `JWT_SECRET` cae a un literal escrito en el repositorio | server.py:59 | Cualquiera que lea el código público firma tokens válidos de **cualquier** usuario |
| D2 | `CORS(app)` sin lista de orígenes | server.py:43 | Cualquier web puede lanzar búsquedas y descargas contra el servidor desde el navegador de sus visitantes |
| D3 | Ningún endpoint tiene límite de peticiones | todo `server.py` | Agotamiento trivial de CPU, hilos y disco |
| D4 | `--remote-components ejs:github` en dos comandos de yt-dlp | server.py:773 y 806 | yt-dlp descarga y ejecuta componentes desde GitHub en tiempo de ejecución |
| D5 | **(nuevo)** `/api/stream/<id>` y `/api/download/<id>` no piden autenticación y el id son 8 hex | server.py:310, 1070 | El fichero descargado por otro usuario es accesible acertando el identificador |
| D6 | **(nuevo)** `start_batch_download` crea un `threading.Thread` por petición, sin techo | server.py:671-708 | El pool de 5 workers **no** contiene esta ruta: cada petición es un hilo y una carpeta nuevos |

### D0 · Exposición de la base de datos y del código fuente — **verificado en producción**

```python
app = Flask(__name__, static_folder='.', static_url_path='')
```

`static_folder='.'` + `static_url_path=''` registra un manejador estático que
sirve **cualquier fichero del directorio del proyecto** en la raíz del dominio.
No hay path traversal: Flask lo impide. El problema es que los ficheros
sensibles están, legítimamente, dentro de esa carpeta.

Comprobado con peticiones `HEAD` contra el servidor en producción el 21-09-2026:

| Ruta | Respuesta | Contenido |
|---|---|---|
| `/data/youtube_downloader.db` | **200, 5.468.160 bytes** | SQLite con `users`, `history`, `favorites`: correos, nombres, fotos de perfil de Google, historial y favoritos de todos los usuarios |
| `/server.py` | **200, 55.718 bytes** | Código fuente del backend |
| `/database.py` | **200, 10.542 bytes** | Esquema y consultas |
| `/requirements.txt` | **200** | Dependencias |

`database.py:12` fija `DATA_DIR = os.path.join(SCRIPT_DIR, 'data')`, es decir,
la base de datos vive **dentro** del directorio servido. Que `data/` esté en
`.gitignore` no ayuda en absoluto: el `.gitignore` afecta a git, no a Flask.

Además, D0 agrava D1: al ser el código descargable, el literal de `JWT_SECRET`
está al alcance de cualquiera aunque el repositorio fuese privado — y la base de
datos entrega los `user_id` con los que firmar tokens concretos.

> 🚨 **Esto no espera al PR.** El primer paso de este plan (T0) es un parche que
> se despliega hoy. El resto del plan puede seguir su ritmo normal.

### Por qué D1 es el segundo más grave

```python
JWT_SECRET = os.environ.get('JWT_SECRET', 'yt-music-downloader-secret-key-change-in-production')
```

Si el VPS no exporta `JWT_SECRET`, el servidor firma con ese literal. Con el
literal en la mano, fabricar un token es una línea:

```python
jwt.encode({'user_id': 1, 'exp': ...}, '<el literal del repo>', algorithm='HS256')
```

Ese token pasa `auth_required` (server.py:1204) y abre **todos** los endpoints
`/api/user/*` de ese usuario: leer su historial, leer sus favoritos y —vía
`POST /api/user/sync` (server.py:1498)— **escribir** sobre sus datos. No es un
problema de lectura: `db.sync_user_data` fusiona lo que le llegue.

> **Junto con T0, y el mismo día:** comprobar si el VPS tiene la variable puesta.
> Si no la tiene, el secreto real es el del repositorio —descargable, por D0— y
> hay que rotarlo hoy, no al mergear el PR.
>
> ```bash
> ssh "$VPS" "systemctl show youtube-downloader -p Environment"
> ```

**Coste asumido:** cambiar el secreto invalida todos los tokens emitidos. Con
`JWT_EXPIRATION_HOURS = 24 * 30`, eso significa que **todos los usuarios con
sesión iniciada tendrán que volver a entrar con Google**. Es el precio correcto y
hay que pagarlo una vez; no hay forma de rotar un secreto HS256 sin invalidar lo
firmado con el anterior.

### Qué protege realmente restringir el CORS (y qué no)

Conviene no vender el arreglo por más de lo que es. La autenticación de esta app
va por cabecera `Authorization: Bearer`, no por cookie, así que **no hay un CSRF
clásico**: una web de terceros no puede robar la sesión de nadie aunque el CORS
esté abierto.

Lo que sí permite `CORS(app)` hoy:

1. Que cualquier página web lance `fetch('https://music.dannarita.es/api/start-download', …)`
   desde el navegador de sus visitantes y **consuma CPU y ancho de banda ajenos**,
   con las IP de esos visitantes, no la suya.
2. Que cualquier página use este servidor como **proxy de scraping de YouTube**
   gratuito, leyendo la respuesta de `/api/search`.

Y lo que **no** arregla restringir orígenes: un `curl` no manda `Origin` y le da
igual la política. Contra eso está D3, no D2. Los dos se necesitan.

### El coste real de una petición sin límite

| Endpoint | Lo que provoca una sola petición | Auth |
|---|---|---|
| `/api/search` | Un proceso `yt-dlp`, hasta 30 s | ❌ |
| `/api/playlist-info` | Un proceso `yt-dlp`, hasta 60 s | ❌ |
| `/api/start-download` | Carpeta en `TEMP_DIR` + tarea en el pool de 5 + `yt-dlp` hasta 30 min | ❌ |
| `/api/start-batch-download` | Carpeta + **un hilo nuevo sin límite** + N tareas en el pool | ❌ |

`MAX_WORKERS = 5` da una falsa sensación de contención: acota cuántas descargas
corren a la vez, no cuántas se **encolan**. Y la ruta de lote (D6) ni siquiera
pasa por el pool para su coordinador: cada petición arranca un hilo que vive
hasta que terminen sus descargas. Un bucle de peticiones deja el servidor con
miles de hilos y miles de carpetas en `/tmp` antes de que nada lo frene.

---

## 2. Decisiones de diseño

### 2.1 El secreto ausente debe abortar el arranque, no degradarse

La alternativa —generar un secreto aleatorio si falta— es peor: el servidor
arrancaría y todas las sesiones se invalidarían en cada reinicio, con un fallo
intermitente imposible de diagnosticar. Fallar en el arranque es ruidoso, que es
justo lo que se quiere.

### 2.2 Dónde vive el contador del rate limiter

| Almacén | A favor | En contra | Decisión |
|---|---|---|---|
| Memoria del proceso (`memory://`) | Cero dependencias | Con N workers de gunicorn el límite efectivo es N× el configurado | ✅ **Ahora** |
| Redis | Exacto y compartido entre workers | Otro servicio que instalar, monitorizar y que puede caer | Más adelante, si hace falta |

Se elige memoria y se documenta la imprecisión. El objetivo de este plan es
cortar el abuso trivial, no construir una cuota exacta. **Queda anotado para el
plan 04**: al elegir el número de workers de gunicorn se está eligiendo también
el multiplicador del rate limit.

### 2.3 Sin `ProxyFix` el rate limiting no funciona — o funciona al revés

El servicio escucha en `127.0.0.1:5000` detrás de nginx (se ve en `deploy.sh`:
la verificación hace `curl http://127.0.0.1:5000/api/health` y el público entra
por `https://music.dannarita.es`). Por tanto `request.remote_addr` es
**siempre `127.0.0.1`**.

Si se instala `flask-limiter` tal cual, todos los usuarios del mundo comparten un
único cubo: el primero que gaste la cuota deja a todos los demás fuera. Es un
fallo peor que no tener límite. `ProxyFix` es obligatorio, no opcional.

### 2.4 `--remote-components ejs:github` no se quita a ciegas

Es funcionalidad legítima y reciente de yt-dlp: descarga de GitHub el componente
que resuelve los desafíos JavaScript del reproductor de YouTube. Quitarlo puede
**romper las descargas** según lo que YouTube esté exigiendo ese día.

Por eso la tarea no es «borrar la bandera», sino **medir y decidir**:

| Opción | Cuándo elegirla |
|---|---|
| Quitarla | Si las descargas funcionan sin ella con la versión de yt-dlp que se fije en el plan 04 |
| Mantenerla, documentada | Si sin ella fallan las descargas: entonces es una dependencia real y debe estar escrita como tal, no heredada de un copia-pega |

En ambos casos el resultado del plan es el mismo: que la bandera sea una
**decisión consciente con un comentario al lado**, que es literalmente lo que
pedía el punto 9 del análisis.

---

## 3. Alcance

**Dentro:** la cabecera y el arranque de `server.py` (fichero estático, CORS,
secreto, límites, `ProxyFix`), la ubicación de `data/` en `database.py`, la línea
de `flask-limiter` en `requirements.txt` y la configuración del servicio y de
nginx en el VPS.

**Fuera:**
- Servir con gunicorn en vez del servidor de desarrollo → **plan 04**.
- Fijar versiones de las dependencias → **plan 04** (aquí solo se **añade** una).
- El barrido de `TEMP_DIR` y de `download_progress` → **plan 03**.
- Cabeceras de seguridad HTTP (CSP, HSTS, `X-Content-Type-Options`): no estaban
  en el análisis y pertenecen a la capa de nginx, no a Flask.
- Rotar `GOOGLE_CLIENT_ID` o cambiar el flujo de OAuth: no está comprometido.
- Caducidad y revocación de los JWT (30 días, sin lista de revocación): es un
  cambio de producto, no una corrección; se anota y se deja fuera.

---

## 4. Tareas

### Bloque A — Secretos y orígenes

---

#### T0 · Dejar de publicar el directorio del proyecto (D0) — **hotfix**

**Ficheros:** `server.py` (~42), `database.py` (~12), configuración de nginx en el VPS

**Qué hacer**

Son tres capas y conviene poner las tres, empezando por la más rápida de desplegar.

**a) Contención inmediata, en nginx (minutos):**

```nginx
location ~ ^/(data|\.git)/ { return 404; }
location ~ \.(py|db|sqlite3?|txt|bat|sh|log)$ { return 404; }
```

Excepción: `/manifest.json` y `/favicon.png` deben seguir sirviéndose — ambos
tienen ruta explícita en Flask y no encajan en esos patrones, pero conviene
comprobarlo antes de recargar nginx.

**b) Corrección real, en Flask:**

```python
app = Flask(__name__, static_folder=None)
```

Desactiva el manejador estático por completo. Las rutas explícitas que ya
existen siguen funcionando (`/`, `/download`, `/sw.js`, `/manifest.json`,
`/favicon.png`, `/assets/<path>`), pero hay que **añadir ruta para lo que hoy
sirve el estático de casualidad**. Inventario de lo que el frontend pide:

| Ruta | Quién la pide | Estado tras el cambio |
|---|---|---|
| `/assets/<hash>.js`, `/assets/<hash>.css` | `dist/index.html` | ✅ ya tiene ruta (server.py:296) |
| `/app.js`, `/styles.css` | `index.html` **sin** build de Vite | ⚠️ hay que añadirla |
| `/Sortable.min.js` | `index.html:1218` | ⚠️ hay que añadirla |
| `/ytmusic.apk` | `download.html:392`, `index.html:1155` | ⚠️ hay que añadirla |

```python
PUBLIC_FILES = {'app.js', 'styles.css', 'Sortable.min.js', 'ytmusic.apk'}

@app.route('/<path:filename>', methods=['GET'])
def serve_public_file(filename):
    if filename not in PUBLIC_FILES:
        return jsonify({'error': 'No encontrado'}), 404
    for folder in ['dist', '.']:
        path = os.path.join(SCRIPT_DIR, folder, filename)
        if os.path.isfile(path):
            return send_file(path)
    return jsonify({'error': 'No encontrado'}), 404
```

Lista blanca, no lista negra: lo que no esté enumerado no se sirve, y añadir un
fichero nuevo al proyecto no vuelve a abrir el agujero.

**c) Sacar los datos del directorio servido:**

```python
# database.py
DATA_DIR = os.environ.get('YTDL_DATA_DIR', os.path.join(SCRIPT_DIR, 'data'))
```

y en el VPS, mover `data/` fuera del directorio del sitio:

```bash
systemctl stop youtube-downloader
mkdir -p /var/lib/youtube-downloader
mv "$REMOTE/data" /var/lib/youtube-downloader/data
chown -R <usuario-del-servicio> /var/lib/youtube-downloader
systemctl edit youtube-downloader   # Environment="YTDL_DATA_DIR=/var/lib/youtube-downloader/data"
systemctl start youtube-downloader
```

Comprobar el `.db-wal` y el `.db-shm` (la BD usa `journal_mode=WAL`): tienen que
moverse con el fichero principal.

**d) Asumir que los datos ya han salido.** La exposición lleva activa un tiempo
indeterminado. Con correos de usuarios de por medio, lo correcto es:
- revisar los logs de acceso de nginx buscando peticiones a `/data/`:
  ```bash
  ssh "$VPS" "grep -c '/data/youtube_downloader.db' /var/log/nginx/*access*"
  ```
- decidir, con ese dato, si procede avisar a los usuarios afectados.

**Por qué** Es la única vía de este análisis por la que ya pueden haber salido
datos personales de terceros. Las tres capas son deliberadamente redundantes: la
de nginx protege mientras se despliega el código, la de Flask es la corrección
correcta, y mover `data/` hace que un error futuro de configuración no vuelva a
exponer la base de datos.

**Verificación**

```bash
for p in /data/youtube_downloader.db /server.py /database.py /requirements.txt; do
  printf "%-32s " "$p"
  curl -s -o/dev/null -w '%{http_code}\n' "https://music.dannarita.es$p"
done
# los cuatro deben devolver 404
```
Y, obligatorio, que la web siga entera: cargar `https://music.dannarita.es`,
`/download`, reproducir una canción y descargar la APK desde el botón.

---

#### T1 · `JWT_SECRET` obligatorio

**Ficheros:** `server.py` (~59)

**Qué hacer**

1. Sustituir el valor por defecto por una comprobación que aborte:

   ```python
   JWT_SECRET = os.environ.get('JWT_SECRET')
   if not JWT_SECRET:
       raise RuntimeError(
           "JWT_SECRET no está definida. Genera una con "
           "`python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"` "
           "y expórtala en el entorno del servicio antes de arrancar."
       )
   ```

   Va a nivel de módulo, **no** dentro de `if __name__ == '__main__'`: el plan 04
   pasará a gunicorn y ese bloque dejará de ejecutarse.

2. Generar el secreto real y ponerlo en el servicio de systemd:

   ```bash
   # en local
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"

   # en el VPS
   systemctl edit youtube-downloader
   # [Service]
   # Environment="JWT_SECRET=<el valor generado>"
   systemctl restart youtube-downloader
   ```

3. Documentar la variable en el `README.md` junto a las instrucciones de arranque.

**Por qué** Corrige D1. Abortar es deliberado: un servidor que arranca con un
secreto conocido es peor que un servidor que no arranca, porque el fallo es
silencioso y permanente.

**Verificación**

```bash
JWT_SECRET= python3 server.py          # debe abortar con el mensaje
ssh "$VPS" "systemctl show youtube-downloader -p Environment" | grep -q JWT_SECRET
curl -s https://music.dannarita.es/api/health   # 200 tras el reinicio
```
Y con un token firmado con el literal viejo, `GET /api/auth/me` debe devolver 401.

---

#### T2 · CORS restringido a los orígenes reales

**Ficheros:** `server.py` (~43)

**Qué hacer**

```python
ALLOWED_ORIGINS = [
    'https://music.dannarita.es',
    'https://localhost',        # WebView de Capacitor en Android (androidScheme: 'https')
    'capacitor://localhost',    # WebView de Capacitor en iOS, por si llega
    'http://localhost:5173',    # Vite en desarrollo
    'http://127.0.0.1:5173',
]

CORS(
    app,
    origins=ALLOWED_ORIGINS,
    expose_headers=["Content-Disposition"],
)
```

> ⚠️ **`https://localhost` no es opcional.** La APK carga la interfaz desde
> assets locales (`capacitor.config.ts` no define `server.url`) con
> `androidScheme: 'https'`, así que sus peticiones a `music.dannarita.es` salen
> con `Origin: https://localhost`. Si se omite, **la APK deja de funcionar por
> completo** y el fallo solo se ve en el móvil, no en el navegador.

Nota: el plugin `CapacitorHttp` está activado (`capacitor.config.ts`), y cuando
intercepta un `fetch` lo ejecuta de forma nativa, sin política de mismo origen.
Eso hace que parte del tráfico de la APK ni siquiera pase por CORS — razón de más
para no depender de ese detalle y listar el origen explícitamente.

**Por qué** Corrige D2 dentro de lo que el CORS puede corregir: cierra el uso
desde páginas de terceros. El abuso directo lo corta T4.

**Verificación**

```bash
# Origen permitido → cabecera presente
curl -s -D- -o/dev/null -H "Origin: https://music.dannarita.es" \
     https://music.dannarita.es/api/health | grep -i access-control-allow-origin

# Origen ajeno → sin cabecera
curl -s -D- -o/dev/null -H "Origin: https://evil.example" \
     https://music.dannarita.es/api/health | grep -i access-control-allow-origin
```
Y **obligatorio**: instalar la APK y comprobar que busca y descarga.

---

### Bloque B — Límites de consumo

---

#### T3 · `ProxyFix` para ver la IP real del cliente

**Ficheros:** `server.py` (cabecera, junto a la creación de `app`)

**Qué hacer**

```python
from werkzeug.middleware.proxy_fix import ProxyFix

app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
```

`x_for=1` = hay **un** proxy de confianza por delante. Si algún día se pone un
CDN delante de nginx habrá que subirlo a 2; poner un número mayor del real deja
que el cliente falsifique su IP inyectando cabeceras `X-Forwarded-For`.

Comprobar además que nginx manda la cabecera:

```bash
ssh "$VPS" "grep -r 'X-Forwarded-For' /etc/nginx/ | head"
```
Si no aparece, añadir `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
al bloque del sitio antes de continuar con T4.

**Por qué** Sin esto, T4 aplica un único cubo compartido a todo internet
(sección 2.3). Es la tarea que hace que la siguiente signifique algo.

**Verificación** Añadir temporalmente un `app.logger.info(request.remote_addr)` en
`/api/health`, pedirlo desde fuera y comprobar en `journalctl -u youtube-downloader`
que aparece la IP pública y no `127.0.0.1`.

---

#### T4 · `flask-limiter` con límites por endpoint

**Ficheros:** `server.py` (cabecera + decoradores), `requirements.txt`

**Qué hacer**

1. Añadir `flask-limiter` a `requirements.txt` (sin versión de momento: el
   pinning completo es del plan 04, y fijar una sola línea en un fichero donde
   ninguna otra lo está solo confunde).

2. Configurar el limitador:

   ```python
   from flask_limiter import Limiter
   from flask_limiter.util import get_remote_address

   limiter = Limiter(
       get_remote_address,
       app=app,
       default_limits=["200 per hour"],
       storage_uri="memory://",
       strategy="fixed-window",
   )
   ```

3. Aplicar límites específicos donde el coste es real:

   | Endpoint | Límite | Razón |
   |---|---|---|
   | `/api/search` | `20 per minute` | Un `yt-dlp` de hasta 30 s por petición |
   | `/api/playlist-info` | `10 per minute` | Un `yt-dlp` de hasta 60 s |
   | `/api/start-download` | `10 per minute, 100 per hour` | Carpeta + tarea del pool |
   | `/api/start-batch-download` | `3 per minute, 20 per hour` | Es la más cara: hilo + N tareas (D6) |
   | `/api/auth/google`, `/auth/native/callback` | `10 per minute` | Verificación contra Google por petición |
   | `/api/progress/<id>` | `exempt` | Lo llama el polling cada segundo: **limitarlo rompe la app** |
   | `/api/health` | `exempt` | Lo usa la verificación del deploy |

   ```python
   @app.route('/api/search', methods=['POST'])
   @limiter.limit("20 per minute")
   def search_youtube():
       ...

   @app.route('/api/progress/<download_id>', methods=['GET'])
   @limiter.exempt
   def get_progress(download_id):
       ...
   ```

4. Devolver un error en el formato que ya usa el resto de la API:

   ```python
   @app.errorhandler(429)
   def ratelimit_handler(e):
       return jsonify({'error': 'Demasiadas peticiones. Espera un momento.'}), 429
   ```

**Por qué** Corrige D3 y contiene D6. Nótese el `exempt` de `/api/progress`: el
cliente lo pide una vez por segundo durante toda la descarga (`pollProgress` en
`app.js`), así que un límite por minuto lo mataría. **El plan 07 sustituye ese
polling por SSE**; cuando eso ocurra, este `exempt` se podrá revisar.

**Verificación**

```bash
for i in $(seq 1 25); do
  curl -s -o/dev/null -w "%{http_code} " -X POST \
       -H 'Content-Type: application/json' -d '{"query":"test"}' \
       https://music.dannarita.es/api/search
done; echo
```
Deben aparecer 429 a partir de la petición 21. Y después, comprobar a mano que
una descarga normal, con su polling, **no** recibe ningún 429.

---

#### T5 · Contener el hilo por petición de las descargas en lote (D6)

**Ficheros:** `server.py` (`start_batch_download` ~671)

**Qué hacer**

`run_parallel_batch` se lanza hoy con `threading.Thread(...)` directamente.
Sustituirlo por un pool propio, pequeño y explícito:

```python
# Pool separado para coordinadores de lote: no compite con las descargas
batch_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2, thread_name_prefix='batch-coord'
)
```

y en `start_batch_download`:

```python
batch_executor.submit(run_parallel_batch, videos, download_folder, quality, download_id, total_count)
```

Añadir además un tope al número de vídeos aceptados por petición:

```python
MAX_BATCH_VIDEOS = 100
if len(videos) > MAX_BATCH_VIDEOS:
    return jsonify({'error': f'Máximo {MAX_BATCH_VIDEOS} canciones por lote'}), 400
```

**Por qué** El rate limiting acota la frecuencia; esto acota el daño de cada
petición individual. Un pool separado es importante: si los coordinadores fuesen
al `executor` principal, 5 lotes simultáneos ocuparían los 5 workers **esperando**
a que se ejecuten sus propias descargas en ese mismo pool — un interbloqueo
clásico de pools compartidos.

**Verificación** Lanzar 3 lotes a la vez y comprobar en
`journalctl -u youtube-downloader` que progresan (el tercero espera turno, no
falla). Comprobar que el número de hilos del proceso se estabiliza:
`ssh "$VPS" "ps -o nlwp= -p \$(pgrep -f server.py | head -1)"`.

---

### Bloque C — Superficie de ejecución

---

#### T6 · Decidir sobre `--remote-components ejs:github`

**Ficheros:** `server.py` (`prefetch_video_metadata` ~773, `build_ytdlp_download_cmd` ~806)

**Qué hacer**

1. Probar en el VPS, con la versión de yt-dlp que esté en producción, cuatro
   descargas **sin** la bandera: un vídeo normal, uno con restricción de edad,
   uno de YouTube Music y una playlist corta.

2. Según el resultado:
   - **Si funcionan**: quitar la bandera de los dos comandos y dejar un comentario
     explicando que se retiró a propósito y cuándo.
   - **Si fallan**: dejarla y escribir el porqué encima:
     ```python
     # yt-dlp necesita el componente EJS remoto para resolver los desafíos JS del
     # reproductor de YouTube. Decisión consciente (plan 02, T6): sin él fallan las
     # descargas de <caso concreto>. Revisar en cada actualización de yt-dlp.
     '--remote-components', 'ejs:github',
     ```

3. En ambos casos, anotar la conclusión en este fichero al cerrarlo.

**Por qué** Corrige D4 en el sentido que pedía el análisis: convertir un
copia-pega en una decisión. Tratar de quitarla sin medir es cambiar un riesgo de
seguridad por una caída de funcionalidad.

**Verificación** Las cuatro descargas de prueba terminan con fichero de audio
válido y reproducible.

---

#### T7 · Identificadores de descarga imprevisibles (D5)

**Ficheros:** `server.py` (`start_download` ~1049, `start_batch_download` ~692, `safe_download_path` ~91)

**Qué hacer**

1. Dejar de truncar el UUID:

   ```python
   download_id = uuid.uuid4().hex        # 32 hex, en vez de str(uuid.uuid4())[:8]
   ```

2. Ajustar `safe_download_path` para que acepte exactamente ese formato:

   ```python
   if not re.fullmatch(r'[a-f0-9]{32}', download_id):
       return None
   ```

3. Alinear la comprobación de `stream_file` (server.py:314), que hoy hace su
   propia validación con `'..' in download_id`, para que use `safe_download_path`
   como el resto de rutas. Es la única que no lo hace.

**Por qué** `str(uuid.uuid4())[:8]` da 8 hex ≈ 4·10⁹ combinaciones. No es
adivinable a mano, pero sin rate limiting era enumerable, y `/api/download/<id>`
entrega el fichero **y borra la carpeta**: acertar un id le quita la descarga a su
dueño. 32 hex lo hace imposible y no cuesta nada. El punto 3 elimina de paso la
única validación artesanal de path traversal que queda en el fichero.

**Compatibilidad:** los identificadores viejos de 8 caracteres dejan de validar.
Como las carpetas de `TEMP_DIR` son efímeras (y el plan 03 las barre), el único
efecto es que una descarga en curso durante el despliegue se pierda. Aceptable;
conviene desplegar sin descargas activas.

**Verificación**

```bash
curl -s -o/dev/null -w '%{http_code}\n' https://music.dannarita.es/api/stream/../../etc/passwd   # 400/404
curl -s -o/dev/null -w '%{http_code}\n' https://music.dannarita.es/api/stream/deadbeef           # 400
```
Y una descarga completa de principio a fin con el id nuevo.

---

### Bloque D — Verificación automática

---

#### T8 · Tests de seguridad

**Ficheros:** `test/backend/test_static_exposure.py`, `test/backend/test_url_validation.py`,
`test/backend/test_api_endpoints.py`, `test/backend/test_auth_jwt.py`,
`test/backend/test_rate_limiting.py` (nuevo)

**Qué hacer**

1. **Pasar a verde los `xfail` existentes.** La suite ya describe el
   comportamiento correcto de cuatro de los defectos de este plan. Al
   arreglarlos, esos tests empiezan a pasar y hay que **quitarles el
   decorador** `@pytest.mark.xfail` para que a partir de ahí protejan de
   regresiones:

   | Test | Lo arregla |
   |---|---|
   | `test_static_exposure.py` — los 5 grupos | T0 |
   | `test_auth_jwt.py::test_secret_must_not_have_a_hardcoded_default` | T1 |
   | `test_api_endpoints.py::test_cors_must_not_echo_any_origin` | T2 |
   | `test_url_validation.py::test_foreign_host_must_be_rejected` | (SSRF, D7) |
   | `test_url_validation.py::test_attacker_url_must_not_reach_ytdlp` | (SSRF, D7) |

   Los `xfail` de T0 son `strict=False` porque `data/` y `.env` no existen en
   local; al arreglarlo conviene pasarlos a `strict=True` y apoyarse en
   `test_static_folder_should_not_be_the_project_root`, que detecta la causa
   raíz en cualquier entorno.

2. **Tests nuevos para lo que este plan añade:**

   | Qué | Dónde | Comprobación |
   |---|---|---|
   | Lista blanca de estáticos | `test_static_exposure.py` | `/`, `/download`, `/sw.js`, `/manifest.json`, `/favicon.png`, `/assets/<hash>.js` y `/ytmusic.apk` siguen dando 200 |
   | `JWT_SECRET` obligatorio | `test_auth_jwt.py` | Sin la variable, la app **no arranca** (import lanza) |
   | CORS por origen | `test_api_endpoints.py` | `https://music.dannarita.es` y `https://localhost` sí; cualquier otro no recibe cabecera |
   | Rate limiting | `test_rate_limiting.py` | N+1 peticiones a `/api/search` dan 429; `/api/progress` está exento |
   | `ProxyFix` | `test_rate_limiting.py` | Con `X-Forwarded-For`, `request.remote_addr` es la IP del cliente |
   | Ids imprevisibles | `test_path_security.py` | `download_id` tiene 32 hex; los de 8 caracteres ya no validan |

3. Ajustar los tests de `test_path_security.py` que hoy dan por válidos ids
   cortos (`"abc12345"`, `"a"`, `"-"`): tras T7 deben rechazarse.

**Por qué** Cuatro de los defectos de este plan ya tienen su test escrito
esperando: convertirlos en verdes es la señal objetiva de que el trabajo está
hecho, y a partir de ahí impiden que vuelva a colarse. Sin el punto 3, la suite
seguiría afirmando que un id de 8 caracteres es aceptable justo después de
haberlo prohibido.

**Verificación**

```bash
.venv/bin/python -m pytest test/backend/ -q      # 0 fallos, 0 xfail de este plan
.venv/bin/python -m pytest test/backend/ -rx     # revisar que no queda ningún xfail de seguridad
```

---

## 5. Orden de ejecución y commits

```
T0 → T1          ← HOY, en su propio PR y desplegado el mismo día
T2               (CORS, con prueba en APK antes de seguir)
T3 → T4 → T5     (rate limiting: ProxyFix primero o el límite es incorrecto)
T6               (decisión sobre yt-dlp, independiente)
T7               (identificadores, independiente)
T8               (tests: cierra cada tarea y deja la suite sin xfail de seguridad)
```

**T8 no va solo al final**: cada tarea deja su test en verde según se completa.
Se lista aparte porque incluye trabajo propio (los tests nuevos de rate limiting
y de la lista blanca de estáticos) que no cabe dentro de ninguna otra.

**T0 y T1 se separan en su propio PR y se despliegan el mismo día.** Van juntos
porque son el mismo incidente: el código es descargable (T0), y ese código
contiene el secreto con el que se firman las sesiones (T1). Arreglar uno sin el
otro deja el problema abierto.

El resto puede ir en un segundo PR. T3 **antes** que T4 sin excepción:
invertirlo deja el servidor con un límite global que afecta a todos los usuarios
a la vez.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Desactivar el estático deja la web sin `app.js`, `styles.css` o la APK** | **Alta si no se hace el inventario** | Lista blanca explícita en T0 + prueba de carga completa de `/` y `/download` antes de mergear |
| Mover `data/` pierde la base de datos o la deja a medias (WAL) | Media | Parar el servicio antes de mover, mover `.db`, `.db-wal` y `.db-shm`, y verificar con un login real |
| **El CORS restringido rompe la APK** (falta `https://localhost`) | **Media** | Está explícito en T2; probar en el móvil es obligatorio antes de mergear |
| Todos los usuarios pierden la sesión al rotar `JWT_SECRET` | Alta (es seguro) | Es inevitable y esperado; avisar y elegir un momento tranquilo |
| El rate limit corta el polling de `/api/progress` y rompe descargas normales | Media | `@limiter.exempt` explícito en T4 + prueba manual de una descarga completa |
| `ProxyFix` mal configurado permite falsear la IP | Baja | `x_for=1`, exactamente el número de proxies reales |
| Quitar `--remote-components` rompe las descargas | **Media** | T6 mide antes de decidir; si falla, se mantiene y se documenta |
| El servidor no arranca tras el despliegue por falta de la variable | Media | Poner la variable en systemd **antes** de subir el código; `deploy.sh` ya verifica `/api/health` y hace rollback manual visible |
| `flask-limiter` en memoria da límites N× con varios workers | Alta | Documentado; se revisa al elegir workers en el plan 04 |

---

## 7. Definición de hecho

- [ ] `/data/youtube_downloader.db`, `/server.py`, `/database.py` y `/requirements.txt` devuelven **404** en producción.
- [ ] `grep -n "static_folder" server.py` → `static_folder=None`.
- [ ] `data/` vive fuera del directorio del sitio y el login sigue funcionando.
- [ ] Los logs de nginx se han revisado en busca de accesos previos a `/data/`.
- [ ] `https://music.dannarita.es`, `/download`, la reproducción y la descarga de la APK funcionan tras desactivar el estático.
- [ ] `grep -n "yt-music-downloader-secret-key" server.py` → sin resultados.
- [ ] El servidor **no arranca** sin `JWT_SECRET`, y el VPS la tiene definida.
- [ ] Un token firmado con el secreto viejo devuelve 401 en `/api/auth/me`.
- [ ] `grep -n "CORS(app)" server.py` → solo la llamada con `origins=`.
- [ ] Una petición con `Origin: https://evil.example` no recibe cabecera de CORS.
- [ ] La APK instalada busca, descarga y reproduce sin regresiones.
- [ ] 25 peticiones seguidas a `/api/search` devuelven 429 a partir de la 21.
- [ ] Una descarga normal con su polling termina sin ningún 429.
- [ ] `request.remote_addr` refleja la IP pública, no `127.0.0.1`.
- [ ] La decisión sobre `--remote-components` está tomada y **escrita** en el código.
- [ ] `download_id` tiene 32 caracteres hex y `stream_file` valida con `safe_download_path`.
- [ ] `python3 -m py_compile server.py` pasa.
- [ ] `pytest test/backend/ -q` pasa **sin ningún xfail de seguridad**: los de `test_static_exposure.py`, el SSRF de `test_url_validation.py`, el CORS de `test_api_endpoints.py` y el secreto de `test_auth_jwt.py` están en verde y sin decorador.
- [ ] Existe `test/backend/test_rate_limiting.py` y cubre el 429, la exención de `/api/progress` y `ProxyFix`.


---

## 8. Registro de ejecución (2026-09-21)

### Implementado en código y verificado con tests

T0b (static_folder=None + lista blanca), T0c (`YTDL_DATA_DIR`), T1, T2, T3, T4,
T5, T7, T8 y T9. **348 tests en verde, sin ningún `xfail`.**

### T9 · SSRF — tarea añadida durante la ejecución

El plan no tenía tarea para el defecto D7 (se descubrió al escribir la suite de
tests, después de redactarlo). Implementada como `is_youtube_host()`, que valida
el host con `urlparse` contra una lista de hosts permitidos antes de mirar el
patrón.

### T6 · Decisión sobre `--remote-components ejs:github`: **SE MANTIENE**

Medido contra el yt-dlp de producción (2026.03.17). Sin la bandera, la
extracción de metadatos funciona, pero yt-dlp avisa:

```
WARNING: [youtube] [jsc:node] Challenge solver lib script version 0.4.0
         is not supported (supported version: 0.8.0)
```

El resolutor de desafíos empaquetado está desactualizado y la bandera es lo que
trae el actualizado desde GitHub. Quitarla cambiaría un riesgo de seguridad por
una rotura de funcionalidad, que es justo lo que el plan quería evitar. Anotado
en el código junto a los dos usos.

**Hallazgo colateral:** yt-dlp en producción es de hace ~6 meses y el propio
yt-dlp avisa de ello. Es la causa más común de que las descargas de YouTube
dejen de funcionar. Pertenece al plan 04 T3 (fijar versiones), pero conviene
actualizarlo antes.

### Revisión de logs (T0d): sin evidencia de acceso de terceros

Los únicos accesos con 200/206 a `/data/youtube_downloader.db`, `/server.py`,
`/database.py` y `/requirements.txt` en todo el histórico retenido son de
`87.124.241.82` con `curl/8.7.1`, con marca de tiempo de las comprobaciones de
esta misma sesión. El resto de peticiones a `/data/` son bots buscando `.env`,
`.claude.json` y `.codex/auth.json`, todas con 404 o 444.

⚠️ **Los logs solo cubren del 9 al 21 de septiembre (12 días).** La exposición
existía desde el despliegue inicial (febrero), así que no se puede descartar un
acceso anterior a esa ventana.

### Pendiente — requiere desplegar (a la orden del usuario)

| Qué | Dónde |
|---|---|
| T0a: reglas de contención en nginx | VPS |
| T0c: mover `data/` a `/var/lib/youtube-downloader/` con sus `.db-wal` y `.db-shm` | VPS |
| T1: generar el secreto y ponerlo en systemd **antes** de subir el código | VPS |
| Instalar `flask-limiter` en el venv de producción | VPS |
| T2: probar la APK con el CORS restringido | Móvil |
| T3: confirmar que nginx envía `X-Forwarded-For` | VPS |
| Verificación end-to-end de los 429 y de una descarga completa | Producción |

⚠️ **El orden importa**: `JWT_SECRET` debe estar en systemd **antes** de subir
el código, o el servicio no arrancará. Y `flask-limiter` debe estar instalado en
el venv, o el import fallará.
