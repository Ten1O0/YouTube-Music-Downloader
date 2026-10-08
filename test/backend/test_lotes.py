"""
Lotes de descargas (plan 20): una petición, muchas descargas sueltas, de 3 en 3.
"""

import concurrent.futures
import threading
import time

import pytest

import lotes as lotes_mod

VIDEO = "https://www.youtube.com/watch?v={:011d}"


def esperar(condicion, segundos=5):
    fin = time.time() + segundos
    while time.time() < fin:
        if condicion():
            return True
        time.sleep(0.01)
    return False


class Simulado:
    """Descargas simuladas: cada una espera a que la prueba la deje terminar."""

    def __init__(self):
        self.estados = {}
        self.en_marcha = 0
        self.maximo = 0
        self.canceladas = []
        self.soltar = threading.Event()
        self._lock = threading.Lock()

    def descargar(self, download_id, cancion):
        with self._lock:
            self.en_marcha += 1
            self.maximo = max(self.maximo, self.en_marcha)
            self.estados[download_id] = 'downloading'
        self.soltar.wait(5)
        with self._lock:
            self.en_marcha -= 1
            if self.estados.get(download_id) == 'downloading':
                self.estados[download_id] = 'error' if cancion.get('falla') else 'complete'

    def cancelar(self, download_id):
        self.canceladas.append(download_id)
        self.estados.pop(download_id, None)

    def estado_de(self, download_id):
        return self.estados.get(download_id)


@pytest.fixture
def simulado():
    s = Simulado()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)
    gestor = lotes_mod.Lotes(s.descargar, s.cancelar, s.estado_de, executor)
    yield s, gestor
    s.soltar.set()
    executor.shutdown(wait=True)


def canciones(n, **extra):
    return [{'download_id': f'{i:032x}', **extra} for i in range(n)]


# ─── El organizador ───

def test_never_more_than_three_at_once(simulado):
    s, gestor = simulado
    lote = gestor.crear(canciones(10))
    assert esperar(lambda: s.en_marcha == 3)
    time.sleep(0.2)
    assert s.maximo == 3
    r = gestor.resumen(lote)
    assert (r['enCurso'], r['enCola'], r['hechas']) == (3, 7, 0)
    s.soltar.set()
    assert esperar(lambda: gestor.resumen(lote)['terminado'])
    r = gestor.resumen(lote)
    assert (r['hechas'], r['fallidas'], r['total']) == (10, 0, 10)
    assert s.maximo == 3


def test_failures_are_counted_and_the_rest_continue(simulado):
    s, gestor = simulado
    lista = canciones(4)
    lista[1]['falla'] = True
    lote = gestor.crear(lista)
    s.soltar.set()
    assert esperar(lambda: gestor.resumen(lote)['terminado'])
    r = gestor.resumen(lote)
    assert (r['hechas'], r['fallidas']) == (3, 1)
    assert [c['estado'] for c in r['canciones']] == ['hecha', 'fallida', 'hecha', 'hecha']


def test_cancelling_stops_what_is_running_and_the_queue_never_starts(simulado):
    s, gestor = simulado
    lote = gestor.crear(canciones(8))
    assert esperar(lambda: s.en_marcha == 3)
    assert gestor.cancelar(lote)
    s.soltar.set()
    assert esperar(lambda: gestor.resumen(lote)['terminado'])
    r = gestor.resumen(lote)
    assert r['cancelado'] is True
    assert r['hechas'] == 0
    assert all(c['estado'] == 'cancelada' for c in r['canciones'])
    # Solo llegaron a empezar las tres primeras
    assert len(s.estados) == 0 and s.maximo == 3
    assert set(s.canceladas) == {c['download_id'] for c in canciones(3)}


def test_unknown_batch(simulado):
    _, gestor = simulado
    assert gestor.resumen('f' * 32) is None
    assert gestor.cancelar('f' * 32) is False


def test_a_download_swept_by_the_server_shows_as_expired(simulado):
    s, gestor = simulado
    lote = gestor.crear(canciones(1))
    s.soltar.set()
    assert esperar(lambda: gestor.resumen(lote)['terminado'])
    s.estados.clear()   # el barrido del servidor se la llevó
    r = gestor.resumen(lote)
    assert r['canciones'][0]['estado'] == 'caducada'
    assert r['fallidas'] == 1


# ─── El cupo por hora ───

def test_songs_per_hour_across_batches():
    ahora = [1000.0]
    gestor = lotes_mod.Lotes(None, None, None, None, reloj=lambda: ahora[0])
    tercio = lotes_mod.MAX_CANCIONES_POR_HORA // 3
    gestor.reservar('u:1', tercio)
    gestor.reservar('u:1', tercio)
    gestor.reservar('u:1', lotes_mod.MAX_CANCIONES_POR_HORA - 2 * tercio)
    with pytest.raises(lotes_mod.CupoAgotado) as e:
        gestor.reservar('u:1', 1)
    assert e.value.quedan == 0
    # Otra cuenta tiene su propio cupo
    gestor.reservar('u:2', tercio)
    # Una hora después, vuelve a haber sitio
    ahora[0] += lotes_mod.HORA + 1
    gestor.reservar('u:1', lotes_mod.MAX_CANCIONES_POR_HORA)


def test_what_is_left_this_hour_is_reported():
    gestor = lotes_mod.Lotes(None, None, None, None, reloj=lambda: 0.0)
    gestor.reservar('ip', lotes_mod.MAX_CANCIONES_POR_HORA - 10)
    with pytest.raises(lotes_mod.CupoAgotado) as e:
        gestor.reservar('ip', 20)
    assert e.value.quedan == 10


def test_el_cupo_por_cuenta_es_de_100_canciones_por_hora():
    """Decidido para el pico de la publicación (plan 21, T7); antes, 300."""
    assert lotes_mod.MAX_CANCIONES_POR_HORA == 100


def test_old_batches_are_forgotten(simulado):
    s, _ = simulado
    ahora = [0.0]
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    gestor = lotes_mod.Lotes(s.descargar, s.cancelar, s.estado_de, executor, reloj=lambda: ahora[0])
    lote = gestor.crear([])
    ahora[0] = lotes_mod.TTL_SEGUNDOS + 1
    assert gestor.barrer() == 1
    assert gestor.resumen(lote) is None
    executor.shutdown(wait=True)


# ─── Las rutas ───

@pytest.fixture
def con_lotes(client, srv, db, monkeypatch):
    """El servidor con descargas simuladas que terminan al momento."""
    monkeypatch.setattr(srv, "db", db)

    def descargar(download_id, cancion):
        srv.update_progress(download_id, status='complete', current=1, message='hecha')

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=3)
    gestor = lotes_mod.Lotes(
        descargar, srv.cancelar_descarga_suelta,
        lambda did: (srv.download_progress.get(did) or {}).get('status'), executor)
    monkeypatch.setattr(srv, "gestor_lotes", gestor)
    yield client
    executor.shutdown(wait=True)


def test_one_request_creates_one_download_per_song(con_lotes, srv):
    r = con_lotes.post("/api/lotes", json={
        "nombre": "Mi lista",
        "canciones": [{"url": VIDEO.format(i), "title": f"Canción {i}", "channel": "Canal", "duration": 200}
                      for i in range(5)],
    })
    assert r.status_code == 200, r.get_json()
    datos = r.get_json()
    assert datos["total"] == 5 and datos["nombre"] == "Mi lista"
    ids = [c["downloadId"] for c in datos["canciones"]]
    assert len(set(ids)) == 5
    # Cada una es una descarga suelta, con lo que sabía el cliente mientras espera
    primera = srv.download_progress[ids[0]]
    assert primera["title"] == "Canción 0"
    assert primera["video_id"] == f"{0:011d}"
    lote = datos["loteId"]
    assert esperar(lambda: con_lotes.get(f"/api/lotes/{lote}").get_json()["terminado"])
    assert con_lotes.get(f"/api/lotes/{lote}").get_json()["hechas"] == 5
    # El progreso de cada una se consulta como el de cualquier descarga
    assert con_lotes.get(f"/api/progress/{ids[0]}").get_json()["status"] == "complete"


@pytest.mark.parametrize("cuerpo", [
    {},
    {"canciones": []},
    {"canciones": "no"},
    {"canciones": [{"url": "https://example.com/audio.mp3"}]},
    {"canciones": [{"url": "https://www.youtube.com/playlist?list=PLabcdefghij"}]},
    {"canciones": [{"url": VIDEO.format(1)}] * 101},
])
def test_invalid_batches_are_rejected(con_lotes, cuerpo):
    assert con_lotes.post("/api/lotes", json=cuerpo).status_code == 400


def test_a_title_without_link_is_searched(con_lotes, srv):
    r = con_lotes.post("/api/lotes", json={"canciones": [{"url": "Artista - Canción"}]})
    assert r.status_code == 200
    download_id = r.get_json()["canciones"][0]["downloadId"]
    assert srv.download_progress[download_id]["video_id"] is None


def test_the_hourly_cap_answers_429_with_what_is_left(con_lotes, srv, monkeypatch):
    monkeypatch.setattr(lotes_mod, "MAX_CANCIONES_POR_HORA", 6)
    lote = {"canciones": [{"url": VIDEO.format(i)} for i in range(4)]}
    assert con_lotes.post("/api/lotes", json=lote).status_code == 200
    r = con_lotes.post("/api/lotes", json=lote)
    assert r.status_code == 429
    assert r.get_json()["quedan"] == 2


def test_status_and_cancel_of_unknown_or_invalid_batches(con_lotes):
    assert con_lotes.get("/api/lotes/" + "f" * 32).status_code == 404
    assert con_lotes.get("/api/lotes/../etc").status_code in (400, 404)
    assert con_lotes.get("/api/lotes/ABC").status_code == 400
    assert con_lotes.delete("/api/lotes/" + "f" * 32).status_code == 404


def test_zip_with_what_has_finished(con_lotes, srv, make_audio_files):
    datos = con_lotes.post("/api/lotes", json={
        "nombre": "Viaje", "canciones": [{"url": VIDEO.format(i)} for i in range(2)]}).get_json()
    lote = datos["loteId"]
    assert esperar(lambda: con_lotes.get(f"/api/lotes/{lote}").get_json()["terminado"])
    for c in datos["canciones"]:
        # Dos canciones con el mismo título no se pisan en el ZIP
        make_audio_files(srv.safe_download_path(c["downloadId"]), ["Misma.m4a"])
    r = con_lotes.get(f"/api/lotes/{lote}/zip")
    assert r.status_code == 200
    assert r.mimetype == "application/zip"
    assert "Viaje.zip" in r.headers["Content-Disposition"]
    import io
    import zipfile
    nombres = zipfile.ZipFile(io.BytesIO(r.data)).namelist()
    assert sorted(nombres) == ["Misma (2).m4a", "Misma.m4a"]


def test_queued_songs_are_not_swept(srv):
    assert "queued" in srv.ACTIVE_STATUSES


def test_creating_batches_is_rate_limited(client):
    """3 por minuto, como el lote de antes: cada uno puede ser 100 descargas."""
    codigos = [client.post("/api/lotes", json={}).status_code for _ in range(6)]
    assert 429 in codigos
    assert codigos.index(429) >= 3
