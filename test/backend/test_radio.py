"""
Modo radio (plan 16, T1): las candidatas de /api/radio.

Lo único que llega del cliente es la semilla, y se valida: la URL de la mezcla
(`list=RD<id>`) la construye el servidor. Cada mezcla es una llamada a yt-dlp,
así que se guarda 30 minutos (hasta 200 semillas) y la ruta tiene su límite.

Ningún test llama a yt-dlp de verdad: se sustituye.
"""

import json

import pytest

import radio

SEMILLA = 'aaaaaaaaaaa'


def linea(vid, titulo='Canción', canal='Canal', duracion=200):
    """Una línea de --dump-json --flat-playlist, como la que imprime yt-dlp."""
    return json.dumps({'id': vid, 'title': titulo, 'channel': canal, 'duration': duracion})


class SubprocesoFalso:
    """Sustituye a subprocess.run: apunta las órdenes y devuelve una mezcla."""

    def __init__(self, salida='', codigo=0, error=None):
        self.salida, self.codigo, self.error = salida, codigo, error
        self.ordenes = []

    def __call__(self, orden, **_):
        self.ordenes.append(orden)
        if self.error:
            raise self.error

        class Resultado:
            pass
        r = Resultado()
        r.returncode, r.stdout, r.stderr = self.codigo, self.salida, ''
        return r


class Reloj:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


# ========================================
# Lógica, sin servidor
# ========================================

@pytest.mark.parametrize('semilla', ['', 'corto', 'a' * 12, 'aaaaaaaaaa!', '../../etc/p', None, 12345678901, '--exec rm '])
def test_una_semilla_que_no_es_un_id_de_video_no_vale(semilla):
    with pytest.raises(radio.SemillaNoValida):
        radio.validar_semilla(semilla)


def test_la_url_de_la_mezcla_la_construye_el_servidor():
    assert radio.url_mezcla('dQw4w9WgXcQ') == 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'


def test_las_candidatas_van_en_el_orden_de_la_mezcla_y_sin_la_semilla():
    videos = [
        {'id': SEMILLA, 'title': 'La semilla', 'channel': 'X', 'duration': 200},
        {'id': 'bbbbbbbbbbb', 'title': ' Segunda ', 'channel': 'Canal B', 'duration': 180},
        {'id': 'ccccccccccc', 'title': 'Tercera', 'channel': 'Canal C', 'duration': 240.5},
    ]
    assert radio.candidatas(videos, SEMILLA) == [
        {'id': 'bbbbbbbbbbb', 'title': 'Segunda', 'channel': 'Canal B', 'duration': 180,
         'thumbnail': 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg'},
        {'id': 'ccccccccccc', 'title': 'Tercera', 'channel': 'Canal C', 'duration': 240.5,
         'thumbnail': 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'},
    ]


def test_sin_repetidas_ni_ids_raros_y_la_duracion_desconocida_es_null():
    videos = [
        {'id': 'bbbbbbbbbbb', 'title': 'B', 'channel': 'C', 'duration': 0},
        {'id': 'bbbbbbbbbbb', 'title': 'B otra vez', 'channel': 'C', 'duration': 100},
        {'id': 'no-vale', 'title': 'Raro'},
        {'title': 'Sin id'},
        'no es un vídeo',
        {'id': 'ccccccccccc', 'title': None, 'channel': 42, 'duration': 'mucho'},
    ]
    assert [(c['id'], c['title'], c['channel'], c['duration']) for c in radio.candidatas(videos, SEMILLA)] == [
        ('bbbbbbbbbbb', 'B', 'C', None),
        ('ccccccccccc', '', '', None),
    ]


def test_los_textos_se_recortan():
    [c] = radio.candidatas([{'id': 'bbbbbbbbbbb', 'title': 'x' * 500, 'channel': 'y' * 500}], SEMILLA)
    assert len(c['title']) == radio.MAX_CAMPO and len(c['channel']) == radio.MAX_CAMPO


def test_una_mezcla_se_pide_una_vez_cada_30_minutos():
    llamadas = []
    reloj = Reloj()
    r = radio.Radio(lambda url: llamadas.append(url) or [{'id': 'bbbbbbbbbbb'}], reloj=reloj)
    r.candidatas(SEMILLA)
    reloj.t += radio.CACHE_TTL - 1
    r.candidatas(SEMILLA)
    assert len(llamadas) == 1
    reloj.t += 1
    r.candidatas(SEMILLA)
    assert len(llamadas) == 2


def test_la_cache_no_pasa_de_su_tope_y_sale_la_que_caduca_antes():
    reloj = Reloj()
    r = radio.Radio(lambda url: [{'id': 'bbbbbbbbbbb'}], maximo=3, reloj=reloj)
    for i in range(4):
        reloj.t += 1
        r.candidatas(f'semilla{i:04d}')
    assert len(r) == 3
    llamadas = []
    r._ejecutar = lambda url: llamadas.append(url) or [{'id': 'bbbbbbbbbbb'}]
    r.candidatas('semilla0000')   # la primera, que salió
    r.candidatas('semilla0003')   # la última, que sigue
    assert llamadas == [radio.url_mezcla('semilla0000')]


def test_lo_caducado_sale_antes_que_lo_vigente():
    reloj = Reloj()
    r = radio.Radio(lambda url: [{'id': 'bbbbbbbbbbb'}], ttl=10, maximo=200, reloj=reloj)
    r.candidatas('semilla0000')
    reloj.t += 11
    r.candidatas('semilla0001')
    assert len(r) == 1


def test_una_mezcla_vacia_no_se_guarda():
    llamadas = []
    r = radio.Radio(lambda url: llamadas.append(url) or [], reloj=Reloj())
    assert r.candidatas(SEMILLA) == []
    r.candidatas(SEMILLA)
    assert len(llamadas) == 2


def test_cambiar_lo_devuelto_no_toca_la_cache():
    r = radio.Radio(lambda url: [{'id': 'bbbbbbbbbbb'}], reloj=Reloj())
    r.candidatas(SEMILLA).clear()
    assert len(r.candidatas(SEMILLA)) == 1


# ========================================
# La ruta
# ========================================

@pytest.fixture
def mezcla(srv, monkeypatch):
    """yt-dlp sustituido: la mezcla empieza por la semilla y trae dos más."""
    srv.radio.vaciar()
    falso = SubprocesoFalso('\n'.join([
        linea(SEMILLA, 'La semilla'),
        linea('bbbbbbbbbbb', 'Parecida uno', 'Canal B', 185),
        linea('ccccccccccc', 'Parecida dos', 'Canal C', 0),
    ]))
    monkeypatch.setattr(srv.subprocess, 'run', falso)
    yield falso
    srv.radio.vaciar()


def test_la_ruta_devuelve_las_candidatas(client, mezcla):
    r = client.get(f'/api/radio?semilla={SEMILLA}')
    assert r.status_code == 200
    assert r.get_json() == {'candidatas': [
        {'id': 'bbbbbbbbbbb', 'title': 'Parecida uno', 'channel': 'Canal B', 'duration': 185,
         'thumbnail': 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg'},
        {'id': 'ccccccccccc', 'title': 'Parecida dos', 'channel': 'Canal C', 'duration': None,
         'thumbnail': 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'},
    ]}


def test_a_yt_dlp_le_llega_la_url_rd_construida_y_con_su_tope(client, srv, mezcla):
    client.get(f'/api/radio?semilla={SEMILLA}')
    [orden] = mezcla.ordenes
    assert f'https://www.youtube.com/watch?v={SEMILLA}&list=RD{SEMILLA}' in orden
    assert orden[orden.index('--playlist-end') + 1] == str(srv.MAX_CANCIONES_MIX)
    assert '--flat-playlist' in orden


def test_la_segunda_peticion_sale_de_la_cache(client, mezcla):
    client.get(f'/api/radio?semilla={SEMILLA}')
    assert client.get(f'/api/radio?semilla={SEMILLA}').status_code == 200
    assert len(mezcla.ordenes) == 1


@pytest.mark.parametrize('consulta', ['', '?semilla=', '?semilla=corto', '?semilla=aaaaaaaaaaa%26list%3DPL', '?semilla=--exec%20rm'])
def test_una_semilla_mala_es_400_y_no_llama_a_yt_dlp(client, mezcla, consulta):
    r = client.get(f'/api/radio{consulta}')
    assert r.status_code == 400
    assert 'error' in r.get_json()
    assert mezcla.ordenes == []


def test_si_yt_dlp_falla_es_502(client, srv, monkeypatch):
    srv.radio.vaciar()
    monkeypatch.setattr(srv.subprocess, 'run', SubprocesoFalso(codigo=1))
    r = client.get(f'/api/radio?semilla={SEMILLA}')
    assert r.status_code == 502
    assert 'error' in r.get_json()


def test_si_yt_dlp_no_responde_es_502(client, srv, monkeypatch):
    srv.radio.vaciar()
    monkeypatch.setattr(srv.subprocess, 'run', SubprocesoFalso(error=srv.subprocess.TimeoutExpired('yt-dlp', 60)))
    assert client.get(f'/api/radio?semilla={SEMILLA}').status_code == 502


def test_la_ruta_esta_limitada_a_20_por_minuto(client, mezcla):
    codigos = [client.get(f'/api/radio?semilla={SEMILLA}').status_code for _ in range(25)]
    assert codigos[:20] == [200] * 20
    assert 429 in codigos[20:]
