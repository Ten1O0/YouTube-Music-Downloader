# 06 — Tests y CI

**Estado:** pendiente · **Prioridad:** 🔵 Estructural · **Depende de:** 01, 02, 03 (y de 04 T1 para ejecutar la parte JS en local)
**Puntos del análisis:** 14, 18 (+ dos hallazgos nuevos, ver D3 y D4)

> **Por qué va después de las correcciones:** no se escriben tests contra un
> comportamiento que los planes 01, 02 y 03 van a cambiar. Y va **antes** del 08,
> porque partir 7.400 líneas de `app.js` sin red debajo es apostar.

---

> ## ⚠️ Estado actualizado (2026-09-21)
>
> Este plan se redactó cuando el proyecto no tenía ni un test. Desde entonces
> existe `test/`, con **377 tests ejecutándose en verde** (293 de backend con
> pytest y 84 de frontend con el runner de Node).
>
> Eso deja **T3, T4 y T5 sustancialmente hechos**, con dos diferencias respecto
> a lo escrito aquí:
>
> | Lo planeado | Lo que hay |
> |---|---|
> | Directorio `tests/` | `test/`, con `backend/` y `frontend/` separados |
> | `requirements-dev.txt` | `test/requirements-test.txt` |
> | `pyproject.toml` | `test/pytest.ini` |
> | Sin tests de JS (faltaban `export`) | `test/frontend/harness.mjs` carga `app.js` en un contexto `vm` y permite probar la lógica pura **sin esperar al plan 08** |
>
> Al retomar este plan:
> - **T3, T4, T5**: revisar lo que ya hay y completar los huecos, en vez de
>   empezar de cero. En concreto faltan las salidas `YTDL_SKIP_BOOTSTRAP` y
>   `JWT_SECRET` de test, que dependen de los planes 02 y 03.
> - **T6 (CI)**: es lo que queda de verdad por hacer. El workflow debe ejecutar
>   `./test/run-tests.sh`, que ya encadena ambas suites.
> - **T7 (Playwright)**: intacto. Es lo único que puede cubrir el DOM, que el
>   arnés no alcanza.
> - **T1 y T2 (excepciones con nombre)**: intactos, y ahora con red de seguridad
>   debajo para refactorizar sin miedo.
>
> Los planes 02, 03, 04, 05 y 07 llevan desde ahora su propia tarea de tests, así
> que la cobertura crece con cada plan en lugar de acumularse aquí.

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | 17 `except Exception` genéricos | `server.py` | Esconden fallos reales y convierten errores distintos en el mismo 500 opaco |
| D2 | Cero tests y cero CI | todo el repositorio | Nada impide mergear código que no compila |
| D3 | **(nuevo)** `except Exception: pass` sin registrar nada | server.py:910 | El peor de los 17: si el parseo de progreso falla, la barra se congela y no queda rastro |
| D4 | **(nuevo)** Dos rutas usan `print()` en vez del logger | server.py:605, 624 | En systemd acaban en el journal sin nivel ni marca de tiempo estructurada |

### Inventario de los 17 `except Exception`

Clasificados por lo que deberían capturar de verdad:

| Líneas | Contexto | Qué puede fallar realmente | Veredicto |
|---|---|---|---|
| 146, 1168 | `cleanup_temp_folder`, `delete_download` | `OSError` (permisos, fichero en uso) | Concretar a `OSError` |
| 206, 737 | `get_playlist_count` (las dos copias; el plan 03 borra una) | `subprocess.TimeoutExpired`, `ValueError`, `OSError` | Concretar |
| 357 | `stream_file` | `OSError`, `ValueError` al parsear el `Range` | Concretar (+ `logger` indefinido → plan 03 T1) |
| 419, 488 | `search_youtube`, `get_playlist_info` | `subprocess.SubprocessError`, `json.JSONDecodeError` | Concretar |
| 538 | Terminar el proceso en `cancel_download` | `OSError`, `subprocess.SubprocessError` | Concretar |
| 605, 624 | `download_single_item`, `run_parallel_batch` | Cualquier cosa de un hilo trabajador | **Mantener amplio** + usar el logger |
| 660, 1012 | `run_parallel_batch`, `run_download_task` | Frontera de hilo | **Mantener amplio** + `app.logger.exception` |
| 786 | `prefetch_video_metadata` | Metadatos opcionales: fallar no es grave | **Mantener amplio**, ya avisa |
| **910** | `update_download_progress` | `ValueError`, `IndexError` al parsear | **Concretar y registrar**: hoy es `pass` |
| 1127 | `create_zip_from_folder` | `OSError`, `zipfile.BadZipFile` | Concretar |
| 1264, 1416 | Verificación del token de Google | `ValueError` (token inválido) vs. un fallo del servidor | **Concretar**: hoy un error interno se devuelve como «Invalid Google token» (401) |

La regla que sale de la tabla no es «prohibido `except Exception`», sino:

> **Amplio solo en fronteras de hilo o de tarea de fondo, y siempre registrando
> con `app.logger.exception`. En todo lo demás, la excepción concreta.**

Las dos capturas de la verificación de Google (1264, 1416) son el mejor ejemplo
de por qué importa: si `db.get_or_create_user` falla por un problema de SQLite, el
usuario recibe «Invalid Google token» y se pasa media hora reintentando el login.

### Qué tests dan más seguridad por menos esfuerzo

El análisis ya lo apuntaba: `validate_youtube_url`, `resolve_download_input` y
`safe_download_path`. Ampliado tras mirar el código, las funciones **puras** que
ya existen y son testeables sin tocar nada:

| Función | server.py | Por qué merece test |
|---|---|---|
| `safe_download_path` | 91 | Es la defensa contra path traversal de 4 rutas |
| `validate_youtube_url` | 106 | Distingue vídeo / playlist / shorts / mix; lleno de casos borde |
| `is_search_query` | 136 | Decide si algo es URL o búsqueda |
| `parse_video_json_output` | 215 | Parsea la salida de yt-dlp: se rompe cuando yt-dlp cambia |
| `parse_ytdlp_progress_line` | 857 | Idem, y su fallo es invisible hoy (D3) |
| `format_download_status` | 888 | Pura, trivial de cubrir |
| `build_ytdlp_download_cmd` | 790 | Congela el comando: detecta cambios accidentales de banderas |
| `build_playlist_cmd` | 424 | Idem, con la rama de mixes `RD` |
| `infer_title_from_folder` | 817 | Lógica de nombres con muchos casos raros |
| `resolve_download_input` | 742 | Orquesta tres de las anteriores |
| `sweep_stale_downloads` / `sweep_orphan_folders` | plan 03 T5 | Lo que evita que el servidor se llene: hay que probar que **no** barre lo activo |

Son once funciones sin efectos secundarios, sin red y sin estado global salvo
`TEMP_DIR`. Es donde está el 80 % del valor.

---

## 2. Decisiones de diseño

### 2.1 Qué se prueba y qué no

| Capa | Herramienta | ¿En este plan? |
|---|---|---|
| Funciones puras de `server.py` | `pytest` | ✅ Es el núcleo |
| `database.py` sobre SQLite en `tmp_path` | `pytest` | ✅ Barato y valioso |
| Rutas de Flask con `app.test_client()` y `subprocess` simulado | `pytest` + `monkeypatch` | ✅ |
| Llamadas reales a YouTube | — | ❌ **Nunca**: red en CI = CI que falla los viernes |
| Módulos de `app.js` | `vitest` | ⚠️ Solo infraestructura: **no hay nada que importar hasta el plan 08** |
| Recorrido completo en navegador | `playwright` | ✅ Bloque C, y es lo que da red al plan 08 |

### 2.2 El problema de gallina y huevo con la parte JS

El plan 08 depende de este para tener red de seguridad, pero **hoy `app.js` no
exporta nada**: se carga con `type="module"` y no tiene un solo `export`. No hay
forma de importar una función y probarla hasta que 08 la extraiga.

| Alternativa | Veredicto |
|---|---|
| Esperar a 08 y escribir tests después | ❌ Deja el refactor grande sin red, que es justo lo que se quería evitar |
| Extraer aquí unos pocos módulos para poder probarlos | ❌ Es hacer el plan 08 a medias y por la puerta de atrás |
| **Cubrir los recorridos críticos por fuera, con Playwright** | ✅ **Elegida**: no depende de la estructura interna, así que sobrevive intacto al refactor de 08 |

Ese es exactamente el tipo de test que protege una reorganización: comprueba que
la app **hace lo mismo**, sin saber cómo está organizada por dentro. Los tests
unitarios de JS llegan con 08, sobre los módulos que 08 cree.

### 2.3 CI: qué debe bloquear un merge

| Comprobación | ¿Bloquea? | Razón |
|---|---|---|
| `python -m py_compile` / `ruff check` | ✅ | Coste cero |
| `pytest` | ✅ | Es el objetivo del plan |
| `node --check app.js` | ✅ | Coste cero y ya se usa a mano (aparece en la definición de hecho del plan 01) |
| `npm run build` | ✅ | Un build roto es un despliegue roto |
| Playwright | ✅ tras estabilizarse | Empezar en modo aviso una semana; si es inestable, se ignora y no sirve de nada |
| Cobertura mínima | ❌ | Un porcentaje invita a escribir tests malos para subirlo |

---

## 3. Alcance

**Dentro:** `tests/` (nuevo), `pytest.ini`/`pyproject.toml`, `requirements-dev.txt`,
`.github/workflows/ci.yml`, la taxonomía de excepciones de `server.py` y la
configuración de `ruff`.

**Fuera:**
- Tests unitarios de los módulos de `app.js` → **plan 08**, que es quien los crea.
- Despliegue automático desde CI: este plan solo verifica, no despliega. Publicar
  la APK en un release desde CI se puede añadir después.
- Cambiar la lógica de negocio: si un test descubre un fallo, se anota y se
  arregla aparte. **Un plan de tests que además arregla cosas deja de poder
  demostrar que no rompió nada.**
- Tests de la parte nativa Android.

---

## 4. Tareas

### Bloque A — Excepciones con nombre

---

#### T1 · Jerarquía de excepciones del proyecto

**Ficheros:** `server.py` (nueva sección tras la configuración)

**Qué hacer**

```python
class DownloadError(Exception):
    """Fallo al descargar contenido. Mensaje apto para enseñar al usuario."""

class InvalidInputError(DownloadError):
    """La entrada del usuario no es una URL ni una búsqueda válida."""

class YtDlpError(DownloadError):
    """yt-dlp terminó con error, agotó su tiempo o devolvió algo no parseable."""
```

Y usarlas donde hoy hay `ValueError` genéricos: `resolve_download_input`
(server.py:752) lanza `ValueError('URL de YouTube no válida')`, que
`start_download` captura por tipo. Pasa a `InvalidInputError`, con el mismo
comportamiento visible.

**Por qué** Sin tipos propios, «entrada inválida del usuario» (→ 400) y «fallo
interno» (→ 500) son la misma excepción, y el manejador tiene que adivinar.

**Verificación** `python3 -m py_compile server.py` y las mismas respuestas HTTP
que antes para una URL inválida (400) y para una búsqueda válida (200).

---

#### T2 · Concretar los 17 `except Exception`

**Ficheros:** `server.py` (las 17 líneas de la tabla de §1)

**Qué hacer**

1. Recorrer la tabla y aplicar el veredicto de cada fila.
2. Caso especial, **el de la línea 910** (D3):

   ```python
   except (ValueError, IndexError, KeyError) as e:
       app.logger.debug(f"Línea de progreso no parseable ({e}): {line!r}")
   ```
   Nivel `debug`, no `warning`: yt-dlp emite líneas raras a menudo y no queremos
   ruido. Pero **algo** debe quedar registrado: hoy un cambio de formato de
   yt-dlp congela la barra de progreso y no deja ni una pista.

3. Caso especial, **las líneas 1264 y 1416** (Google):

   ```python
   except ValueError:
       # id_token.verify_oauth2_token lanza ValueError si el token no es válido
       app.logger.info("Token de Google rechazado")
       return jsonify({'error': 'Invalid Google token'}), 401
   except Exception:
       app.logger.exception("Fallo interno verificando el token de Google")
       return jsonify({'error': 'Error interno'}), 500
   ```

4. Sustituir los `print()` de 605 y 624 por `app.logger` (D4).

5. En las capturas amplias que se conservan, dejar un comentario diciendo por qué
   son amplias — frontera de hilo — para que no parezcan descuido.

6. Quitar el `as e` de las capturas donde `e` no se usa: hay varias, y `ruff` las
   marcará en T5.

**Por qué** Corrige D1, D3 y D4. El criterio está en §1: amplio solo en fronteras
de hilo, y siempre con traza.

**Verificación** `grep -c "except Exception" server.py` baja de 17 a las de las
fronteras de hilo (unas 5-6), y cada una tiene comentario. Provocar a mano un
fallo de SQLite durante el login y comprobar que devuelve **500**, no 401.

---

### Bloque B — Tests de Python

---

#### T3 · Esqueleto de pruebas

**Ficheros:** `requirements-dev.txt`, `pyproject.toml` (o `pytest.ini`), `tests/conftest.py`

**Qué hacer**

1. `requirements-dev.txt`:

   ```
   pytest==<…>
   pytest-cov==<…>
   ruff==<…>
   ```
   Con versiones fijas, igual que `requirements.txt` tras el plan 04 T3.

2. `tests/conftest.py` con lo que todos los tests necesitan:

   ```python
   import os, pytest

   os.environ.setdefault('JWT_SECRET', 'test-secret-only-for-tests')   # plan 02 T1 lo exige
   os.environ.setdefault('YTDL_SKIP_BOOTSTRAP', '1')                   # plan 02 T0 / plan 03 T6

   @pytest.fixture
   def client(tmp_path, monkeypatch):
       import server
       monkeypatch.setattr(server, 'TEMP_DIR', str(tmp_path / 'downloads'))
       os.makedirs(server.TEMP_DIR, exist_ok=True)
       server.app.config['TESTING'] = True
       with server.app.test_client() as c:
           yield c
   ```

   > ⚠️ Importar `server` ejecuta código a nivel de módulo: tras el plan 03 T6,
   > `bootstrap()` inicializa la BD y arranca el hilo de barrido. **Hace falta una
   > salida:** que `bootstrap()` no haga nada si `YTDL_SKIP_BOOTSTRAP` está
   > puesta. Es un cambio de dos líneas en `server.py` y pertenece a esta tarea.

3. `tests/` con un fichero por área: `test_urls.py`, `test_downloads.py`,
   `test_parsing.py`, `test_api.py`, `test_database.py`, `test_sweeper.py`.

**Por qué** La mitad del coste de empezar a testear un proyecto es decidir dónde
van las cosas y cómo se aísla el estado global. Resolverlo una vez, bien, hace
que cada test siguiente cueste cinco minutos.

**Verificación** `pytest` corre y recoge 0 tests sin errores de importación.

---

#### T4 · Tests de las funciones puras

**Ficheros:** `tests/test_urls.py`, `tests/test_parsing.py`, `tests/test_downloads.py`

**Qué hacer**

Cubrir las once funciones de la tabla de §1. Los casos que importan:

**`safe_download_path`** — es una defensa de seguridad, así que se prueba como tal:

```python
@pytest.mark.parametrize("bad", [
    "../etc/passwd", "..%2F..%2Fetc", "a/b", "a\\b", "", "x" * 40,
    "ABCDEF12",            # mayúsculas: el patrón es [a-f0-9]
    "../" * 10 + "tmp",
])
def test_rechaza_ids_peligrosos(bad):
    assert server.safe_download_path(bad) is None
```

**`validate_youtube_url`** — la matriz de casos reales:

| Entrada | Esperado |
|---|---|
| `https://www.youtube.com/watch?v=abc12345678` | `('video', 'abc12345678')` |
| `https://youtu.be/abc12345678` | `('video', …)` |
| `https://www.youtube.com/watch?v=X&list=PLxxx` | `('playlist', 'PLxxx')` |
| `https://www.youtube.com/watch?v=X&list=RDxxx` | `('playlist', 'RDxxx')` (mix) |
| `https://www.youtube.com/shorts/abc12345678` | `('shorts', …)` |
| `https://music.youtube.com/watch?v=…` | el que corresponda |
| `https://vimeo.com/123` | `(None, None)` |
| `no soy una url` | `(None, None)` |

**`parse_video_json_output`** — con salida real de yt-dlp guardada en
`tests/fixtures/`: una línea válida, una línea corrupta en medio (debe saltarse,
no abortar), un vídeo sin `id` (debe descartarse) y una entrada vacía.

**`parse_ytdlp_progress_line`** — con líneas reales, incluida alguna sin `ETA` y
alguna sin `at`, que son las ramas que hoy fallan en silencio.

**`build_ytdlp_download_cmd`** — test de instantánea: comprueba que el comando
contiene `--no-playlist` para un vídeo y **no** lo contiene para una playlist, y
que las banderas sensibles (`--remote-components`, tras la decisión del plan 02
T6) están o no están **a propósito**.

**Por qué** Son las funciones que se rompen solas cuando yt-dlp cambia de
formato, que es el riesgo número uno de este proyecto tras fijar la versión
(plan 04 §2.2).

**Verificación** `pytest tests/ -v` en verde. Romper a propósito una regex de
`validate_youtube_url` y comprobar que algún test se pone rojo.

---

#### T5 · Tests de rutas y de base de datos

**Ficheros:** `tests/test_api.py`, `tests/test_database.py`, `tests/test_sweeper.py`

**Qué hacer**

1. **Rutas**, con `subprocess.run` simulado para no tocar la red:

   ```python
   def test_search_requiere_query(client):
       assert client.post('/api/search', json={}).status_code == 400

   def test_search_query_corta(client):
       assert client.post('/api/search', json={'query': 'a'}).status_code == 400

   def test_progress_id_invalido(client):
       assert client.get('/api/progress/../etc').status_code in (400, 404)
   ```

   Y las de seguridad del plan 02, que son las que más conviene congelar:

   ```python
   def test_no_sirve_la_base_de_datos(client):
       assert client.get('/data/youtube_downloader.db').status_code == 404

   def test_no_sirve_el_codigo_fuente(client):
       assert client.get('/server.py').status_code == 404

   def test_endpoints_de_usuario_exigen_token(client):
       assert client.get('/api/user/favorites').status_code == 401
   ```

   > Estos tres son el corazón del plan: convierten el incidente D0 del plan 02 en
   > algo que **no puede volver a pasar sin que CI lo cante**.

2. **Base de datos**, sobre un SQLite en `tmp_path`: crear usuario, añadir
   historial, añadir favorito, quitarlo, `sync_user_data` con solapamiento (el
   caso que el plan 01 identificó como delicado) y `get_or_create_user` llamado
   dos veces con el mismo correo.

3. **Barrido** (plan 03 T5), con el reloj simulado:

   ```python
   def test_no_barre_descargas_activas(monkeypatch):
       ...  # status='downloading' y updated_at antiguo → NO se toca
   def test_barre_descargas_terminadas_y_viejas(monkeypatch):
       ...
   def test_barre_carpetas_huerfanas(tmp_path):
       ...
   ```

**Por qué** Son las dos áreas donde un fallo es caro: la seguridad (que acaba de
costar una exposición de datos) y el ciclo de vida (que acaba de costar un plan
entero). Un test es más barato que volver a descubrirlo.

**Verificación** `pytest` en verde. Revertir a mano `static_folder=None` →
`static_folder='.'` y comprobar que `test_no_sirve_la_base_de_datos` se pone rojo.

---

### Bloque C — CI y recorridos críticos

---

#### T6 · Workflow de GitHub Actions

**Ficheros:** `.github/workflows/ci.yml` (nuevo), `pyproject.toml` (configuración de ruff)

**Qué hacer**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: ruff check .
      - run: pytest -v
        env:
          JWT_SECRET: test-secret-only-for-tests

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm }
      - run: npm ci
      - run: node --check app.js
      - run: npm run build
```

Notas:

- **La versión de Python del runner debe ser la del VPS.** Comprobarlo con
  `ssh "$VPS" "python3 --version"` antes de escribir el `python-version`; este
  portátil tiene la 3.9.6 del sistema, que probablemente no sea la de producción.
- `npm ci` exige `package-lock.json`, que **sí** está versionado. ✅
- `ruff` mínimo, sin pelearse con el estilo existente:

  ```toml
  [tool.ruff]
  line-length = 120
  [tool.ruff.lint]
  select = ["E", "F", "B", "S"]   # errores, pyflakes, bugbear, seguridad
  ignore = ["E501"]
  ```
  `S` (bandit) es el que hubiera cantado el `static_folder='.'`; merece la pena
  aunque haya que silenciar falsos positivos al principio.

**Por qué** Corrige D2. Es lo que convierte todo lo anterior en una red real: un
test que nadie ejecuta no protege de nada.

**Verificación** Abrir un PR de prueba con un error de sintaxis en `app.js` y
comprobar que CI lo bloquea. Y otro con un `pytest` roto.

---

#### T7 · Recorridos críticos con Playwright

**Ficheros:** `tests/e2e/` (nuevo), `playwright.config.ts`, `.github/workflows/ci.yml`

**Qué hacer**

1. Levantar el backend con `yt_dlp` simulado (un módulo de prueba que devuelva
   JSON fijo y escriba un `.m4a` de un segundo en la carpeta de descarga), servir
   el frontend con `vite preview` y apuntar Playwright ahí.

2. Cubrir **solo** los recorridos que el plan 08 puede romper:

   | # | Recorrido | Por qué |
   |---|---|---|
   | 1 | Buscar → aparecen resultados | Búsqueda + render |
   | 2 | Descargar una canción → entra en la biblioteca | El camino principal completo |
   | 3 | Recargar la página → la canción sigue ahí y **suena** | El bug nº 1 del análisis, congelado para siempre |
   | 4 | Marcar ♥ → recargar → sigue marcado | Los bugs 2 y 16 del plan 01 |
   | 5 | Crear playlist → añadir canción → abrirla | `PlaylistModule` entero |
   | 6 | Reproducir, pausar, siguiente | `PlayerModule` y la cola |
   | 7 | Cambiar de idioma → los avisos salen traducidos | El plan 05 |

3. Empezar en modo aviso (`continue-on-error: true`) y pasarlo a bloqueante
   cuando lleve una semana estable.

**Por qué** Es la red que el plan 08 necesita (§2.2). Los siete recorridos no
saben nada de cómo está organizado `app.js`, así que **siguen valiendo después
del refactor**: son la definición ejecutable de «la app hace lo mismo que antes».

El escenario 3 merece mención aparte: es exactamente el fallo que el plan 01
persiguió, y tenerlo como test significa que no puede volver sin avisar.

**Coste honesto:** es la tarea más cara del plan, probablemente más que el
bloque B entero. Si hay que recortar, se recorta a los recorridos 2, 3 y 4, que
son los que cubren pérdida de datos. Lo que **no** se debe hacer es empezar el
plan 08 sin ninguno de ellos.

**Verificación** `npx playwright test` en verde en local y en CI. Romper a
propósito `resolveStreamSrc` y comprobar que el escenario 3 se pone rojo.

---

## 5. Orden de ejecución y commits

```
T1 → T2                 (excepciones: se puede mergear solo)
T3 → T4 → T5            (tests de Python: el grueso del valor)
T6                      (CI: en cuanto haya algo que ejecutar)
T7                      (Playwright: el más caro, el último)
```

T6 conviene adelantarlo en cuanto T4 tenga unos pocos tests: un CI que corre
`ruff` y cuatro tests ya empieza a pagar. T2 antes de T4 porque cambiar
excepciones después de escribir los tests obliga a reescribirlos.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Importar `server` en los tests arranca el barrido y la BD | **Alta** | `YTDL_SKIP_BOOTSTRAP` en T3; es la primera cosa que hay que resolver |
| Concretar excepciones deja un fallo sin capturar y tumba una ruta | Media | Fronteras de hilo con captura amplia; T2 se hace **antes** de los tests, y los tests lo verifican después |
| Los tests de Playwright son inestables y se acaban ignorando | **Alta** | Modo aviso una semana; si siguen inestables, reducir a los recorridos 2, 3 y 4 en vez de desactivarlos |
| El `yt_dlp` simulado se desvía del real y los tests aprueban lo que falla | Media | Las fixtures de T4 salen de salida **real** capturada, no inventada |
| La versión de Python del runner no es la del VPS | Media | Comprobar con `ssh "$VPS" "python3 --version"` antes de escribir el workflow |
| `ruff` marca cientos de avisos en el código existente y se desactiva | Media | Empezar con `select` corto (E, F, B, S) y `ignore = ["E501"]` |

---

## 7. Definición de hecho

- [ ] `grep -c "except Exception" server.py` ≤ 6, y cada una tiene comentario justificando por qué es amplia.
- [ ] No queda ningún `except Exception: pass` ni `print(` en `server.py`.
- [ ] Un fallo interno durante el login devuelve 500, no 401.
- [ ] `pytest` recoge y pasa los tests de las once funciones puras.
- [ ] Existen los tres tests de seguridad (BD, código fuente, endpoints con token) y fallan si se revierte el plan 02.
- [ ] Existen los tres tests del barrido y fallan si se revierte el plan 03.
- [ ] `ruff check .` pasa.
- [ ] CI bloquea un PR con `app.js` sintácticamente roto y otro con un test roto.
- [ ] Los siete recorridos de Playwright pasan (o los tres mínimos, si se recortó).
- [ ] El `README.md` explica cómo ejecutar los tests en local.
