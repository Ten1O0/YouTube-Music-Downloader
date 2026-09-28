"""
Ciclo de vida de las descargas (plan 03).

El test más importante de este fichero es que **el barrido no borra descargas
en curso**. Un fallo ahí no da error: se lleva por delante la descarga de un
usuario a medias, o no barre nada y la fuga de memoria y de disco vuelve.
"""

import os
import time

import pytest


DID = "a" * 32
DID2 = "b" * 32


# ========================================
# register_download / update_progress (T4)
# ========================================

def test_register_creates_the_entry(srv):
    try:
        srv.register_download(DID, 5)
        entrada = srv.download_progress[DID]
        assert entrada["status"] == "starting"
        assert entrada["total"] == 5
        assert entrada["current"] == 0
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_register_sets_timestamps(srv):
    """Sin created_at/updated_at el barrido no puede decidir nada."""
    try:
        antes = time.time()
        srv.register_download(DID, 1)
        entrada = srv.download_progress[DID]
        assert entrada["created_at"] >= antes
        assert entrada["updated_at"] >= antes
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_register_creates_the_cancellation_event(srv):
    try:
        srv.register_download(DID, 1)
        assert DID in srv.download_cancellation
        assert not srv.download_cancellation[DID].is_set()
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_register_accepts_extra_fields(srv):
    try:
        srv.register_download(DID, 1, video_id="abc", message="Personalizado")
        assert srv.download_progress[DID]["video_id"] == "abc"
        assert srv.download_progress[DID]["message"] == "Personalizado"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_update_progress_refreshes_updated_at(srv):
    try:
        srv.register_download(DID, 1)
        inicial = srv.download_progress[DID]["updated_at"]
        time.sleep(0.02)

        assert srv.update_progress(DID, status="downloading") is True
        assert srv.download_progress[DID]["updated_at"] > inicial
        assert srv.download_progress[DID]["status"] == "downloading"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_update_progress_preserves_other_fields(srv):
    try:
        srv.register_download(DID, 7, video_id="abc")
        srv.update_progress(DID, status="downloading")
        assert srv.download_progress[DID]["total"] == 7
        assert srv.download_progress[DID]["video_id"] == "abc"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_update_progress_on_unknown_id_is_false(srv):
    """No debe crear entradas fantasma: eso sería la fuga otra vez."""
    antes = set(srv.download_progress)
    assert srv.update_progress("f" * 32, status="x") is False
    assert set(srv.download_progress) == antes


# ========================================
# forget_download (T4)
# ========================================

def test_forget_clears_all_three_structures(srv):
    srv.register_download(DID, 1)
    srv.download_processes[DID] = None

    srv.forget_download(DID, remove_folder=False)

    assert DID not in srv.download_progress
    assert DID not in srv.download_cancellation
    assert DID not in srv.download_processes


def test_forget_removes_the_folder(srv, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"x")

    srv.register_download(DID, 1)
    srv.forget_download(DID)

    assert not carpeta.exists()


def test_forget_can_keep_the_folder(srv, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    srv.register_download(DID, 1)
    srv.forget_download(DID, remove_folder=False)
    assert carpeta.exists()


def test_forget_unknown_id_is_harmless(srv):
    srv.forget_download("9" * 32)


def test_forget_kills_a_live_process(srv):
    """Una descarga colgada deja su yt-dlp vivo; olvidarla debe matarlo."""
    import subprocess
    proc = subprocess.Popen(["sleep", "30"])
    try:
        srv.register_download(DID, 1)
        srv.download_processes[DID] = proc
        srv.forget_download(DID, remove_folder=False)
        assert proc.poll() is not None, "el proceso siguió vivo"
    finally:
        if proc.poll() is None:
            proc.kill()


# ========================================
# Barrido (T5) — lo que más importa
# ========================================

def _envejecer(srv, download_id, segundos):
    """Hace como si la entrada llevara `segundos` sin tocarse."""
    srv.download_progress[download_id]["updated_at"] = time.time() - segundos


def test_sweep_removes_stale_downloads(srv, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()

    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    # Lo terminado sin recoger aguanta un día (plan 14, T2)
    _envejecer(srv, DID, srv.COMPLETED_TTL_SECONDS + 60)

    assert srv.sweep_stale_downloads() == 1
    assert DID not in srv.download_progress
    assert not carpeta.exists()


def test_a_finished_download_waits_a_day_to_be_collected(srv, temp_dir):
    """Si la app se cerró a mitad de un lote, lo terminado sigue ahí horas después."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    _envejecer(srv, DID, srv.DOWNLOAD_TTL_SECONDS * 5)
    try:
        assert srv.sweep_stale_downloads() == 0
        assert carpeta.exists()
    finally:
        srv.forget_download(DID)


@pytest.mark.parametrize("estado", ["error", "cancelled"])
def test_failed_or_cancelled_downloads_still_go_after_an_hour(srv, estado):
    srv.register_download(DID, 1)
    srv.update_progress(DID, status=estado)
    _envejecer(srv, DID, srv.DOWNLOAD_TTL_SECONDS + 60)
    assert srv.sweep_stale_downloads() == 1


def test_sweep_never_touches_an_active_download(srv):
    """
    El invariante crítico: una descarga en curso NO se barre, por muy antigua
    que parezca su marca de tiempo.
    """
    try:
        for estado in srv.ACTIVE_STATUSES:
            srv.register_download(DID, 1)
            srv.update_progress(DID, status=estado)
            _envejecer(srv, DID, srv.DOWNLOAD_TTL_SECONDS * 10)

            assert srv.sweep_stale_downloads() == 0, f"barrió una descarga en estado '{estado}'"
            assert DID in srv.download_progress
            srv.forget_download(DID, remove_folder=False)
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_sweep_keeps_recent_finished_downloads(srv):
    """Una descarga recién terminada debe seguir ahí para que el cliente la recoja."""
    try:
        srv.register_download(DID, 1)
        srv.update_progress(DID, status="complete")
        assert srv.sweep_stale_downloads() == 0
        assert DID in srv.download_progress
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_sweep_removes_a_hung_download(srv):
    """
    Proceso vivo pero sin salida durante una hora: es el caso que hoy se
    quedaba para siempre. Debe barrerse.
    """
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="error")
    _envejecer(srv, DID, srv.DOWNLOAD_TTL_SECONDS + 1)

    assert srv.sweep_stale_downloads() == 1


def test_sweep_handles_several_at_once(srv):
    try:
        for i in range(5):
            did = f"{i:032d}"
            srv.register_download(did, 1)
            srv.update_progress(did, status="complete")
            _envejecer(srv, did, srv.COMPLETED_TTL_SECONDS + 10)

        srv.register_download(DID2, 1)
        srv.update_progress(DID2, status="downloading")

        assert srv.sweep_stale_downloads() == 5
        assert DID2 in srv.download_progress
    finally:
        srv.forget_download(DID2, remove_folder=False)


def test_sweep_on_empty_state(srv):
    assert srv.sweep_stale_downloads() == 0


# ========================================
# Carpetas huérfanas (T5)
# ========================================

def test_orphan_sweep_removes_old_folders(srv, temp_dir):
    """Lo que queda en disco tras un reinicio: carpeta sin entrada en memoria."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    viejo = time.time() - srv.DOWNLOAD_TTL_SECONDS - 60
    os.utime(carpeta, (viejo, viejo))

    assert srv.sweep_orphan_folders() == 1
    assert not carpeta.exists()


def test_orphan_sweep_keeps_recent_folders(srv, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    assert srv.sweep_orphan_folders() == 0
    assert carpeta.exists()


def test_orphan_sweep_keeps_registered_folders(srv, temp_dir):
    """Una carpeta antigua pero con descarga registrada no es huérfana."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    viejo = time.time() - srv.DOWNLOAD_TTL_SECONDS - 60
    os.utime(carpeta, (viejo, viejo))

    try:
        srv.register_download(DID, 1)
        assert srv.sweep_orphan_folders() == 0
        assert carpeta.exists()
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_orphan_sweep_without_temp_dir(srv, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "TEMP_DIR", str(tmp_path / "no-existe"))
    assert srv.sweep_orphan_folders() == 0


def test_orphan_sweep_ignores_loose_files(srv, temp_dir):
    (temp_dir / "suelto.txt").write_text("x")
    assert srv.sweep_orphan_folders() == 0


# ========================================
# Arranque (T6)
# ========================================

def test_purge_empties_temp_dir(srv, temp_dir):
    """Tras un reinicio nada de TEMP_DIR es recuperable."""
    for i in range(3):
        (temp_dir / f"{i:032d}").mkdir()

    srv.purge_temp_dir_on_boot()
    assert list(temp_dir.iterdir()) == []


def test_purge_without_temp_dir_is_harmless(srv, tmp_path, monkeypatch):
    monkeypatch.setattr(srv, "TEMP_DIR", str(tmp_path / "no-existe"))
    srv.purge_temp_dir_on_boot()


def test_bootstrap_is_skippable(srv, monkeypatch):
    """Los tests necesitan importar server sin que inicialice nada."""
    monkeypatch.setenv("YTDL_SKIP_BOOTSTRAP", "1")
    llamadas = []
    monkeypatch.setattr(srv.db, "init_db", lambda: llamadas.append("init"))
    srv.bootstrap()
    assert llamadas == []


def test_bootstrap_initialises_when_not_skipped(srv, tmp_path, monkeypatch):
    monkeypatch.delenv("YTDL_SKIP_BOOTSTRAP", raising=False)
    monkeypatch.setattr(srv, "TEMP_DIR", str(tmp_path / "dl"))

    llamadas = []
    monkeypatch.setattr(srv.db, "init_db", lambda: llamadas.append("init"))
    monkeypatch.setattr(srv, "start_sweeper", lambda: llamadas.append("sweeper"))

    srv.bootstrap()

    assert "init" in llamadas
    assert "sweeper" in llamadas
    assert os.path.isdir(srv.TEMP_DIR)


def test_sweeper_start_is_idempotent(srv, monkeypatch):
    """Con varios workers de gunicorn no debe acumular hilos de barrido."""
    monkeypatch.setattr(srv.start_sweeper, "_started", False, raising=False)
    hilos = []
    monkeypatch.setattr(srv.threading, "Thread",
                        lambda *a, **k: type("H", (), {"start": lambda s: hilos.append(1)})())
    srv.start_sweeper()
    srv.start_sweeper()
    srv.start_sweeper()
    assert len(hilos) == 1


# ========================================
# Duplicados eliminados (T2)
# ========================================

def test_playlist_count_is_defined_once(srv):
    import inspect
    fuente = inspect.getsource(srv)
    assert fuente.count("\ndef get_playlist_count(") == 1


def test_manifest_route_is_registered_once(srv):
    reglas = [r for r in srv.app.url_map.iter_rules() if str(r) == "/manifest.json"]
    assert len(reglas) == 1, f"ruta duplicada: {reglas}"


def test_logger_is_defined_in_stream_error_path(srv, client, temp_dir, monkeypatch):
    """
    `stream_file` usaba `logger` en vez de `app.logger`, así que su except
    reventaba con NameError en lugar de registrar el error (T1).
    """
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    def explota(*a, **k):
        raise OSError("fallo simulado de disco")

    monkeypatch.setattr(srv, "send_file", explota)

    resp = client.get(f"/api/stream/{DID}")
    assert resp.status_code == 500
    assert resp.is_json, "el error debe ser JSON, no un NameError sin capturar"


# ========================================
# Streaming acotado (T3)
# ========================================

def test_range_is_capped(srv, client, temp_dir):
    """`Range: bytes=0-` no debe cargar el fichero entero en memoria."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    tam = srv.MAX_RANGE_CHUNK + 5000
    (carpeta / "a.m4a").write_bytes(b"\0" * tam)

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=0-"})
    assert resp.status_code == 206
    assert len(resp.data) <= srv.MAX_RANGE_CHUNK
    assert resp.headers["Content-Range"] == f"bytes 0-{srv.MAX_RANGE_CHUNK - 1}/{tam}"


def test_small_file_is_served_whole(srv, client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=0-"})
    assert resp.status_code == 206
    assert resp.data == b"0123456789"


def test_range_beyond_end_is_416(srv, client, temp_dir):
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(b"0123456789")

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=999-"})
    assert resp.status_code == 416
    assert resp.headers["Content-Range"] == "bytes */10"


def test_middle_range(srv, client, temp_dir):
    """Saltar al minuto 3 con la barra es lo que ejercita esto de verdad."""
    carpeta = temp_dir / DID
    carpeta.mkdir()
    (carpeta / "a.m4a").write_bytes(bytes(range(256)))

    resp = client.get(f"/api/stream/{DID}", headers={"Range": "bytes=100-199"})
    assert resp.status_code == 206
    assert resp.data == bytes(range(100, 200))
    assert resp.headers["Content-Range"] == "bytes 100-199/256"
