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

| Carpeta | Tests | Qué verifica |
|---|---|---|
| `backend/` | 516 | La API y el servidor: validación de entradas, *path traversal*, JWT, base de datos, descargas y su progreso, límites por IP, qué ficheros se sirven y los invariantes del build y del despliegue |
| `frontend/` | 401 | El cliente: la lógica de datos del plan 01, idiomas, movimiento, hojas y navegación, hápticos, la página de la app, la estructura en módulos y el entorno |
| `e2e/` | 22 | Recorridos completos en Chromium contra el servidor real |

Los de frontend son de tres clases:

- **Módulos puros**, que se importan directamente: los de `frontend/src/ui/`
  (muelles, gestos, paleta, carátulas…), `config/env.js` y la página de la app.
- **El cliente entero en un navegador simulado**, con `harness.mjs`: favoritos,
  historial, sincronización, idioma. Cada `loadApp()` arranca un mundo nuevo
  con su propio `localStorage`, `fetch` y Capacitor.
- **El código como texto** (`fuentes.mjs` junta los módulos de `frontend/src/`):
  reglas que no se ejecutan, como que la base no importe funciones de la app o
  que no vuelvan los radios sueltos.

## Recorridos end-to-end (Playwright)

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Levantan el backend real con un **`yt_dlp` simulado** (`test/e2e/fake_ytdlp/`)
que devuelve metadatos fijos y escribe un WAV de un segundo. Las descargas son
instantáneas, deterministas y no tocan la red.

Están escritos contra lo que el usuario ve (botones, textos y el elemento de
audio), no contra la organización del código. Por eso sirvieron para
comprobar que la modularización del plan 08 no cambiaba nada.

| # | Recorrido |
|---|---|
| 1 | Buscar → aparecen resultados |
| 2 | Descargar → entra en la biblioteca |
| 3 | **Recargar → la canción sigue ahí y suena** |
| 4 | Marcar ♥ → recargar → sigue marcado |
| 5 | Crear playlist → añadir canción → abrirla |
| 6 | Reproducir, pausar, siguiente |
| 7 | Cambiar de idioma → los avisos se traducen |
| 8, 9, 14 | Avisos de descarga: banner en escritorio, isla en el móvil, pila |
| 10–13, 15, 18 | Reproductor a pantalla completa: vuelo, arrastre, respiración, letras, «Reducir movimiento», recogerlo al cambiar de sección |
| 16, 17 | Hoja de «Añadir a playlist» y botón que dice el formato |
| 19 | La sesión del sistema: carátula cuadrada y pausa desde fuera |
| 20–22 | Hoja de la cola, volumen y silencio, editar una lista y añadirle canciones |

El 3 es el fallo que persiguió el plan 01: la biblioteca dejaba de sonar al
recargar. Tenerlo aquí significa que no puede volver sin que nadie se entere.

Los 20 a 22 se escribieron antes de partir el reproductor y las listas en
módulos, y se comprobaron también contra la versión anterior: describen el
comportamiento original, no el nuevo.

En CI arrancan en modo aviso (`continue-on-error`).

## Integración continua

`.github/workflows/ci.yml` ejecuta tres trabajos en cada push a `main` y en
cada pull request:

| Trabajo | Qué hace |
|---|---|
| `backend` | `ruff check .` + `pytest` con Python **3.12** (la del VPS) |
| `frontend` | ESLint + `node --test` + `npm run build` |
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

No se cubren todavía el flujo real de descarga con yt-dlp (los recorridos usan
uno simulado), el camino nativo de Capacitor (necesita el emulador) ni el
service worker.

## Cómo añadir un test

1. Elige el fichero del área correspondiente, o crea uno nuevo `test_<area>.py`.
2. Usa las fixtures de `conftest.py` (`srv`, `client`, `db`, `user`, `temp_dir`…).
3. Si documentas un bug conocido, márcalo `xfail` con su `reason` y el plan.
4. Ejecuta la suite entera antes de dar el trabajo por terminado.
