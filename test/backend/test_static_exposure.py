"""
Qué ficheros sirve el servidor como estáticos.

HALLAZGO CRÍTICO — CORREGIDO en el plan 02 T0 (2026-09-21)
===========================================================

Estos tests protegen de que vuelva. El problema era:

    app = Flask(__name__, static_folder='.', static_url_path='')

Eso publica **el directorio del proyecto entero** en la raíz del dominio.
Comprobado contra https://music.dannarita.es:

    /server.py                   -> 200  (código fuente, con el JWT_SECRET por defecto)
    /database.py                 -> 200  (código fuente)
    /requirements.txt            -> 200
    /data/youtube_downloader.db  -> 200  (BASE DE DATOS DE USUARIOS COMPLETA)

La base de datos contiene correos, nombres, fotos de perfil de Google,
historial de descargas y favoritos de todos los usuarios registrados, y
cualquiera puede descargarla sin autenticación.

Arreglo (plan 02):
    1. `static_folder=None` y servir los estáticos con rutas explícitas
       (index, download, sw.js, manifest, favicon y /assets/ ya existen).
    2. Mover `data/` fuera del directorio servido.
    3. Bloquear en nginx como red de seguridad.

Corregido con `static_folder=None` + lista blanca explícita (`PUBLIC_FILES`)
y `YTDL_DATA_DIR` para sacar la base de datos del directorio servido.

⚠️  El código está corregido pero **aún no desplegado**: en producción la
exposición sigue activa hasta que se suba.
"""

import pytest


# ========================================
# Lo que SÍ debe servirse
# ========================================

def test_root_serves_the_frontend(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "html" in resp.content_type.lower()


def test_download_page_is_served(client):
    resp = client.get("/download")
    assert resp.status_code == 200
    assert "html" in resp.content_type.lower()


def test_service_worker_is_served_with_no_cache(client):
    resp = client.get("/sw.js")
    assert resp.status_code == 200
    assert "javascript" in resp.content_type.lower()
    assert "no-cache" in resp.headers.get("Cache-Control", "").lower()


def test_service_worker_scope_header(client):
    """Sin esta cabecera el SW no puede controlar toda la raíz del sitio."""
    resp = client.get("/sw.js")
    assert resp.headers.get("Service-Worker-Allowed") == "/"


def test_manifest_is_served_as_json(client):
    resp = client.get("/manifest.json")
    assert resp.status_code == 200
    assert "json" in resp.content_type.lower()
    assert resp.get_json()["name"]


def test_favicon_is_served_as_png(client):
    resp = client.get("/favicon.png")
    assert resp.status_code == 200
    assert "image/png" in resp.content_type.lower()


def test_unknown_asset_is_404(client):
    assert client.get("/assets/no-existe-12345.js").status_code == 404


# ========================================
# Lista blanca de ficheros públicos (T0b)
# ========================================

def test_whitelisted_files_are_still_served(client):
    """Lo que index.html pide fuera del bundle de Vite."""
    assert client.get("/Sortable.min.js").status_code == 200, "/Sortable.min.js dejó de servirse"


@pytest.mark.parametrize("ruta", ["/app.js", "/styles.css"])
def test_sources_are_not_served_raw(client, ruta):
    """Sin build no hay web: el código fuente no se publica suelto."""
    assert client.get(ruta).status_code == 404


def test_apk_is_still_downloadable(client, srv):
    """El botón de descarga de download.html apunta a /ytmusic.apk."""
    import os
    if not os.path.exists(srv.APK_PATH):
        pytest.skip("releases/ytmusic.apk no está presente en este entorno")
    assert client.get("/ytmusic.apk").status_code == 200


def test_whitelist_is_a_closed_set(srv):
    """
    Lista blanca, no negra: añadir un fichero al repositorio no debe publicarlo.
    """
    assert isinstance(srv.PUBLIC_FILES, frozenset)
    assert "server.py" not in srv.PUBLIC_FILES
    assert "database.py" not in srv.PUBLIC_FILES


@pytest.mark.parametrize("ruta", [
    "/conftest.py", "/deploy.sh", "/README.md", "/sync-apk.bat",
    "/test/conftest.py", "/docs/planes/INDEX.md",
])
def test_files_outside_the_whitelist_are_404(client, ruta):
    assert client.get(ruta).status_code == 404, f"{ruta} es descargable"


# ========================================
# Lo que NO debe servirse
# ========================================

CODIGO_FUENTE = ["/server.py", "/database.py", "/requirements.txt"]

DATOS_SENSIBLES = [
    "/data/youtube_downloader.db",
    "/data/youtube_downloader.db-wal",
    "/data/youtube_downloader.db-shm",
]

CONFIGURACION = ["/.gitignore", "/package.json", "/vite.config.js", "/.env"]


@pytest.mark.parametrize("ruta", CODIGO_FUENTE)
def test_backend_source_must_not_be_downloadable(client, ruta):
    """
    `/server.py` incluye el valor por defecto de JWT_SECRET. Si la variable
    de entorno no está puesta en el VPS, quien lo descargue puede firmar
    tokens válidos de cualquier usuario.
    """
    assert client.get(ruta).status_code == 404, f"{ruta} es descargable"


@pytest.mark.parametrize("ruta", DATOS_SENSIBLES)
def test_user_database_must_not_be_downloadable(client, ruta):
    """
    Verificado en producción: /data/youtube_downloader.db responde 200 con
    application/octet-stream. Son los datos personales de todos los usuarios.
    """
    assert client.get(ruta).status_code == 404, f"{ruta} es descargable"


@pytest.mark.parametrize("ruta", CONFIGURACION)
def test_config_files_must_not_be_downloadable(client, ruta):
    assert client.get(ruta).status_code == 404, f"{ruta} es descargable"


def test_virtualenv_must_not_be_downloadable(client):
    assert client.get("/.venv/pyvenv.cfg").status_code == 404


# ========================================
# Invariante que debe cumplirse siempre
# ========================================

def test_no_python_source_is_served_under_any_route(client):
    """Red de seguridad genérica: ninguna ruta debe devolver código Python."""
    expuestos = [
        ruta for ruta in CODIGO_FUENTE
        if client.get(ruta).status_code == 200
    ]
    assert expuestos == [], f"Código fuente expuesto: {expuestos}"


def test_static_folder_is_disabled(srv):
    """
    La causa raíz, en una sola comprobación: si `static_folder` volviera a
    apuntar al directorio del proyecto, cualquier fichero nuevo del repositorio
    quedaría publicado automáticamente.
    """
    assert srv.app.static_folder is None, (
        "static_folder debe ser None; cualquier otro valor reabre la exposición"
    )
