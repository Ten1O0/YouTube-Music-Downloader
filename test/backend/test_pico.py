"""
Preparados para un pico de visitas (plan 21, T7).

Si YouTube toma el servidor por un robot, las descargas de todos fallan: hay
que decirlo claro y no insistir. Y un tope global de canciones por hora, además
del de cada cuenta, para no provocarlo. Ningún test llama a yt-dlp de verdad.
"""

import json

import pytest

import pico as pico_mod

VIDEO = 'https://www.youtube.com/watch?v=aaaaaaaaaa{}'


class Reloj:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class SubprocesoFalso:
    """Sustituye a subprocess.run: falla como lo hace yt-dlp cuando YouTube bloquea."""

    def __init__(self, stderr='', codigo=1, stdout=''):
        self.stderr, self.codigo, self.stdout = stderr, codigo, stdout
        self.llamadas = 0

    def __call__(self, orden, **_):
        self.llamadas += 1

        class R:
            pass
        r = R()
        r.returncode, r.stdout, r.stderr = self.codigo, self.stdout, self.stderr
        return r


BOT = "ERROR: [youtube] aaaaaaaaaaa: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication."


# ========================================
# Reconocer el bloqueo
# ========================================

@pytest.mark.parametrize('linea', [
    BOT,
    "ERROR: [youtube] x: Sign in to confirm you're not a bot.",
    "ERROR: [youtube] x: This content isn't available, try again later. The current session has been rate-limited by YouTube for up to an hour.",
    "ERROR: unable to download video data: HTTP Error 429: Too Many Requests",
    "ERROR: [youtube] x: Video unavailable. YouTube is requiring a captcha challenge before playback",
])
def test_reconoce_el_bloqueo_de_youtube(linea):
    assert pico_mod.es_bloqueo(['[download] algo', linea])
    assert pico_mod.es_bloqueo(linea)


@pytest.mark.parametrize('linea', [
    "ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.",
    "ERROR: [youtube] x: Video unavailable",
    "ERROR: [youtube] x: Private video. Sign in if you've been granted access to this video",
    "[download] 100% of 3.00MiB",
    '',
])
def test_lo_demas_no_es_un_bloqueo(linea):
    assert not pico_mod.es_bloqueo([linea])


def test_sin_salida_no_es_un_bloqueo():
    assert not pico_mod.es_bloqueo(None)
    assert not pico_mod.es_bloqueo([])


# ========================================
# Tope global y enfriamiento
# ========================================

def test_el_tope_global_es_de_1000_canciones_por_hora():
    """Decidido con el usuario: 600 en el plan 21 (T7), 1000 tras el plan 24."""
    assert pico_mod.MAX_CANCIONES_POR_HORA_GLOBAL == 1000


def test_el_tope_cuenta_canciones_en_la_ultima_hora():
    reloj = Reloj()
    p = pico_mod.Pico(maximo=10, reloj=reloj)
    p.reservar(6)
    p.reservar(4)
    with pytest.raises(pico_mod.ServidorOcupado):
        p.reservar(1)
    # comprobar no apunta nada
    reloj.t += pico_mod.HORA + 1
    p.comprobar(10)
    assert p.usadas() == 0
    p.reservar(10)


def test_tras_un_bloqueo_no_se_lanza_nada_durante_el_enfriamiento():
    reloj = Reloj()
    p = pico_mod.Pico(maximo=100, enfriamiento=600, reloj=reloj)
    p.bloqueo()
    assert p.bloqueado()
    with pytest.raises(pico_mod.YoutubeLimita):
        p.reservar(1)
    with pytest.raises(pico_mod.YoutubeLimita):
        p.comprobar(1)
    reloj.t += 599
    assert p.bloqueado()
    reloj.t += 1
    assert not p.bloqueado()
    p.reservar(1)


# ========================================
# Las rutas
# ========================================

def test_la_descarga_suelta_cuenta_contra_el_tope_global(client, srv, monkeypatch):
    monkeypatch.setattr(srv, 'pico', pico_mod.Pico(maximo=1))
    monkeypatch.setattr(srv.executor, 'submit', lambda *a, **k: None)
    monkeypatch.setattr(srv, 'prefetch_video_metadata', lambda *a, **k: None)
    assert client.post('/api/start-download', json={'url': VIDEO.format(1)}).status_code == 200
    r = client.post('/api/start-download', json={'url': VIDEO.format(2)})
    assert r.status_code == 429
    assert r.get_json()['code'] == 'server_busy'


def test_los_lotes_cuentan_contra_el_tope_global_y_no_gastan_el_cupo_de_la_cuenta(client, srv, monkeypatch):
    monkeypatch.setattr(srv, 'pico', pico_mod.Pico(maximo=3))
    monkeypatch.setattr(srv.gestor_lotes, 'crear', lambda *a, **k: 'f' * 32)
    monkeypatch.setattr(srv.gestor_lotes, 'resumen', lambda _id: {'loteId': _id})
    r = client.post('/api/lotes', json={'canciones': [{'url': VIDEO.format(i)} for i in range(4)]})
    assert r.status_code == 429
    assert r.get_json()['code'] == 'server_busy'
    # Un lote que cabe sí entra
    assert client.post('/api/lotes', json={'canciones': [{'url': VIDEO.format(i)} for i in range(3)]}).status_code == 200


def test_el_cupo_de_la_cuenta_dice_su_codigo(client, srv, monkeypatch):
    import lotes as lotes_mod
    monkeypatch.setattr(lotes_mod, 'MAX_CANCIONES_POR_HORA', 2)
    monkeypatch.setattr(srv.gestor_lotes, 'crear', lambda *a, **k: 'f' * 32)
    monkeypatch.setattr(srv.gestor_lotes, 'resumen', lambda _id: {'loteId': _id})
    r = client.post('/api/lotes', json={'canciones': [{'url': VIDEO.format(i)} for i in range(3)]})
    assert r.status_code == 429
    assert r.get_json()['code'] == 'hour_limit'


def test_si_youtube_bloquea_la_busqueda_se_dice_y_se_para(client, srv, monkeypatch):
    falso = SubprocesoFalso(stderr=BOT)
    monkeypatch.setattr(srv.subprocess, 'run', falso)
    r = client.post('/api/search', json={'query': 'algo'})
    assert r.status_code == 503
    assert r.get_json()['code'] == 'youtube_limit'
    assert srv.pico.bloqueado()
    # Mientras dura, las descargas nuevas ni empiezan
    r = client.post('/api/start-download', json={'url': VIDEO.format(1)})
    assert r.status_code == 503
    assert r.get_json()['code'] == 'youtube_limit'


def test_un_error_normal_de_busqueda_no_bloquea(client, srv, monkeypatch):
    monkeypatch.setattr(srv.subprocess, 'run', SubprocesoFalso(stderr='ERROR: algo distinto'))
    assert client.post('/api/search', json={'query': 'algo'}).status_code == 500
    assert not srv.pico.bloqueado()


def test_la_radio_dice_que_youtube_limita(client, srv, monkeypatch):
    srv.radio.vaciar()
    monkeypatch.setattr(srv.subprocess, 'run', SubprocesoFalso(stderr=BOT))
    r = client.get('/api/radio?semilla=aaaaaaaaaaa')
    assert r.status_code == 503
    assert r.get_json()['code'] == 'youtube_limit'
    srv.radio.vaciar()


def test_una_descarga_que_bloquea_youtube_termina_con_su_codigo(srv, temp_dir):
    download_id = 'b' * 32
    carpeta = temp_dir / download_id
    carpeta.mkdir()
    srv.register_download(download_id, 1)

    class Proc:
        returncode = 1
    srv.finalize_download_status(download_id, Proc(), str(carpeta), 1, ['[youtube] x: Downloading', BOT])
    progreso = srv.download_progress[download_id]
    assert progreso['status'] == 'error'
    assert progreso['code'] == 'error_youtube_limit'
    assert srv.pico.bloqueado()
    srv.download_progress.pop(download_id, None)


def test_el_modulo_se_despliega():
    """Sin él en deploy.sh el servidor no arrancaría (pasó con importar.py)."""
    import pathlib
    deploy = pathlib.Path(__file__).resolve().parents[2] / 'scripts' / 'deploy.sh'
    if not deploy.exists():
        pytest.skip('deploy.sh no está en este clon (va en .gitignore)')
    texto = deploy.read_text(encoding='utf-8')
    assert 'backend/pico.py' in texto.split('py_compile', 1)[1].split('\n', 1)[0]
    assert 'backend/pico.py' in [linea for linea in texto.splitlines() if linea.startswith('FILES=')][0]


def test_las_respuestas_llevan_mensaje_y_codigo(srv):
    with srv.app.app_context():
        cuerpo, codigo = srv.respuesta_de_pico(pico_mod.YoutubeLimita())
        assert codigo == 503 and json.loads(cuerpo.get_data())['code'] == 'youtube_limit'
        cuerpo, codigo = srv.respuesta_de_pico(pico_mod.ServidorOcupado())
        assert codigo == 429 and json.loads(cuerpo.get_data())['code'] == 'server_busy'
