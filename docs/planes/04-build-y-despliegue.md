# 04 — Cadena de build y despliegue

**Estado:** hecho · desplegado · **Prioridad:** 🟡 Medio · **Depende de:** 03 (recomendado, ver §2.1)
**Puntos del análisis:** 8, 11, 19, 21, 22 (+ tres hallazgos nuevos, ver D6 a D8)

> **Objetivo del plan en una frase:** poder construir y desplegar esto de forma
> reproducible **desde este portátil**.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | El único camino automatizado de build es `.bat` | `sync-apk.bat` | En macOS no hay forma de compilar la APK |
| D2 | Seis dependencias sin una sola versión | `requirements.txt` | Un redeploy puede tumbar la app sin haber tocado nada |
| D3 | El servidor de desarrollo de Flask sirve producción | server.py:1553 | Un solo hilo por petición gestionado por Werkzeug, sin control de recursos |
| D4 | Artefactos binarios versionados | `ytmusic.apk` (10,8 MB), `mobile/www/assets/` | Cada rebuild infla el historial: el pack ya va por 52 MiB |
| D5 | El README móvil contradice a `capacitor.config.ts` | `mobile/README.md:49` | Quien lo siga sube cambios al VPS y no ve nada en el móvil |
| D6 | **(nuevo)** El portátil no tiene **ninguna** de las herramientas de build | — | Node, npm y Java no están instalados; `ANDROID_HOME` sin definir |
| D7 | **(nuevo)** `manifest.json` existe dos veces y con contenido distinto | raíz y `public/` | Se sirve el de `public/`; el de la raíz es un decorado que nadie actualiza |
| D8 | **(nuevo)** `mobile/www/` es una copia versionada de `dist/` | `mobile/www/*` | Tercer sitio donde vive el mismo build, y el que más se olvida de actualizar |

### Estado real de este portátil (D6)

Comprobado el 21-09-2026:

```
node      → command not found
npm       → command not found
java      → Unable to locate a Java Runtime
ANDROID_HOME / ANDROID_SDK_ROOT → sin definir
python3   → 3.9.6 (del sistema, sin flask ni yt-dlp)
```

Es decir: **un `sync-apk.sh` no es suficiente por sí solo**. El punto 22 del
análisis es correcto pero se queda corto: el script es la mitad del trabajo, y la
otra mitad es dejar escrito —y probado— cómo se monta el entorno en macOS. Un
script que falla en su primera línea con `command not found` no desbloquea nada.

`deploy.sh` ya lo sabe, y lo dice:

```bash
echo "  ERROR: no se encuentra 'npm'. Instala Node.js o usa --no-build."
echo "         (este portátil no tiene Node instalado)"
```

Hoy, por tanto, el único despliegue posible desde macOS es `./deploy.sh --no-build`,
que sube `app.js` y `index.html` en crudo **sin regenerar `dist/`** — y como
`server.py` prefiere `dist/` sobre la raíz (server.py:280), lo que se sirve
sigue siendo el build viejo. **Los cambios de frontend desplegados desde este
portátil no llegan al usuario.** Esa es la consecuencia práctica de D6, y es la
razón de que este plan tenga prioridad real y no solo higiénica.

### El mismo build en cuatro sitios (D4, D7, D8)

| Copia | Quién la genera | ¿Versionada? | Quién la consume |
|---|---|---|---|
| `index.html`, `app.js`, `styles.css` (raíz) | escritas a mano | ✅ sí (fuente) | Vite, y `server.py` como respaldo |
| `dist/` | `npm run build` | ❌ (en `.gitignore`) | El VPS, vía `deploy.sh` |
| `mobile/www/` | copia manual de `dist/` | ✅ **sí** | `cap sync` → la APK |
| `ytmusic.apk` | Gradle | ✅ **sí** (10,8 MB) | `/download` en el VPS |

Y `manifest.json` vive en la raíz **y** en `public/`, con `theme_color`
distinto (`#0a0a0a` frente a `#0A0C0A`). Vite copia `public/` dentro de `dist/`,
así que el que se sirve es el de `public/` y el de la raíz solo aparece si no hay
build: dos fuentes de verdad que divergen sin que nadie se entere.

---

## 2. Decisiones de diseño

### 2.1 Restricción heredada del plan 03: **un solo worker**

El estado de las descargas vive en diccionarios del proceso (`download_progress`,
`download_cancellation`, `download_processes`, server.py:83-88). Con varios
workers de gunicorn, una descarga iniciada por el worker A es invisible para el
worker B y `/api/progress/<id>` devuelve `404` de forma aleatoria.

> ⚠️ **Configuración obligatoria: `--workers 1 --threads N`.** No es una
> preferencia, es una consecuencia de dónde vive el estado. Poner
> `--workers 4` rompe las descargas de una forma intermitente y difícil de
> diagnosticar.

| Alternativa | Veredicto |
|---|---|
| `--workers 1 --threads 8` | ✅ **Elegida.** Equivale al `threaded=True` actual, con un servidor serio delante |
| `--workers N` + Redis para el estado | Correcto a largo plazo, pero es un proyecto entero y aquí no hay problema de carga que lo justifique |
| `--workers N` sin tocar el estado | ❌ Rompe las descargas |
| `gevent` / `eventlet` | ❌ `subprocess` y los hilos de `monitor_download_files` no se llevan bien con el parcheo de monkeypatching |

Además, `run_download_task` puede tardar hasta 30 minutos, así que el timeout de
gunicorn tiene que subirse: las tareas largas corren en el `ThreadPoolExecutor`,
no en el worker, pero `/api/download/<id>` sí puede tardar en enviar un ZIP grande.

**Por qué depende del plan 03:** T6 de ese plan saca `db.init_db()` y
`os.makedirs(TEMP_DIR)` de `if __name__ == '__main__'`. Bajo gunicorn ese bloque
**no se ejecuta nunca**, así que sin el plan 03 el cambio a WSGI arranca un
servidor sin base de datos y sin directorio temporal. Se puede hacer el plan 04
antes, pero entonces hay que traerse esa tarea aquí.

### 2.2 Fijar versiones: qué significa realmente para `yt-dlp`

Fijar `yt-dlp==X.Y.Z` cambia un riesgo por otro:

| Sin fijar (hoy) | Fijado |
|---|---|
| Un redeploy puede traer una versión que rompa las descargas | Un redeploy es reproducible |
| Las contramedidas de YouTube se absorben solas al redesplegar | **La versión fijada dejará de funcionar** y hay que subirla a mano |

`yt-dlp` no es una dependencia normal: es un cliente de un servicio hostil que
cambia sin avisar. La política correcta no es «fijar y olvidar», sino **fijar y
tener un ritual de actualización escrito**. Se fija todo, y se documenta que ante
un fallo de descargas lo primero que se prueba es subir `yt-dlp`.

Las versiones a fijar salen de lo que **ya funciona en producción**
(`pip freeze` en el VPS), no de la última versión de PyPI. Fijar a lo último
mezcla dos cambios —reproducibilidad y actualización— en el mismo PR.

### 2.3 La APK se queda en el repositorio; lo que se poda es el historial

**Decisión del propietario:** `ytmusic.apk` **sigue versionada**, para que un
clon del repositorio traiga la aplicación lista sin depender de GitHub Releases
ni del VPS. Lo que no se conserva son las **versiones antiguas** del binario.

Medición del repositorio (21-09-2026, 91 commits):

| Qué | MiB comprimidos en el pack | % |
|---|---:|---:|
| `ytmusic.apk` — **11 versiones** en el historial | 42,73 | 82 % |
| `direct_test.mp3` + `test2.mp3` — audios de prueba, **ya no están en `HEAD`** | 6,80 | 13 % |
| `mobile/www/*` | 0,21 | 0,4 % |
| **Todo el código, los 91 commits** | **2,47** | **4,7 %** |
| **Total** | **52,25** | |

El 95 % del repositorio son binarios. Git conserva cada versión de cada fichero
para siempre, así que borrar la APK de la carpeta no libera nada: las 11 copias
siguen dentro de `.git` porque hacen falta para reconstruir commits antiguos.

Por eso la operación tiene dos partes distintas:

| Parte | Qué hace | Frecuencia |
|---|---|---|
| **Dejar de versionar `mobile/www/`** (T5) | Detiene el crecimiento del artefacto de build | Una vez |
| **Podar las APK antiguas del historial** (T8) | Recupera el espacio ya consumido | Periódica, cuando moleste |

#### Qué se espera recuperar

Conservando **solo la última APK** y borrando los dos mp3 de prueba:

```
52,2 MiB  →  ~12 MiB
```

> ⚠️ No baja a 2,5 MiB. Ese número sería si se quitase la APK del todo. Al
> conservar una, esa copia deja de poder comprimirse contra sus hermanas (hoy las
> 11 comparten deltas: 42,7 MiB entre 11 salen a ~3,9 MiB cada una, cuando en
> crudo pesan ~10 MB). La que quede ocupará cerca de sus 10 MB reales.

Conservando las **dos últimas**, entre 13 y 22 MiB según lo parecidas que sean
las dos APK entre sí. **Recomendación: conservar una.** La penúltima APK no
sirve para nada que no sirva mejor un `npm run sync:apk`.

#### El coste, sin adornos

`git filter-repo` **cambia el identificador (SHA) de todos los commits**. Git los
trata como historia distinta, así que hace falta `push --force` y **todo clon
existente queda desincronizado**. En este proyecto eso significa, como mínimo, el
PC con Windows desde el que se usa `deploy.bat` y `sync-apk.bat`.

No es reversible sin la copia de seguridad, y por eso T8 empieza por ella.

#### Alternativa considerada y descartada: Git LFS

`git lfs` resolvería el mismo problema **sin la poda periódica**: el binario
queda fuera del historial y un clon solo descarga la versión que tiene
registrada, no las 11.

| A favor | En contra |
|---|---|
| Una sola reescritura y nunca más | Requiere `git lfs install` en **cada** máquina que clone |
| El clon no crece con las versiones viejas | Una máquina sin LFS recibe un puntero de 130 bytes **en lugar de la APK**, en silencio |
| Integrado con GitHub | Cuota: 1 GB de almacenamiento y 1 GB/mes de tráfico en la cuenta gratuita |
| | La migración (`git lfs migrate import`) reescribe el historial igual: mismo coste inicial que T8 |

Se descarta porque el objetivo declarado es que **un clon cualquiera traiga la
APK funcionando**, y el modo de fallo de LFS —un puntero de texto donde debería
haber un binario de 10 MB— va justo en contra de eso. Queda anotado por si el
criterio cambia.

---

## 3. Alcance

**Dentro:** `requirements.txt`, `.gitignore`, `sync-apk.sh` (nuevo), el `package.json`
raíz, `mobile/README.md`, `README.md`, la unificación de `manifest.json` y la
configuración del servicio en el VPS (gunicorn).

**Fuera:**
- `deploy.sh` y `deploy.bat` están en `.gitignore` (contienen la IP del VPS): se
  actualizan, pero no entran en el PR. Se anota lo que hay que cambiar en ellos.
- Reescribir el historial de git → §2.3, decisión aparte.
- Rate limiting, CORS y secretos → **plan 02** (aunque T0 de ese plan toca `data/`
  en el VPS: coordinar el orden de despliegue).
- Tests y CI → **plan 06**. Este plan deja el terreno preparado (versiones fijas,
  build reproducible) pero no escribe ni un workflow.
- Publicar la APK en un release automático: se documenta el proceso manual; la
  automatización es del plan 06.

---

## 4. Tareas

### Bloque A — Desbloquear la compilación en macOS

---

#### T1 · Dejar escrito el entorno de build (D6)

**Ficheros:** `mobile/README.md`, `README.md`

**Qué hacer**

Escribir la secuencia exacta de macOS, probada de principio a fin en este
portátil:

```bash
# Node (el build de Vite y Capacitor)
brew install node@20
node --version    # v20.x

# JDK 17 — Gradle de Capacitor 5 no funciona con JDK 21+
brew install --cask temurin@17
/usr/libexec/java_home -V         # confirmar que aparece 17

# SDK de Android sin Android Studio
brew install --cask android-commandlinetools
export ANDROID_HOME="$HOME/Library/Android/sdk"
sdkmanager "platform-tools" "platforms;android-33" "build-tools;33.0.2"
sdkmanager --licenses             # hay que aceptarlas o Gradle falla
```

Y persistirlo en `~/.zshrc`:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

**Por qué** Es el prerrequisito de todo lo demás. Sin esto, T2 es un script que
falla en su primera línea. Y `mobile/README.md` hoy manda instalar Android
Studio entero: para compilar en línea de comandos sobra, y las `cmdline-tools`
bastan.

**Nota sobre JDK 17:** Capacitor 5 usa un Gradle que no soporta JDK 21. Si
`brew` instala el JDK por defecto, la compilación falla con un error de
compatibilidad de Gradle que no dice qué versión de Java hace falta.

**Verificación** En una terminal nueva: `node -v`, `java -version`, `sdkmanager --list_installed`
y `echo $ANDROID_HOME` responden los cuatro.

---

#### T2 · `sync-apk.sh`, equivalente de `sync-apk.bat` (D1)

**Ficheros:** `sync-apk.sh` (nuevo), `package.json`, `sync-apk.bat`

**Qué hacer**

1. Escribir el equivalente, siguiendo el estilo de `deploy.sh` (que ya es el
   script de referencia del proyecto en macOS):

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(dirname "$0")"

   # [0/5] Comprobaciones: node, java, ANDROID_HOME, licencias aceptadas
   # [1/5] npm run build
   # [2/5] rm -rf mobile/www && cp -R dist/ mobile/www/
   # [3/5] (cd mobile && npx cap sync android)
   # [4/5] (cd mobile/android && ./gradlew assembleDebug)
   # [5/5] cp mobile/android/app/build/outputs/apk/debug/app-debug.apk ytmusic.apk
   ```

   Diferencias que no son traducción literal del `.bat`:
   - **Comprobar las herramientas antes de empezar** y fallar con un mensaje
     accionable, como hace `deploy.sh` en su paso [1/6]. Nada de `pause`.
   - Soportar `--debug` (por defecto) y `--release`.
   - `./gradlew`, no `gradlew.bat`, y asegurarse de que tiene permiso de
     ejecución (`chmod +x mobile/android/gradlew`).
   - Comprobar que `mobile/android/local.properties` apunta a `$ANDROID_HOME`, o
     generarlo si falta: es el fichero que Gradle necesita y que `.gitignore`
     (correctamente) excluye.

2. Exponerlo desde `package.json` para que haya **un** comando en las dos
   plataformas:

   ```json
   "scripts": {
     "dev": "vite",
     "build": "vite build",
     "preview": "vite preview",
     "sync:apk": "bash sync-apk.sh",
     "sync:apk:win": "sync-apk.bat"
   }
   ```

3. Dejar `sync-apk.bat` como está: sigue siendo el camino en Windows y este plan
   no lo mejora, solo deja de ser el único.

**Por qué** Corrige D1 y D6. `deploy.sh` ya demostró que traducir el `.bat` a
`bash` funciona y es el patrón que el proyecto sigue.

**Ojo con la verificación de dependencias de Gradle:** existe
`mobile/android/gradle/verification-metadata.xml` (221 KB, añadido en el commit
`1b41cc7`). Es un bloqueo de firmas: si `cap sync` trae una dependencia con un
hash distinto, **Gradle aborta**. Es lo que se quiere, pero hay que saberlo
antes de perder una tarde: la primera compilación en macOS puede fallar ahí y la
solución es regenerar el fichero (`./gradlew --write-verification-metadata sha256 help`),
no borrarlo.

**Verificación** `npm run sync:apk` en este portátil produce un `ytmusic.apk`
instalable, y la app instalada arranca, busca, descarga y reproduce.

---

### Bloque B — Despliegue predecible

---

#### T3 · Fijar versiones (D2)

**Ficheros:** `requirements.txt`, `README.md`

**Qué hacer**

1. Capturar lo que hay en producción **ahora**, que es lo que se sabe que funciona:

   ```bash
   ssh "$VPS" "cd '$REMOTE' && .venv/bin/pip freeze" > /tmp/vps-freeze.txt
   ```

2. Escribir `requirements.txt` con versiones exactas de las seis dependencias
   directas más `flask-limiter` si el plan 02 ya está mergeado:

   ```
   flask==<versión del VPS>
   flask-cors==<…>
   yt-dlp==<…>
   google-auth==<…>
   requests==<…>
   PyJWT==<…>
   gunicorn==<…>          # lo añade T4
   ```

3. Documentar el ritual de actualización en el `README.md`:

   ```markdown
   ### Actualizar dependencias
   Las versiones están fijadas a propósito. Para subir yt-dlp (lo primero que hay
   que probar si fallan las descargas):
       pip install -U yt-dlp && pip freeze | grep yt-dlp   # y llevar el valor a requirements.txt
   Probar una descarga de vídeo, una de playlist y una búsqueda antes de desplegar.
   ```

**Por qué** Corrige D2 con la política de §2.2. Fijar a lo que ya corre en el VPS
convierte esto en un cambio de cero riesgo: `pip install -r requirements.txt` deja
el entorno exactamente como está hoy.

**Verificación** En un entorno virtual limpio, `pip install -r requirements.txt`
instala sin resolver nada y `pip freeze` coincide con el fichero. Un deploy
completo tras el cambio, con una descarga de prueba.

---

#### T4 · Servir con gunicorn (D3)

**Ficheros:** `requirements.txt`, `server.py` (bloque `__main__`), unidad de systemd en el VPS

**Qué hacer**

1. Confirmar primero qué hay desplegado — el `Dockerfile` está en `.gitignore` y
   desde aquí no se puede saber:

   ```bash
   ssh "$VPS" "systemctl cat youtube-downloader"
   ```
   Si el `ExecStart` ya es gunicorn, **esta tarea se cierra como innecesaria** y
   solo queda anotarlo en el README. El análisis dejaba esa puerta abierta y hay
   que comprobarla antes de tocar nada.

2. Si es `python server.py`, añadir `gunicorn` a `requirements.txt` y cambiar la
   unidad:

   ```ini
   ExecStart=/var/www/.../.venv/bin/gunicorn \
       --workers 1 \
       --threads 8 \
       --timeout 120 \
       --graceful-timeout 30 \
       --bind 127.0.0.1:5000 \
       --access-logfile - --error-logfile - \
       server:app
   ```

   `--workers 1` es obligatorio: ver §2.1. Conviene dejar el porqué **escrito en
   la propia unidad**, o alguien lo «optimizará» a 4 dentro de seis meses.

3. Comprobar que el plan 03 (T6) está aplicado, o traerse aquí esa tarea:
   `bootstrap()` debe ejecutarse al importar el módulo.

4. Dejar `app.run(...)` en `if __name__ == '__main__'` para desarrollo local,
   con un comentario que diga que en producción no se usa.

**Por qué** Corrige D3 y, de paso, da reinicios sin cortar peticiones
(`--graceful-timeout`) y logs de acceso, que hoy no existen.

**Verificación**

```bash
ssh "$VPS" "systemctl restart youtube-downloader && sleep 3 && systemctl is-active youtube-downloader"
curl -s -o/dev/null -w '%{http_code}\n' https://music.dannarita.es/api/health
```
Y **la prueba que de verdad importa**: una descarga completa con su barra de
progreso, que es lo que rompería un `--workers` mal puesto.

---

### Bloque C — Higiene del repositorio

---

#### T5 · Dejar de versionar el build intermedio (D8)

**Ficheros:** `.gitignore`, `mobile/README.md`

**Qué hacer**

1. Dejar de versionar **solo** `mobile/www/`, que es una copia de `dist/` que
   regenera `sync-apk.sh` (T2) antes de cada `cap sync`:

   ```bash
   git rm -r --cached mobile/www
   ```

   ```gitignore
   # Artefacto de build intermedio: lo regenera npm run sync:apk
   mobile/www/
   ```

2. **`ytmusic.apk` se mantiene versionada.** Es una decisión explícita (§2.3):
   un clon del repositorio debe traer la aplicación lista. Dejar constancia en el
   `.gitignore` para que nadie la añada «por higiene»:

   ```gitignore
   # ytmusic.apk NO se ignora a propósito: se quiere en el clon.
   # Las versiones antiguas se podan del historial con la receta de T8.
   ```

3. Comprobar antes de tocar nada que nada del despliegue depende de la copia
   versionada de `mobile/www/`:
   - `sync-apk.sh` (T2) la regenera desde `dist/`. ✅
   - `deploy.sh` no la usa: sube `dist/` al VPS. ✅
   - La APK la construye Gradle desde `mobile/www/` **ya regenerada**. ✅

4. **No** tocar `mobile/www/` en el historial: son 0,21 MiB y varios commits
   antiguos tocan solo ficheros de esa carpeta, así que borrarla del pasado los
   dejaría vacíos. No compensa.

**Por qué** Corrige D8 sin entrar en conflicto con la decisión sobre la APK. El
mismo build vivía en cuatro sitios; pasa a vivir en tres, y el intermedio deja de
poder quedarse desactualizado en git.

**Verificación** `git ls-files | grep mobile/www` → vacío.
`git ls-files | grep ytmusic.apk` → sigue apareciendo.
`npm run sync:apk` regenera `mobile/www/` y produce la APK.

---

#### T6 · Un solo `manifest.json` (D7)

**Ficheros:** `manifest.json` (raíz), `public/manifest.json`

**Qué hacer**

1. Decidir cuál es la buena: gana `public/manifest.json`, porque es el que Vite
   copia a `dist/` y el que `serve_manifest` acaba sirviendo.
2. Borrar `manifest.json` de la raíz.
3. Comprobar que `deploy.sh` deja de subirlo: hoy está en su array `FILES`. Como
   `deploy.sh` está en `.gitignore`, el cambio se hace en local y se anota aquí.
4. Comprobar que `index.html` referencia `/manifest.json` (ruta absoluta), que
   sigue resolviendo igual.

**Por qué** Es el mismo problema de dos fuentes de verdad que el plan 01
encontró en los favoritos, aplicado a la configuración de la PWA. Ya han
divergido en `theme_color`, que es exactamente cómo empieza.

**Verificación** `curl -s https://music.dannarita.es/manifest.json | grep theme_color`
devuelve `#0A0C0A`. Instalar la PWA en el móvil y comprobar el color de la barra.

---

#### T7 · README móvil acorde a la configuración real (D5)

**Ficheros:** `mobile/README.md`, `README.md`

**Qué hacer**

1. Borrar la sección «Actualizar la APK (siguientes veces)» (`mobile/README.md:47-51`).
   Dice literalmente:

   > «Gracias a que la APK carga la interfaz desde `music.dannarita.es`, **NO
   > necesitas generar una nueva APK**»

   y `capacitor.config.ts` dice lo contrario, en mayúsculas:

   ```ts
   // OFFLINE-FIRST: La app carga desde archivos locales incluidos en el APK.
   // Para actualizar la UI, hay que re-copiar los archivos a www/ y rebuild el APK.
   ```

2. Sustituirla por lo que hay que hacer de verdad:

   ```markdown
   ## Actualizar la APK

   La APK es **offline-first**: la interfaz va dentro del paquete, no se carga
   del VPS (`capacitor.config.ts` no define `server.url`). Cualquier cambio de
   UI, JS o CSS exige recompilar:

       npm run sync:apk        # build + copia a mobile/www + cap sync + gradle

   Al VPS solo hay que desplegar los cambios de backend y la web:

       ./deploy.sh
   ```

3. Arreglar también la línea de solución de problemas que dice «La app no carga
   la web: verifica que el VPS esté en marcha» — con offline-first, eso no es la
   causa. La causa es que la APK tiene un `www/` viejo.

4. Actualizar los requisitos con T1 (JDK 17, cmdline-tools) y quitar la mención a
   `capacitor-music-controls-plugin`, que no está en `mobile/package.json` (el
   plugin real es `@jofr/capacitor-media-session`).

**Por qué** Corrige D5. Una documentación que contradice a la configuración es
peor que no tener documentación: lleva a desplegar al VPS y quedarse esperando un
cambio en el móvil que no va a llegar nunca.

**Verificación** Leer `mobile/README.md` de arriba abajo siguiendo los pasos en
este portátil y terminar con una APK instalada con un cambio visible.

---

### Bloque D — Verificación automática

---

#### T8 · Tests de configuración del build

**Ficheros:** `test/backend/test_build_config.py` (nuevo)

**Qué hacer**

Este plan es sobre todo herramientas, y la mayoría se verifica ejecutándolas.
Lo que sí se puede blindar con tests son las **invariantes de configuración**,
que son justo las que se rompen en silencio meses después:

| Qué | Comprobación |
|---|---|
| Versiones fijas (T3) | Toda línea no vacía ni comentada de `requirements.txt` lleva `==` |
| Coherencia de dependencias | Cada módulo importado en `server.py` y `database.py` aparece en `requirements.txt` |
| Un solo manifest (T6) | Existe un único `manifest.json` de origen y las demás copias son artefactos de build ignorados |
| Artefactos de build fuera de git (T5) | `.gitignore` cubre `mobile/www/` y `dist/`. **`ytmusic.apk` NO debe estar ignorada**: es una decisión explícita (§2.3) y el test debe fallar si alguien la añade |
| Scripts equivalentes (T2) | `sync-apk.sh` y `sync-apk.bat` ejecutan los mismos pasos, en el mismo orden |
| Rutas del despliegue | Las rutas que usa `deploy.sh` coinciden con las del `.service` de systemd |

El de las versiones fijas conviene escribirlo como un test que **falla** si
alguien añade una dependencia sin pinear: es el que más veces va a saltar.

**Por qué** La razón de este plan es que el build sea reproducible. Una
comprobación que sólo vive en la cabeza de quien lo montó no es reproducible; un
test que falla en CI sí. `yt-dlp` sin fijar puede tumbar producción sin que
nadie haya tocado el código, y eso es exactamente lo que este test detecta antes
de desplegar.

**Verificación** `pytest test/backend/test_build_config.py -v` en verde. Probar
que falla de verdad añadiendo temporalmente una dependencia sin versión.

---

### Bloque E — Mantenimiento del historial

---

#### T9 · Podar las APK antiguas del historial (D4) — **destructiva**

**Ficheros:** ninguno del repositorio; es una operación sobre el historial de git

> 🔴 **Esta tarea reescribe el historial y exige `push --force`.** Se hace con el
> repositorio en reposo, no en medio de otro plan. Léase §2.3 entera antes de
> empezar.

**Qué hacer**

**a) Requisitos previos, los cuatro:**

```bash
git status --porcelain     # vacío: nada sin commitear
git stash list             # vacío
git branch -a              # solo main y origin/main
git log --oneline -1       # anotar este SHA: es el "antes"
```
Y que **no haya ningún PR abierto ni rama sin mergear**, en este repositorio ni
en ningún clon.

**b) Copia de seguridad completa — obligatoria, no opcional:**

```bash
cd ~/Proyectos
cp -R YouTube-Music-Downloader "YouTube-Music-Downloader.backup-$(date +%Y%m%d)"
```
Es la única vía de vuelta si algo sale mal.

**c) Instalar la herramienta** (no está en este portátil):

```bash
brew install git-filter-repo      # o: pipx install git-filter-repo
```

**d) Calcular la lista de blobs a eliminar:**

```bash
cd ~/Proyectos/YouTube-Music-Downloader
KEEP=1        # cuántas versiones de la APK conservar (recomendado: 1)

# Las versiones de ytmusic.apk, de la más nueva a la más vieja, saltando las KEEP primeras
git log --all --format='%H' -- ytmusic.apk \
  | while read -r sha; do git rev-parse "$sha:ytmusic.apk"; done \
  | awk -v k="$KEEP" 'NR>k' > /tmp/blobs-a-borrar.txt

# Los audios de prueba, que ya no están en HEAD y nadie echará de menos
git rev-list --objects --all \
  | grep -E "direct_test\.mp3|test2\.mp3" | cut -d' ' -f1 >> /tmp/blobs-a-borrar.txt

sort -u /tmp/blobs-a-borrar.txt -o /tmp/blobs-a-borrar.txt
wc -l < /tmp/blobs-a-borrar.txt      # con KEEP=1 deben ser 12 (10 APK + 2 mp3)
```

**e) Comprobar que ningún commit se queda vacío.** Un commit cuyo único cambio
fuese un blob eliminado desaparecería, y con él su mensaje:

```bash
git log --all --format='%H' -- ytmusic.apk | while read -r sha; do
    n=$(git show --name-only --format='' "$sha" | grep -c .)
    [ "$n" -eq 1 ] && echo "AVISO: $sha toca solo la APK"
done
```
> Comprobado el 21-09-2026: **ninguno de los 11 commits toca solo la APK** (el
> mínimo son 2 ficheros). Si eso cambiase en el futuro, añadir
> `--prune-empty=never` al comando siguiente.

**f) Reescribir:**

```bash
git filter-repo --strip-blobs-with-ids /tmp/blobs-a-borrar.txt --force
```

**g) Verificar ANTES de subir nada:**

```bash
git count-objects -vH | grep size-pack        # ~12 MiB con KEEP=1
git rev-list --count --all                    # debe seguir siendo 91
ls -lh ytmusic.apk                            # la última APK sigue en el árbol
git log --all --oneline -- ytmusic.apk | wc -l  # solo los KEEP commits conservados
python3 -m py_compile server.py database.py   # el código está intacto
```
Si el número de commits **no** es 91, parar y restaurar de la copia.

**h) Subir.** `filter-repo` borra el remoto a propósito, para que nadie suba sin
querer; hay que volver a añadirlo:

```bash
git remote add origin https://github.com/Ten1O0/YouTube-Music-Downloader.git
git push --force origin main
```

**i) Reparar los demás clones.** En el PC de Windows y en cualquier otra copia:

```bash
git fetch origin
git reset --hard origin/main
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```
Sin el `gc`, el clon conserva los objetos viejos y no recupera espacio.

**j) Anotar la fecha** de la poda al final de este documento, para saber cuándo
tocará la siguiente.

**Por qué** Recupera ~40 MiB de los 52 y deja el clon en un tamaño razonable, sin
renunciar a que la APK venga incluida. Los dos mp3 de prueba (6,8 MiB) son una
ganancia gratuita: no están en `HEAD` y no los quiere nadie.

**Cuándo repetirla:** cuando `git count-objects -vH` vuelva a incomodar. Al ritmo
actual —11 APK en 91 commits, ~10 MB cada una— eso es más o menos una vez al año.
No hace falta calendario; basta con mirar el tamaño de vez en cuando.

**Verificación** Clonar el repositorio ya subido en un directorio nuevo y
comprobar tres cosas: que pesa lo esperado, que `ytmusic.apk` está y se instala,
y que `git log --oneline | wc -l` da 91.

---

## 5. Orden de ejecución y commits

```
T1 → T2                (desbloqueo de macOS: sin esto no se puede verificar nada de lo demás)
T3 → T4                (despliegue predecible; T4 requiere el plan 03 T6)
T5 → T6 → T7           (higiene y documentación; T5 depende de que T2 funcione)
T8                     (tests de configuración; el de pinning, junto con T3)
T9                     (poda del historial: FUERA del PR, ver abajo)
```

**T9 no va en el PR.** Reescribe el historial, así que se hace con todo mergeado
y el repositorio en reposo — nunca en medio de una rama abierta. El orden natural
es: mergear el resto del plan, comprobar que todo funciona, y **entonces** podar.

T1 y T2 van primero porque **todas** las verificaciones de los demás bloques
pasan por poder compilar. T5 después de T2, porque dejar de versionar
`mobile/www/` solo es seguro cuando existe un script que la regenera.

**Coordinación con el plan 02:** T0 de ese plan mueve `data/` fuera del
directorio del sitio y cambia la unidad de systemd. T4 de este plan también toca
la unidad. Conviene hacer el plan 02 primero (es un incidente de seguridad) y
que T4 se construya sobre la unidad ya modificada.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **gunicorn con más de un worker rompe el progreso de las descargas** | **Alta si no se lee §2.1** | `--workers 1` con el porqué escrito en la propia unidad de systemd; prueba obligatoria de descarga completa |
| Cambiar a gunicorn sin el plan 03 T6: arranca sin BD ni `TEMP_DIR` | Alta | Dependencia declarada; si se adelanta el 04, traerse esa tarea |
| La primera compilación en macOS falla por `verification-metadata.xml` | **Media** | Documentado en T2, con el comando de regeneración |
| JDK incorrecto (21 en vez de 17) y Gradle falla sin explicar por qué | Media | T1 fija `temurin@17` y `JAVA_HOME` |
| Fijar versiones congela un `yt-dlp` que caducará | Alta (es seguro) | Ritual de actualización escrito en el README (§2.2) |
| **T9 deja el repositorio inservible y sin vuelta atrás** | Baja, **impacto alto** | Copia de seguridad completa antes de empezar (T9 paso b), verificación del número de commits antes de subir, y restaurar de la copia ante la mínima duda |
| **T9 desincroniza el clon del PC con Windows** | **Alta (es seguro)** | Está previsto: `git fetch && git reset --hard origin/main && git gc` (T9 paso i). Hay que hacerlo, no es opcional |
| T9 borra un commit al vaciarlo | Baja | Comprobado: ningún commit toca solo la APK. El paso e lo vuelve a verificar antes de reescribir |
| Alguien añade `*.apk` al `.gitignore` «por higiene» y el clon deja de traer la app | Media | Comentario explícito en `.gitignore` (T5) **y** test que falla en T8 |
| Borrar el `manifest.json` de la raíz y quedarse sin manifiesto si no hay build | Baja | `public/` se copia a `dist/` en cada build; y `deploy.sh` siempre sube `dist/` |

---

## 7. Definición de hecho

- [ ] `npm run sync:apk` produce una APK instalable **desde este portátil**.
- [ ] La APK generada arranca, busca, descarga y reproduce.
- [ ] `requirements.txt` tiene `==` en todas las líneas y el README explica cómo actualizar.
- [ ] `pip install -r requirements.txt` en un venv limpio reproduce el entorno del VPS.
- [ ] El `ExecStart` del servicio usa gunicorn con `--workers 1` (o se ha documentado que ya lo usaba).
- [ ] Una descarga completa con barra de progreso funciona tras el cambio a WSGI.
- [ ] `git ls-files | grep mobile/www` → vacío, y `git ls-files | grep ytmusic.apk` → **sigue apareciendo**.
- [ ] `https://music.dannarita.es/ytmusic.apk` sigue devolviendo 200.
- [ ] *(T9, aparte del PR)* `git count-objects -vH` baja de 52 MiB a ~12 MiB.
- [ ] *(T9)* `git rev-list --count --all` sigue dando 91 commits.
- [ ] *(T9)* Un clon nuevo trae `ytmusic.apk` y la APK se instala.
- [ ] *(T9)* El clon del PC con Windows está resincronizado.
- [ ] Existe **un** `manifest.json` en el repositorio.
- [ ] `mobile/README.md` ya no afirma que la APK carga la UI del VPS.
- [ ] Un cambio de CSS desplegado con `./deploy.sh` se ve en `music.dannarita.es` (hoy no, ver D6).
- [ ] `pytest test/backend/test_build_config.py` en verde; se ha comprobado que falla al añadir una dependencia sin versión.


---

## 8. Registro de ejecución (2026-09-21)

**T1 a T8 implementados. 450 tests en verde** (42 nuevos en
`test/backend/test_build_config.py`).

### 🔴 T4 no era innecesaria: había un bug vivo en producción

El plan decía comprobar primero si el `ExecStart` ya era gunicorn y, en ese
caso, cerrar la tarea. Sí lo era, pero con **`--workers 2`**:

```
ExecStart=.../gunicorn --workers 2 --bind 0.0.0.0:5000 server:app
```

Verificado: 3 procesos (1 master + 2 workers). Todo el estado vive en memoria
del proceso (`download_progress`, `download_cancellation`, `download_processes`,
los contadores de flask-limiter y, desde el plan 03, el hilo de barrido).

Consecuencia: una petición a `/api/progress/<id>` puede caer en el worker que no
lanzó esa descarga, y ese worker responde **404 `{'status': 'unknown'}`**. En el
cliente, `handlePollStatus` cae en `default:` y no hace nada, así que la barra
de progreso avanza **a tirones** en vez de romperse del todo. Por eso no se
notaba como avería.

Efectos secundarios del mismo problema: los límites de flask-limiter son el
doble de lo configurado, y con el plan 03 habría dos hilos de barrido.

El requisito de un solo worker queda **escrito en `server.py`**, junto a la
unidad completa que hay que poner. No basta con arreglarlo: hay que dejar dicho
por qué, o alguien lo sube a 4 dentro de seis meses.

### Otras cosas encontradas

**Los dos `manifest.json` ya habían divergido**, exactamente como preveía el
plan: `#0a0a0a` en la raíz contra `#0A0C0A` en `public/`. Gana `public/`, que es
el que coincide con el `theme-color` de `index.html`. Hay un test que compara
ambos valores.

**gunicorn 25.0.3 exige Python 3.10+.** Producción corre 3.12.3, pero el
`python3` de sistema de macOS es 3.9.6, así que `pip install -r
requirements.txt` falla en el portátil. No se bajan las versiones: se documenta
el mínimo en `requirements.txt` y en el README, y se deja
`test/requirements-test.txt` sin gunicorn para que la suite siga corriendo en
3.9.

**yt-dlp y yt-dlp-ejs van emparejados** y hay que fijarlos juntos. Es el
hallazgo de la sesión anterior convertido en invariante con test.

### Resumen por tarea

| Tarea | Qué quedó |
|---|---|
| T1 | Entorno de build de macOS documentado: node 20, JDK **17** (no 21+), command-line tools sin Android Studio |
| T2 | `sync-apk.sh` con comprobaciones previas, `--release`/`--no-build`, generación de `local.properties` y aviso sobre `verification-metadata.xml`. Expuesto como `npm run sync:apk` |
| T3 | 9 dependencias fijadas a las de producción, con el requisito de Python documentado |
| T4 | `app.run()` solo en `__main__`; la unidad correcta con `--workers 1 --threads 8` documentada en el código |
| T5 | `mobile/www/` fuera de git (`git rm --cached`); `ytmusic.apk` se mantiene, con el porqué escrito en `.gitignore` |
| T6 | `manifest.json` de la raíz eliminado; `deploy.sh` actualizado para subir `public/manifest.json` |
| T7 | `mobile/README.md` reescrito: offline-first, y corregida la afirmación falsa de que no hacía falta recompilar |
| T8 | 42 tests, incluido el de pinning verificado en negativo |

### Pendiente — requiere desplegar

| Qué | Dónde |
|---|---|
| **Cambiar la unidad a `--workers 1 --threads 8`** | VPS · `systemctl edit youtube-downloader` |
| Instalar `yt-dlp-ejs` y `flask-limiter` desde el requirements fijado | VPS |
| Compilar la APK con `npm run sync:apk` y probarla | Este Mac (falta node, JDK y SDK) |

⚠️ El cambio de workers es **independiente del despliegue de código** y se puede
aplicar ya: arregla la barra de progreso sin tocar nada más.
