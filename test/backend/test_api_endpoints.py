"""
Contrato HTTP de la API.

Estos tests no llaman a yt-dlp: comprueban validación de entrada, códigos de
estado y forma de la respuesta, que es lo que el frontend da por hecho.
"""

import pytest

# Identificadores con el formato actual: 32 hex (plan 02, T7)
DID = "a" * 32
DID_INEXISTENTE = "d" * 32


# ========================================
# Salud
# ========================================

def test_health_is_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] in ("ok", "healthy")


def test_health_is_json(client):
    assert client.get("/api/health").content_type.startswith("application/json")


# ========================================
# /api/search
# ========================================

def test_search_without_body_is_400(client):
    assert client.post("/api/search", json={}).status_code == 400


def test_search_without_query_field_is_400(client):
    assert client.post("/api/search", json={"otra": "cosa"}).status_code == 400


@pytest.mark.parametrize("query", ["", " ", "a"])
def test_search_too_short_is_400(client, query):
    resp = client.post("/api/search", json={"query": query})
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_search_error_message_is_in_spanish(client):
    error = client.post("/api/search", json={"query": "a"}).get_json()["error"]
    assert "búsqueda" in error.lower() or "caracteres" in error.lower()


def test_search_rejects_non_json(client):
    resp = client.post("/api/search", data="no soy json",
                       content_type="text/plain")
    assert resp.status_code in (400, 415)


# ========================================
# /api/playlist-info
# ========================================

def test_playlist_info_without_body_is_400(client):
    assert client.post("/api/playlist-info", json={}).status_code == 400


def test_playlist_info_without_list_param_is_400(client):
    resp = client.post("/api/playlist-info",
                       json={"url": "https://www.youtube.com/watch?v=abc"})
    assert resp.status_code == 400


def test_playlist_info_rejects_non_youtube(client):
    resp = client.post("/api/playlist-info", json={"url": "https://vimeo.com/x"})
    assert resp.status_code == 400


# ========================================
# /api/start-download (validación, sin ejecutar yt-dlp)
# ========================================

def test_start_download_without_body_is_400(client):
    assert client.post("/api/start-download", json={}).status_code == 400


def test_start_download_with_empty_url_is_400(client):
    resp = client.post("/api/start-download", json={"url": "   "})
    assert resp.status_code == 400
    assert "vacío" in resp.get_json()["error"].lower()


def test_start_download_with_invalid_url_is_400(client):
    resp = client.post("/api/start-download", json={"url": "https://vimeo.com/123"})
    assert resp.status_code == 400


def test_start_download_returns_id(client, srv, monkeypatch):
    """Con yt-dlp anulado, el endpoint debe devolver un download_id utilizable."""
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(srv, "prefetch_video_metadata", lambda *a, **k: None)

    resp = client.post("/api/start-download",
                       json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert "download_id" in data
    # 32 hex tras el plan 02 T7: los de 8 caracteres eran enumerables
    assert len(data["download_id"]) == 32
    assert all(c in "0123456789abcdef" for c in data["download_id"])
    assert srv.safe_download_path(data["download_id"]) is not None


def test_start_download_registers_progress_and_cancellation(client, srv, monkeypatch):
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(srv, "prefetch_video_metadata", lambda *a, **k: None)

    did = client.post("/api/start-download",
                      json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
                      ).get_json()["download_id"]

    assert did in srv.download_progress
    assert did in srv.download_cancellation
    assert srv.download_progress[did]["status"] == "starting"


def test_search_query_is_accepted_as_download_input(client, srv, monkeypatch):
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    resp = client.post("/api/start-download", json={"url": "bad bunny"})
    assert resp.status_code == 200


# ========================================
# /api/start-batch-download
# ========================================

def test_batch_without_videos_is_400(client):
    assert client.post("/api/start-batch-download", json={}).status_code == 400


def test_batch_with_empty_list_is_400(client):
    resp = client.post("/api/start-batch-download", json={"videos": []})
    assert resp.status_code == 400


def test_batch_returns_id_and_total(client, srv, monkeypatch):
    # T5 sustituyó el hilo por petición por batch_executor
    monkeypatch.setattr(srv.batch_executor, "submit", lambda *a, **k: None)
    videos = [{"url": f"https://youtu.be/vid{i:08d}", "title": f"T{i}"} for i in range(3)]
    resp = client.post("/api/start-batch-download", json={"videos": videos})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["total"] == 3
    assert "download_id" in data


# ========================================
# /api/progress
# ========================================

def test_progress_of_unknown_id_is_404(client):
    resp = client.get(f"/api/progress/{DID_INEXISTENTE}")
    assert resp.status_code in (400, 404)


def test_progress_returns_registered_state(client, srv):
    srv.download_progress[DID] = {
        "status": "downloading", "current": 3, "total": 10, "message": "..."
    }
    resp = client.get(f"/api/progress/{DID}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "downloading"
    assert data["current"] == 3
    assert data["total"] == 10


# ========================================
# /api/cancel
# ========================================

def test_cancel_unknown_id(client):
    resp = client.post(f"/api/cancel/{DID_INEXISTENTE}")
    assert resp.status_code < 500


def test_cancel_sets_the_event(client, srv, cancel_event):
    ev = cancel_event(DID)
    srv.download_progress[DID] = {"status": "downloading"}
    client.post(f"/api/cancel/{DID}")
    assert ev.is_set()


# ========================================
# /api/download
# ========================================

def test_download_of_unknown_id_is_404(client):
    assert client.get(f"/api/download/{DID_INEXISTENTE}").status_code == 404


def test_download_with_no_audio_files_is_404(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "notas.txt").write_text("nada de audio")
    assert client.get(f"/api/download/{DID}").status_code == 404


def test_download_single_file_is_served(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "Cancion.m4a").write_bytes(b"audio-falso")

    resp = client.get(f"/api/download/{DID}")
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] in ("audio/mp4", "audio/mpeg")
    assert "Cancion.m4a" in resp.headers.get("Content-Disposition", "")


def test_download_multiple_files_is_a_zip(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    for n in ("a.m4a", "b.m4a"):
        (carpeta / n).write_bytes(b"audio-falso")

    resp = client.get(f"/api/download/{DID}")
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/zip"


def test_mp3_gets_audio_mpeg(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "Cancion.mp3").write_bytes(b"audio-falso")
    assert client.get(f"/api/download/{DID}").headers["Content-Type"] == "audio/mpeg"


def test_delete_removes_the_folder(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"x")

    resp = client.delete(f"/api/download/{DID}")
    assert resp.status_code == 200
    assert not carpeta.exists()


# ========================================
# /api/stream con Range
# ========================================

def test_stream_without_range_serves_whole_file(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    resp = client.get(f"/api/stream/{DID}")
    assert resp.status_code == 200
    assert resp.data == b"0123456789"


def test_stream_with_range_returns_206(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=2-5"})
    assert resp.status_code == 206
    assert resp.data == b"2345"
    assert resp.headers["Content-Range"] == "bytes 2-5/10"
    assert resp.headers["Accept-Ranges"] == "bytes"


def test_stream_open_ended_range(client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=5-"})
    assert resp.status_code == 206
    assert resp.data == b"56789"


# ========================================
# Manejadores de error
# ========================================

def test_unknown_api_route_is_json_404(client):
    resp = client.get("/api/no-existe")
    assert resp.status_code == 404
    assert resp.is_json
    assert "error" in resp.get_json()


def test_wrong_method_is_rejected(client):
    """
    GET sobre un endpoint POST devuelve 404 en vez de 405 porque la ruta
    comodín de estáticos (static_folder='.') la intercepta antes. Ver
    test_static_exposure.py: es un síntoma del mismo problema de fondo.
    """
    assert client.get("/api/search").status_code in (404, 405)


# ========================================
# CORS
# ========================================

def test_cors_headers_are_present(client):
    resp = client.get("/api/health", headers={"Origin": "https://music.dannarita.es"})
    assert "Access-Control-Allow-Origin" in resp.headers


def test_content_disposition_is_exposed(client, temp_dir):
    """El frontend lee el nombre del fichero de esa cabecera; debe estar expuesta."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"x")
    resp = client.get(f"/api/download/{DID}",
                      headers={"Origin": "https://music.dannarita.es"})
    expuestas = resp.headers.get("Access-Control-Expose-Headers", "")
    assert "Content-Disposition" in expuestas


def test_cors_must_not_echo_any_origin(client):
    """
    Antes, `CORS(app)` sin `origins` reflejaba cualquier Origin que le
    mandasen, que es tan permisivo como '*' y peor, porque funciona con
    credenciales. Corregido en el plan 02 T2 con una lista explícita.
    """
    ajeno = "https://sitio-cualquiera.com"
    resp = client.get("/api/health", headers={"Origin": ajeno})
    permitido = resp.headers.get("Access-Control-Allow-Origin")
    assert permitido not in ("*", ajeno), f"Origin ajeno aceptado: {permitido}"
