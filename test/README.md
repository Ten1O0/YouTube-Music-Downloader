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
node --test test/frontend/*.mjs
```

> El glob explícito no es opcional: los ficheros se llaman `test_*.mjs` y Node,
> al recibir un directorio, solo recoge los que encajan con su convención
> (`*.test.mjs`).

### Estilo (ruff)

```bash
.venv/bin/ruff check .
```

Configurado en `pyproject.toml` con `E`, `F`, `B` y `S` (seguridad). Los
silenciados llevan justificación en la propia línea: los `subprocess` del
proyecto pasan listas de argumentos, nunca cadenas de shell.

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

| `backend/test_rate_limiting.py` | 20 | Límites por IP, exenciones y `ProxyFix` |
| `backend/test_download_registry.py` | 35 | Ciclo de vida, barrido y arranque |
| `backend/test_download_events.py` | 24 | Registro de uso, anónimo y autenticado |
| `backend/test_build_config.py` | 42 | Invariantes del build y del despliegue |
| `frontend/test_i18n.mjs` | 26 | Paridad de claves, idioma del navegador, formato |

**Total: 482 backend + 110 frontend = 592 tests**, más 7 recorridos end-to-end.

## Recorridos end-to-end (Playwright)

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Levantan el backend real con un **`yt_dlp` simulado** (`test/e2e/fake_ytdlp/`)
que devuelve metadatos fijos y escribe un WAV de un segundo. Las descargas son
instantáneas, deterministas y no tocan la red.

Los siete recorridos están escritos contra lo que el usuario ve, no contra la
estructura interna de `app.js`, así que **siguen valiendo después del plan 08**.

| # | Recorrido |
|---|---|
| 1 | Buscar → aparecen resultados |
| 2 | Descargar → entra en la biblioteca |
| 3 | **Recargar → la canción sigue ahí y suena** |
| 4 | Marcar ♥ → recargar → sigue marcado |
| 5 | Crear playlist → añadir canción → abrirla |
| 6 | Reproducir, pausar, siguiente |
| 7 | Cambiar de idioma → los avisos se traducen |

El 3 es el fallo que persiguió el plan 01: la biblioteca dejaba de sonar al
recargar. Tenerlo aquí significa que no puede volver sin que nadie se entere.

> ⚠️ **Sin ejecutar todavía.** Playwright necesita Node y una descarga de
> navegador, y este portátil no tiene Node instalado. Lo que **sí** está
> verificado es el arnés: el servidor con el `yt_dlp` simulado completa
> búsqueda, descarga, progreso y entrega del fichero de principio a fin.
> En CI arrancan en modo aviso (`continue-on-error`) hasta que lleven una
> semana estables.

## Integración continua

`.github/workflows/ci.yml` ejecuta tres trabajos en cada push a `main` y en
cada pull request:

| Trabajo | Qué hace |
|---|---|
| `backend` | `ruff check .` + `pytest` con Python **3.12** (la del VPS) |
| `frontend` | `node --check app.js` + `node --test` + `npm run build` |
| `e2e` | Playwright, en modo aviso |

## Tests marcados `xfail`

Un `xfail` no es un test roto: describe el comportamiento **correcto** de algo
que hoy está mal. Falla a propósito mientras el fallo siga ahí y **pasa solo**
cuando se arregle, así que sirve de aviso de que el trabajo está hecho.

**Ahora mismo no queda ninguno**: los 16 que había describían defectos del
plan 02 (exposición de ficheros, SSRF, CORS abierto y secreto por defecto) y
todos están corregidos, con sus tests convertidos en protección de regresiones.

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
