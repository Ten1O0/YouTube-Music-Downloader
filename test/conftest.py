"""
Fixtures compartidas para toda la suite.

Cada test corre contra una base de datos y un TEMP_DIR aislados y efímeros:
ninguna prueba puede tocar `data/youtube_downloader.db` ni el temporal real.
"""

import importlib
import os
import sys
import threading

import pytest

# La raíz del proyecto tiene que estar en sys.path para poder importar server/database
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

# server.py aborta si JWT_SECRET no está definida (plan 02, T1). Se fija aquí,
# antes de cualquier import, con un valor de pruebas que nunca sale de la suite.
os.environ.setdefault('JWT_SECRET', 'secreto-solo-para-tests-no-usar-en-produccion')

# Importar server ejecuta bootstrap() (plan 03, T6), que inicializa la base de
# datos real, purga TEMP_DIR y arranca el hilo de barrido. En tests nada de eso
# debe ocurrir: cada test monta su propio entorno aislado.
os.environ.setdefault('YTDL_SKIP_BOOTSTRAP', '1')


def make_download_id(seed='a'):
    """
    Genera un download_id con el formato actual (32 hex).
    Centralizado aquí para que un cambio de formato se toque en un solo sitio.
    """
    return (seed * 32)[:32]


# ========================================
# Base de datos aislada
# ========================================

@pytest.fixture
def db(tmp_path):
    """
    Módulo `database` apuntando a un SQLite temporal, ya inicializado.

    Se reimporta el módulo para que DATA_DIR/DB_PATH se puedan redirigir sin
    arrastrar estado entre tests.
    """
    import database as db_module
    importlib.reload(db_module)

    data_dir = tmp_path / "data"
    data_dir.mkdir()

    db_module.DATA_DIR = str(data_dir)
    db_module.DB_PATH = str(data_dir / "test.db")
    db_module.init_db()

    yield db_module


@pytest.fixture
def user(db):
    """Un usuario ya creado, listo para colgarle historial y favoritos."""
    return db.get_or_create_user("test@example.com", "Test User", "http://pic")


@pytest.fixture
def other_user(db):
    """Segundo usuario, para comprobar que los datos no se cruzan entre cuentas."""
    return db.get_or_create_user("otro@example.com", "Otro", "")


# ========================================
# Servidor Flask
# ========================================

@pytest.fixture
def srv():
    """El módulo `server` importado (la app Flask y sus funciones sueltas)."""
    import server as server_module
    return server_module


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """
    El limitador guarda los contadores en memoria y la app es global, así que
    sin esto los tests se irían gastando la cuota unos a otros y empezarían a
    recibir 429 según crece la suite.
    """
    try:
        import server as server_module
        server_module.limiter.reset()
    except (ImportError, AttributeError) as e:
        # El limitador puede no existir todavía en un import a medias
        print(f"[conftest] No se pudo reiniciar el limitador: {e}")
    yield


@pytest.fixture
def temp_dir(srv, tmp_path, monkeypatch):
    """TEMP_DIR redirigido a un directorio temporal. Devuelve su Path."""
    d = tmp_path / "downloads"
    d.mkdir(exist_ok=True)
    monkeypatch.setattr(srv, "TEMP_DIR", str(d))
    return d


@pytest.fixture
def client(srv, temp_dir):
    """
    Cliente de pruebas de Flask con TEMP_DIR ya redirigido (vía `temp_dir`)
    y los diccionarios de estado global limpios antes y después.
    """
    srv.download_progress.clear()
    srv.download_cancellation.clear()
    srv.download_processes.clear()

    srv.app.config["TESTING"] = True
    with srv.app.test_client() as c:
        yield c

    srv.download_progress.clear()
    srv.download_cancellation.clear()
    srv.download_processes.clear()


@pytest.fixture
def auth_headers(srv, user):
    """Cabecera Authorization válida para el usuario de pruebas."""
    token = srv.create_jwt_token(user["id"])
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def authed_client(client, srv, db, user, monkeypatch):
    """
    Cliente con sesión iniciada: el módulo `db` que usa server apunta a la
    base de datos temporal y las peticiones llevan token válido.
    """
    monkeypatch.setattr(srv, "db", db)
    token = srv.create_jwt_token(user["id"])
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client


# ========================================
# Utilidades
# ========================================

@pytest.fixture
def make_audio_files():
    """Crea ficheros de audio falsos dentro de un directorio."""
    def _make(folder, names, content=b"ID3fake-audio-data"):
        os.makedirs(folder, exist_ok=True)
        created = []
        for name in names:
            path = os.path.join(folder, name)
            with open(path, "wb") as fh:
                fh.write(content)
            created.append(path)
        return created
    return _make


@pytest.fixture
def cancel_event(srv):
    """Registra un download_id cancelable y lo limpia al terminar."""
    created = []

    def _make(download_id, cancelled=False):
        ev = threading.Event()
        if cancelled:
            ev.set()
        srv.download_cancellation[download_id] = ev
        created.append(download_id)
        return ev

    yield _make

    for did in created:
        srv.download_cancellation.pop(did, None)
