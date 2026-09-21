# Suite de tests

Red de seguridad del proyecto. El objetivo es no volver a probar a mano todas
las funciones cada vez que se toca algo.

## Cómo ejecutarlos

### Todo de una vez

```bash
./test/run-tests.sh
```

### Solo backend (Python)

Necesita un entorno virtual con las dependencias de test:

```bash
python3 -m venv .venv
.venv/bin/pip install -r test/requirements-test.txt
.venv/bin/python -m pytest test/backend/ -v
```

Atajos útiles:

```bash
.venv/bin/python -m pytest test/backend/ -q                    # resumen
.venv/bin/python -m pytest test/backend/test_auth_jwt.py       # un fichero
.venv/bin/python -m pytest test/backend/ -k "traversal"        # por nombre
.venv/bin/python -m pytest test/backend/ -m "" -rx             # ver los xfail
```

### Solo frontend (JavaScript)

Requiere **Node 18 o superior**. No hay dependencias que instalar: usa el
runner integrado de Node.

```bash
node --test test/frontend/
```

> ⚠️ Este portátil no tiene Node instalado. `brew install node` lo resuelve.
> La suite se verificó ejecutándola con el Node del VPS.

## Qué cubre

| Fichero | Tests | Qué verifica |
|---|---|---|
| `backend/test_url_validation.py` | 48 | Validación de URLs de YouTube, detección de búsquedas, inyección de shell |
| `backend/test_path_security.py` | 53 | Path traversal en `safe_download_path` y en todos los endpoints que lo usan |
| `backend/test_progress_parsing.py` | 33 | Parseo del progreso de yt-dlp y estado de cancelación |
| `backend/test_download_helpers.py` | 56 | Resolución de entrada, comandos de yt-dlp, JSON, ZIP, ficheros |
| `backend/test_auth_jwt.py` | 32 | Emisión y validación de tokens, incluidos ataques (alg=none, firma alterada) |
| `backend/test_database.py` | 49 | Usuarios, historial, favoritos, sync, aislamiento entre cuentas, inyección SQL |
| `backend/test_api_endpoints.py` | 39 | Contrato HTTP: códigos, validación, Range, CORS |
| `backend/test_static_exposure.py` | 20 | Qué ficheros sirve el servidor (**hallazgo crítico**, ver abajo) |
| `frontend/test_utils.mjs` | 37 | Nombres de fichero, duraciones, IDs de vídeo, base64 |
| `frontend/test_plan01_datos.mjs` | 47 | Toda la lógica del plan 01: migración, caché de audio, resolución de src |

**Total: 293 backend + 84 frontend = 377 tests.**

## Tests marcados `xfail`

Un `xfail` no es un test roto: describe el comportamiento **correcto** de algo
que hoy está mal. Falla a propósito mientras el fallo siga ahí y **pasa solo**
cuando se arregle, así que sirve de aviso de que el trabajo está hecho.

Los 16 actuales documentan bugs reales, todos del plan 02:

| Qué describe | Gravedad |
|---|---|
| `test_static_exposure.py` — el servidor publica su código fuente y `data/` | 🔴 **Crítico** |
| `test_url_validation.py` — SSRF: se acepta cualquier host que contenga el patrón | 🟠 Alto |
| `test_api_endpoints.py` — CORS refleja cualquier `Origin` | 🟠 Alto |
| `test_auth_jwt.py` — `JWT_SECRET` tiene valor por defecto en el código | 🟠 Alto |

## ⚠️ Hallazgo crítico encontrado al escribir estos tests

```python
app = Flask(__name__, static_folder='.', static_url_path='')
```

Publica **el directorio del proyecto entero** en la raíz del dominio.
Verificado contra producción el 2026-09-21:

```
GET https://music.dannarita.es/server.py                  -> 200
GET https://music.dannarita.es/database.py                -> 200
GET https://music.dannarita.es/requirements.txt           -> 200
GET https://music.dannarita.es/data/youtube_downloader.db -> 200   ← 5,3 MB
```

El último es la base de datos SQLite completa: correos, nombres, fotos de
perfil de Google, historial de descargas y favoritos de todos los usuarios,
descargable sin autenticación. `server.py` además expone el valor por defecto
de `JWT_SECRET`.

Está capturado en `backend/test_static_exposure.py`.

> Nota sobre los 4 `XPASS`: los tests de `/data/...` y `/.env` pasan en local
> porque esos ficheros **no existen en el portátil** (`data/` está en
> `.gitignore` y solo existe en el VPS), así que el servidor devuelve 404.
> En producción fallarían. La comprobación que sí detecta el problema en
> cualquier entorno es `test_static_folder_should_not_be_the_project_root`,
> que mira la causa raíz en lugar de un fichero concreto.

## Convenciones

- **Un fichero por área**, nombres de test en castellano y descriptivos: el
  nombre debe explicar qué se rompe si el test falla.
- **Aislamiento total**: cada test usa una base de datos SQLite temporal y un
  `TEMP_DIR` propio. Ningún test puede tocar `data/youtube_downloader.db`.
- **Nada de red**: no se llama a yt-dlp ni a YouTube. Lo que depende de
  procesos externos se sustituye con `monkeypatch`.
- **Los xfail llevan `reason`** explicando el porqué y a qué plan pertenecen.

## Limitaciones conocidas

**El frontend solo se puede testear parcialmente.** `app.js` son 7.100 líneas
en un único fichero, sin exports, con IIFEs y acceso al DOM en el nivel
superior. `frontend/harness.mjs` lo carga en un contexto `vm` con un navegador
simulado y publica sus funciones globales, lo que permite probar toda la
**lógica pura**; pero lo que depende del DOM (renderizado, listeners, vistas)
no es alcanzable así.

Esa parte sigue necesitando el guion manual de `docs/planes/01-*.md` (T11), y
es el argumento más concreto a favor del **plan 08** (modularización): cuando
`app.js` se parta en módulos ES, el arnés desaparece y esos tests se podrán
escribir normalmente.

Tampoco se cubre todavía: el flujo real de descarga con yt-dlp, el camino
nativo de Capacitor (necesita emulador) y el service worker.

## Cómo añadir un test

1. Elige el fichero del área correspondiente, o crea uno nuevo `test_<area>.py`.
2. Usa las fixtures de `conftest.py` (`srv`, `client`, `db`, `user`, `temp_dir`…).
3. Si documentas un bug conocido, márcalo `xfail` con su `reason` y el plan.
4. Ejecuta la suite entera antes de dar el trabajo por terminado.
