"""
Importar listas de otros servicios (plan 15, T2): la búsqueda en el servidor.

Lo que llega del cliente es un fichero de terceros: se valida todo. La consulta
a yt-dlp va siempre como un argumento con prefijo `ytsearchN:` y detrás de `--`,
así que un título que empiece por «--» no puede convertirse en una opción. Y
cada encargo avanza en segundo plano con el mismo registro de progreso que las
descargas, así que el SSE que ya existe sirve para seguirlo.

Ningún test llama a yt-dlp de verdad: la búsqueda se sustituye.
"""

import json
import time

import pytest

import importar


# ========================================
# Utilidades
# ========================================

def linea(vid, titulo, canal, duracion=200, **extra):
    """Una línea de --dump-json, como la que imprime yt-dlp."""
    return json.dumps({'id': vid, 'title': titulo, 'channel': canal, 'duration': duracion, **extra})


def esperar(condicion, segundos=5.0):
    """Espera a que un hilo de fondo termine lo suyo."""
    limite = time.time() + segundos
    while time.time() < limite:
        if condicion():
            return True
        time.sleep(0.01)
    return False


class SubprocesoFalso:
    """Sustituye a subprocess.run: apunta cada orden y devuelve una salida fija."""

    def __init__(self, salida='', codigo=0):
        self.ordenes = []
        self.salida = salida
        self.codigo = codigo

    def __call__(self, orden, **kwargs):
        self.ordenes.append(orden)
        salida = self.salida(orden) if callable(self.salida) else self.salida

        class Resultado:
            returncode = self.codigo
            stdout = salida
            stderr = ''
        return Resultado()


@pytest.fixture
def gestor_propio():
    """Un gestor de encargos independiente del del servidor, que se cierra al acabar."""
    creados = []

    def crear(ejecutar, **kwargs):
        g = importar.GestorEncargos(ejecutar, **kwargs)
        creados.append(g)
        return g
    yield crear
    for g in creados:
        g.cerrar()


# ========================================
# Validación (§3)
# ========================================

def test_valida_y_limpia_cada_cancion():
    [c] = importar.validar_canciones([{
        'titulo': '  Bohemian\u0000 Rhapsody\u2028 ', 'artista': 'Queen', 'duracionMs': 354320,
        'isrc': 'gb-um7-10-29604', 'album': 'no se manda al servidor',
    }])
    assert c == {'titulo': 'Bohemian Rhapsody', 'artista': 'Queen', 'duracionMs': 354320, 'isrc': 'GBUM71029604'}


def test_al_servidor_solo_llegan_titulo_artista_duracion_e_isrc():
    [c] = importar.validar_canciones([{'titulo': 'x', 'album': 'A', 'correo': 'yo@example.com', 'ruta': '/home/yo'}])
    assert set(c) == {'titulo', 'artista', 'duracionMs', 'isrc'}


def test_los_campos_se_recortan_a_200():
    [c] = importar.validar_canciones([{'titulo': 'x' * 500, 'artista': 'y' * 500}])
    assert len(c['titulo']) == importar.MAX_CAMPO
    assert len(c['artista']) == importar.MAX_CAMPO


@pytest.mark.parametrize('duracion', [0, -5, 'mucho', True, float('nan'), 99 * 3600 * 1000, None])
def test_una_duracion_rara_queda_en_none(duracion):
    [c] = importar.validar_canciones([{'titulo': 'x', 'duracionMs': duracion}])
    assert c['duracionMs'] is None


@pytest.mark.parametrize('isrc', ['', 'corto', 'ES502180029X', 123, None, 'no es un isrc'])
def test_un_isrc_que_no_encaja_queda_en_none(isrc):
    [c] = importar.validar_canciones([{'titulo': 'x', 'isrc': isrc}])
    assert c['isrc'] is None


def test_las_canciones_sin_titulo_o_raras_se_saltan():
    canciones = importar.validar_canciones([{'titulo': ''}, 'texto', None, 42, {'artista': 'sin título'}, {'titulo': 'Buena'}])
    assert [c['titulo'] for c in canciones] == ['Buena']


@pytest.mark.parametrize('malo', [None, [], {}, 'lista', 42, [{'titulo': ''}]])
def test_sin_nada_que_buscar_es_un_error(malo):
    with pytest.raises(importar.DatosNoValidos):
        importar.validar_canciones(malo)


def test_mas_de_500_canciones_es_un_error():
    with pytest.raises(importar.DatosNoValidos):
        importar.validar_canciones([{'titulo': f'c{i}'} for i in range(importar.MAX_CANCIONES + 1)])
    assert len(importar.validar_canciones([{'titulo': f'c{i}'} for i in range(importar.MAX_CANCIONES)])) == 500


# ========================================
# Consultas (§3: nunca una opción de yt-dlp)
# ========================================

def test_la_consulta_por_nombre_lleva_artista_y_titulo():
    assert importar.consulta_nombre({'artista': 'Queen', 'titulo': 'Bohemian Rhapsody'}) == 'ytsearch5:Queen - Bohemian Rhapsody'


def test_sin_artista_solo_el_titulo():
    assert importar.consulta_nombre({'artista': '', 'titulo': 'Bohemian Rhapsody'}) == 'ytsearch5:Bohemian Rhapsody'


def test_la_consulta_por_isrc_va_entre_comillas():
    assert importar.consulta_isrc('GBUM71029604') == 'ytsearch3:"GBUM71029604"'


def test_un_titulo_que_empieza_por_guiones_llega_como_texto_de_busqueda():
    consulta = importar.consulta_nombre({'artista': '', 'titulo': '--exec rm -rf ~'})
    assert consulta.startswith('ytsearch5:'), 'el prefijo va siempre delante'
    orden = importar.comando_busqueda('python', consulta)
    assert orden[-1] == consulta, 'un solo argumento, el último'
    assert orden[-2] == '--', 'y detrás de «--», que cierra las opciones'
    assert '--exec' not in orden, 'nunca como argumento suelto'


def test_la_orden_es_una_lista_con_lo_justo():
    orden = importar.comando_busqueda('python', 'ytsearch5:x')
    assert orden[:3] == ['python', '-m', 'yt_dlp']
    for bandera in ('--dump-json', '--flat-playlist', '--no-download'):
        assert bandera in orden


# ========================================
# Leer la salida de yt-dlp
# ========================================

def test_candidatas_de_la_salida():
    salida = '\n'.join([
        linea('aaaaaaaaaaa', 'Bohemian Rhapsody', 'Queen - Topic', 355, channel_is_verified=True),
        linea('bbbbbbbbbbb', 'Queen – Bohemian Rhapsody (Official Video)', 'Queen Official', 359),
    ])
    c = importar.candidatas_de_salida(salida)
    assert [x['id'] for x in c] == ['aaaaaaaaaaa', 'bbbbbbbbbbb']
    assert c[0]['verificado'] is True
    assert c[1]['verificado'] is False
    assert c[0]['duration'] == 355
    assert c[0]['thumbnail'] == 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg'


def test_la_salida_rara_no_rompe_nada():
    salida = '\n'.join([
        'esto no es json',
        '[1, 2, 3]',
        linea('corto', 'id malo', 'x'),
        linea('aaaaaaaaaaa', 'Buena', 'Canal'),
        linea('aaaaaaaaaaa', 'Repetida', 'Canal'),
        json.dumps({'id': 'bbbbbbbbbbb', 'title': None, 'duration': 'larga'}),
        '',
    ])
    c = importar.candidatas_de_salida(salida)
    assert [x['id'] for x in c] == ['aaaaaaaaaaa', 'bbbbbbbbbbb']
    assert c[1]['title'] == 'Sin título'
    assert c[1]['duration'] == 0


def test_el_titulo_y_el_canal_se_limpian():
    [c] = importar.candidatas_de_salida(linea('aaaaaaaaaaa', 'a\u0000b' + 'x' * 400, '\u200bCanal'))
    assert c['title'].startswith('a b')
    assert len(c['title']) == importar.MAX_CAMPO
    assert c['channel'] == 'Canal'


def test_los_metadatos_musicales_se_anaden_si_se_pasan():
    [c] = importar.candidatas_de_salida(linea('aaaaaaaaaaa', 't', 'c'), metadatos=lambda v: {'artist': 'Queen'})
    assert c['artist'] == 'Queen'


# ========================================
# buscar_candidatas
# ========================================

def test_con_isrc_se_busca_primero_por_isrc_y_se_marcan():
    consultas = []

    def ejecutar(q):
        consultas.append(q)
        if q.startswith('ytsearch3:'):
            return [{'id': 'aaaaaaaaaaa'}]
        return [{'id': 'aaaaaaaaaaa'}, {'id': 'bbbbbbbbbbb'}]

    c = importar.buscar_candidatas({'titulo': 'T', 'artista': 'A', 'isrc': 'GBUM71029604'}, ejecutar)
    assert consultas == ['ytsearch3:"GBUM71029604"', 'ytsearch5:A - T']
    assert [(x['id'], x['porIsrc']) for x in c] == [('aaaaaaaaaaa', True), ('bbbbbbbbbbb', False)], \
        'el vídeo que sale en las dos se queda una vez, con la marca del ISRC'


def test_sin_isrc_solo_una_busqueda():
    consultas = []
    importar.buscar_candidatas({'titulo': 'T', 'artista': 'A', 'isrc': None}, lambda q: consultas.append(q) or [])
    assert consultas == ['ytsearch5:A - T']


# ========================================
# Encargos
# ========================================

def test_un_encargo_busca_todas_y_avisa_del_progreso(gestor_propio):
    avisos = []
    g = gestor_propio(
        lambda q: [{'id': 'aaaaaaaaaaa', 'title': q}],
        al_empezar=lambda i, t: avisos.append(('empieza', t)),
        al_avanzar=lambda i, h, t: avisos.append(('avanza', h, t)),
        al_terminar=lambda i, e, t: avisos.append(('termina', e, t)))
    id_, total = g.crear([{'titulo': f'c{i}', 'artista': '', 'isrc': None} for i in range(7)])
    assert total == 7
    assert len(id_) == 32 and all(c in '0123456789abcdef' for c in id_), 'el formato que acepta el SSE'
    assert esperar(lambda: g.resultado(id_)['estado'] == 'hecho')
    r = g.resultado(id_)
    assert r['hechas'] == 7
    assert len(r['canciones']) == 7
    assert avisos[0] == ('empieza', 7)
    assert avisos[-1] == ('termina', 'hecho', 7)
    assert sorted(a[1] for a in avisos if a[0] == 'avanza') == list(range(1, 8))


def test_el_resultado_conserva_el_orden_de_la_lista(gestor_propio):
    def lento_al_principio(q):
        if q.endswith('c0'):
            time.sleep(0.05)
        return [{'id': 'aaaaaaaaaaa'}]
    g = gestor_propio(lento_al_principio)
    id_, _ = g.crear([{'titulo': f'c{i}', 'artista': '', 'isrc': None} for i in range(4)])
    assert esperar(lambda: g.resultado(id_)['estado'] == 'hecho')
    assert [c['origen']['titulo'] for c in g.resultado(id_)['canciones']] == ['c0', 'c1', 'c2', 'c3']


def test_una_busqueda_que_revienta_no_tumba_el_encargo(gestor_propio):
    def a_veces_falla(q):
        if 'mala' in q:
            raise RuntimeError('yt-dlp se ha caído')
        return [{'id': 'aaaaaaaaaaa'}]
    g = gestor_propio(a_veces_falla)
    id_, _ = g.crear([{'titulo': 'buena', 'artista': '', 'isrc': None}, {'titulo': 'mala', 'artista': '', 'isrc': None}])
    assert esperar(lambda: g.resultado(id_)['estado'] == 'hecho')
    por_titulo = {c['origen']['titulo']: c['candidatas'] for c in g.resultado(id_)['canciones']}
    assert por_titulo == {'buena': [{'id': 'aaaaaaaaaaa', 'porIsrc': False}], 'mala': []}


def test_como_mucho_tres_busquedas_a_la_vez_por_encargo(gestor_propio):
    import threading
    en_marcha = []
    maximo = [0]
    lock = threading.Lock()

    def contar(q):
        with lock:
            en_marcha.append(q)
            maximo[0] = max(maximo[0], len(en_marcha))
        time.sleep(0.02)
        with lock:
            en_marcha.remove(q)
        return []
    g = gestor_propio(contar)
    id_, _ = g.crear([{'titulo': f'c{i}', 'artista': '', 'isrc': None} for i in range(12)])
    assert esperar(lambda: g.resultado(id_)['estado'] == 'hecho')
    assert maximo[0] <= importar.BUSQUEDAS_POR_ENCARGO


def test_con_demasiados_encargos_en_marcha_se_rechaza(gestor_propio):
    import threading
    soltar = threading.Event()
    g = gestor_propio(lambda q: soltar.wait(5) and [])
    cabe = importar.ENCARGOS_A_LA_VEZ + importar.ENCARGOS_EN_COLA
    for _ in range(cabe):
        g.crear([{'titulo': 'x', 'artista': '', 'isrc': None}])
    with pytest.raises(importar.ServidorOcupado):
        g.crear([{'titulo': 'x', 'artista': '', 'isrc': None}])
    soltar.set()


def test_el_resultado_caduca_a_la_hora(gestor_propio):
    ahora = [1000.0]
    g = gestor_propio(lambda q: [], reloj=lambda: ahora[0])
    id_, _ = g.crear([{'titulo': 'x', 'artista': '', 'isrc': None}])
    assert esperar(lambda: g.resultado(id_)['estado'] == 'hecho')
    ahora[0] += importar.RESULTADO_TTL - 1
    assert g.resultado(id_) is not None
    ahora[0] += 2
    assert g.resultado(id_) is None


def test_no_se_guardan_mas_de_veinte_resultados(gestor_propio):
    ahora = [0.0]
    g = gestor_propio(lambda q: [], reloj=lambda: ahora[0])
    ids = []
    for i in range(importar.MAX_RESULTADOS + 5):
        ahora[0] = float(i)
        id_, _ = g.crear([{'titulo': 'x', 'artista': '', 'isrc': None}])
        assert esperar(lambda id_=id_: g.resultado(id_)['estado'] == 'hecho')
        ids.append(id_)
    g.crear([{'titulo': 'x', 'artista': '', 'isrc': None}])   # purga al crear
    assert g.resultado(ids[0]) is None, 'lo más antiguo se olvida primero'
    assert g.resultado(ids[-1]) is not None


def test_un_id_que_no_existe_no_tiene_resultado(gestor_propio):
    assert gestor_propio(lambda q: []).resultado('0' * 32) is None


# ========================================
# Rutas
# ========================================

@pytest.fixture
def busqueda_falsa(srv, monkeypatch):
    """yt-dlp sustituido: devuelve tres candidatas para cualquier búsqueda."""
    falso = SubprocesoFalso('\n'.join([
        linea('aaaaaaaaaaa', 'Bohemian Rhapsody', 'Queen - Topic', 355),
        linea('bbbbbbbbbbb', 'Queen - Bohemian Rhapsody (Live Aid 1985)', 'Queen Official', 250),
        linea('ccccccccccc', 'Bohemian Rhapsody (Karaoke)', 'Sing King', 360),
    ]))
    monkeypatch.setattr(srv.subprocess, 'run', falso)
    return falso


def test_sin_sesion_se_puede_importar(client, busqueda_falsa):
    r = client.post('/api/import/match', json={'canciones': [{'titulo': 'Bohemian Rhapsody', 'artista': 'Queen'}]})
    assert r.status_code == 200
    datos = r.get_json()
    assert datos['total'] == 1
    assert len(datos['id']) == 32


def test_el_resultado_trae_las_candidatas(client, srv, busqueda_falsa):
    id_ = client.post('/api/import/match', json={'canciones': [{'titulo': 'Bohemian Rhapsody', 'artista': 'Queen'}]}).get_json()['id']
    assert esperar(lambda: client.get(f'/api/import/match/{id_}').get_json()['estado'] == 'hecho')
    datos = client.get(f'/api/import/match/{id_}').get_json()
    [cancion] = datos['canciones']
    assert cancion['origen']['titulo'] == 'Bohemian Rhapsody'
    assert [c['id'] for c in cancion['candidatas']] == ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']


def test_el_progreso_sale_por_el_registro_de_las_descargas(client, srv, busqueda_falsa):
    """Así el SSE que ya existe (/api/progress/stream/<id>) sirve sin tocarlo."""
    id_ = client.post('/api/import/match', json={'canciones': [{'titulo': 'a'}, {'titulo': 'b'}]}).get_json()['id']
    assert esperar(lambda: srv.download_progress.get(id_, {}).get('status') == 'complete')
    progreso = client.get(f'/api/progress/{id_}').get_json()
    assert progreso['current'] == 2
    assert progreso['code'] == 'import_done'
    assert progreso['tipo'] == 'importar'


def test_la_consulta_con_guiones_llega_a_yt_dlp_como_texto(client, busqueda_falsa):
    id_ = client.post('/api/import/match', json={'canciones': [{'titulo': '--exec rm -rf ~', 'artista': ''}]}).get_json()['id']
    assert esperar(lambda: client.get(f'/api/import/match/{id_}').get_json()['estado'] == 'hecho')
    [orden] = busqueda_falsa.ordenes
    assert orden[-2:] == ['--', 'ytsearch5:--exec rm -rf ~']
    assert '--exec' not in orden


@pytest.mark.parametrize('cuerpo', [None, {}, {'canciones': []}, {'canciones': 'x'}, {'canciones': [{'titulo': ''}]}])
def test_una_peticion_sin_canciones_da_400(client, busqueda_falsa, cuerpo):
    r = client.post('/api/import/match', json=cuerpo) if cuerpo is not None else client.post('/api/import/match', data='no json')
    assert r.status_code == 400
    assert busqueda_falsa.ordenes == [], 'no se lanza ninguna búsqueda'


def test_mas_de_500_da_400(client, busqueda_falsa):
    r = client.post('/api/import/match', json={'canciones': [{'titulo': f'c{i}'} for i in range(501)]})
    assert r.status_code == 400


@pytest.mark.parametrize('id_', ['corto', '../../etc/passwd', 'Z' * 32, '0' * 31])
def test_un_id_mal_formado_da_400(client, id_):
    assert client.get(f'/api/import/match/{id_}').status_code in (400, 404)


def test_un_resultado_caducado_da_404_con_codigo(client):
    r = client.get(f"/api/import/match/{'0' * 32}")
    assert r.status_code == 404
    assert r.get_json()['code'] == 'import_expired'


def test_una_busqueda_que_falla_deja_la_cancion_sin_candidatas(client, srv, monkeypatch):
    monkeypatch.setattr(srv.subprocess, 'run', SubprocesoFalso('', codigo=1))
    id_ = client.post('/api/import/match', json={'canciones': [{'titulo': 'x'}]}).get_json()['id']
    assert esperar(lambda: client.get(f'/api/import/match/{id_}').get_json()['estado'] == 'hecho')
    assert client.get(f'/api/import/match/{id_}').get_json()['canciones'][0]['candidatas'] == []


def test_dos_importaciones_por_hora_y_la_tercera_espera(client, busqueda_falsa):
    cuerpo = {'canciones': [{'titulo': 'x'}]}
    assert client.post('/api/import/match', json=cuerpo).status_code == 200
    assert client.post('/api/import/match', json=cuerpo).status_code == 200
    assert client.post('/api/import/match', json=cuerpo).status_code == 429


def test_el_servidor_ocupado_responde_503_con_codigo(client, srv, monkeypatch):
    def ocupado(canciones):
        raise importar.ServidorOcupado('lleno')
    monkeypatch.setattr(srv.gestor_importar, 'crear', ocupado)
    r = client.post('/api/import/match', json={'canciones': [{'titulo': 'x'}]})
    assert r.status_code == 503
    assert r.get_json()['code'] == 'import_busy'
