"""
«Tu año en música» (plan 17): la consulta de escuchas del año y su ruta.

El servidor solo reúne y comprime; el cálculo del resumen es del cliente
(plan 17, §2.2), para que con sesión y sin ella se use la misma lógica. Aquí se
comprueba lo que sí es responsabilidad del servidor: que el año se recorte con
margen, que el formato compacto sea fiel y que una cuenta nunca vea otra.
"""

from datetime import datetime, timezone

import pytest


# ========================================
# Utilidades
# ========================================

def ms(anio, mes, dia, hora=12, minuto=0):
    """Instante en milisegundos UTC, como los guarda el cliente con Date.now()."""
    return int(datetime(anio, mes, dia, hora, minuto, tzinfo=timezone.utc).timestamp() * 1000)


def anotar(db, user, filas, dispositivo="pruebas"):
    """Mete escuchas por la puerta normal: (local_id, videoId, artista, cancion, t, segundos)."""
    db.registrar_escuchas(user["id"], dispositivo, [
        {"id": local_id, "video_id": video_id, "artist": artista, "track": cancion, "t": t, "seconds": segundos}
        for local_id, video_id, artista, cancion, t, segundos in filas])


# ========================================
# escuchas_del_anio (T1)
# ========================================

def test_devuelve_solo_las_escuchas_del_anio_pedido(db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "A", "Uno", ms(2025, 6, 1), 200),
        (2, "bbbbbbbbbbb", "B", "Dos", ms(2026, 6, 1), 210),
        (3, "ccccccccccc", "C", "Tres", ms(2027, 6, 1), 220),
    ])
    assert [f[0] for f in db.escuchas_del_anio(user["id"], 2026)] == ["bbbbbbbbbbb"]


def test_las_escuchas_vienen_ordenadas_por_instante(db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "A", "Tarde", ms(2026, 9, 1), 100),
        (2, "bbbbbbbbbbb", "B", "Pronto", ms(2026, 2, 1), 100),
        (3, "ccccccccccc", "C", "Medio", ms(2026, 5, 1), 100),
    ])
    assert [f[2] for f in db.escuchas_del_anio(user["id"], 2026)] == ["Pronto", "Medio", "Tarde"]


def test_incluye_el_margen_de_catorce_horas_a_cada_lado(db, user):
    """
    Nochevieja en un huso adelantado: a las 00:30 del 1 de enero de 2026 en
    UTC+14 son las 10:30 del 31 de diciembre de 2025 en UTC. Esa escucha es de
    2026 para quien la hizo, así que el servidor tiene que traerla y dejar que
    el cliente recorte con su zona horaria.
    """
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "A", "Nochevieja UTC+14", ms(2025, 12, 31, 10, 30), 180),
        (2, "bbbbbbbbbbb", "B", "Fin de año UTC-12", ms(2027, 1, 1, 11, 30), 180),
        (3, "ccccccccccc", "C", "Demasiado antes", ms(2025, 12, 30, 12), 180),
        (4, "ddddddddddd", "D", "Demasiado despues", ms(2027, 1, 2, 12), 180),
    ])
    traidas = {f[2] for f in db.escuchas_del_anio(user["id"], 2026)}
    assert traidas == {"Nochevieja UTC+14", "Fin de año UTC-12"}


def test_las_escuchas_de_otra_cuenta_no_aparecen(db, user, other_user):
    anotar(db, user, [(1, "aaaaaaaaaaa", "Mia", "Mia", ms(2026, 3, 1), 100)])
    anotar(db, other_user, [(1, "bbbbbbbbbbb", "Suya", "Suya", ms(2026, 3, 1), 100)])
    assert [f[1] for f in db.escuchas_del_anio(user["id"], 2026)] == ["Mia"]
    assert [f[1] for f in db.escuchas_del_anio(other_user["id"], 2026)] == ["Suya"]


def test_un_ano_sin_escuchas_devuelve_lista_vacia(db, user):
    anotar(db, user, [(1, "aaaaaaaaaaa", "A", "Uno", ms(2026, 6, 1), 100)])
    assert db.escuchas_del_anio(user["id"], 2024) == []


def test_las_escuchas_de_varios_dispositivos_se_suman(db, user):
    """Lo que hace útil el resumen con sesión: junta móvil y ordenador."""
    anotar(db, user, [(1, "aaaaaaaaaaa", "A", "Movil", ms(2026, 4, 1), 100)], dispositivo="movil")
    anotar(db, user, [(1, "bbbbbbbbbbb", "B", "Portatil", ms(2026, 4, 2), 100)], dispositivo="portatil")
    assert len(db.escuchas_del_anio(user["id"], 2026)) == 2, "el id local 1 de cada dispositivo es una escucha distinta"


def test_no_devuelve_mas_del_tope(db, user, monkeypatch):
    monkeypatch.setattr(db, "MAX_ESCUCHAS_ANIO", 5)
    anotar(db, user, [(i, "aaaaaaaaaaa", "A", "Uno", ms(2026, 6, 1) + i, 100) for i in range(1, 12)])
    assert len(db.escuchas_del_anio(user["id"], 2026)) == 5


# ========================================
# artistas_anteriores (T3)
# ========================================

def test_devuelve_los_artistas_de_antes_del_ano(db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "Viejo", "v", ms(2024, 5, 1), 100),
        (2, "bbbbbbbbbbb", "Tambien viejo", "t", ms(2025, 5, 1), 100),
        (3, "ccccccccccc", "Nuevo", "n", ms(2026, 5, 1), 100),
    ])
    assert db.artistas_anteriores(user["id"], 2026) == ["Tambien viejo", "Viejo"]


def test_los_artistas_anteriores_no_se_repiten(db, user):
    anotar(db, user, [(i, "aaaaaaaaaaa", "Repetido", "r", ms(2025, 5, i), 100) for i in range(1, 6)])
    assert db.artistas_anteriores(user["id"], 2026) == ["Repetido"]


def test_los_artistas_anteriores_van_sin_normalizar(db, user):
    """La normalización es del cliente, que es quien tiene normalizarArtista."""
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "ROSALÍA", "r", ms(2025, 5, 1), 100),
        (2, "bbbbbbbbbbb", "rosalia", "r", ms(2025, 5, 2), 100),
    ])
    assert db.artistas_anteriores(user["id"], 2026) == ["ROSALÍA", "rosalia"]


def test_los_artistas_sin_nombre_no_aparecen(db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "", "sin artista", ms(2025, 5, 1), 100),
        (2, "bbbbbbbbbbb", "Con nombre", "c", ms(2025, 5, 2), 100),
    ])
    assert db.artistas_anteriores(user["id"], 2026) == ["Con nombre"]


def test_los_artistas_anteriores_de_otra_cuenta_no_aparecen(db, user, other_user):
    anotar(db, user, [(1, "aaaaaaaaaaa", "Mio", "m", ms(2025, 5, 1), 100)])
    anotar(db, other_user, [(1, "bbbbbbbbbbb", "Suyo", "s", ms(2025, 5, 1), 100)])
    assert db.artistas_anteriores(user["id"], 2026) == ["Mio"]


def test_la_ruta_incluye_los_artistas_anteriores(authed_client, db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "De antes", "a", ms(2025, 5, 1), 100),
        (2, "bbbbbbbbbbb", "De este anio", "b", ms(2026, 5, 1), 100),
    ])
    datos = authed_client.get("/api/resumen/escuchas?anio=2026").get_json()
    assert datos["anteriores"] == ["De antes"]
    assert datos["catalogo"] == [["bbbbbbbbbbb", "De este anio", "b"]]


# ========================================
# comprimir_escuchas (T1)
# ========================================

def test_el_catalogo_no_repite_canciones(srv):
    filas = [
        ("aaaaaaaaaaa", "A", "Uno", 1000, 100),
        ("aaaaaaaaaaa", "A", "Uno", 2000, 120),
        ("bbbbbbbbbbb", "B", "Dos", 3000, 140),
        ("aaaaaaaaaaa", "A", "Uno", 4000, 160),
    ]
    salida = srv.comprimir_escuchas(filas)
    assert salida["catalogo"] == [["aaaaaaaaaaa", "A", "Uno"], ["bbbbbbbbbbb", "B", "Dos"]]
    assert salida["escuchas"] == [[0, 1000, 100], [0, 2000, 120], [1, 3000, 140], [0, 4000, 160]]


def test_comprimir_conserva_todas_las_escuchas(srv):
    filas = [(f"vid{i:08d}", "A", f"Cancion {i % 3}", 1000 + i, i) for i in range(30)]
    salida = srv.comprimir_escuchas(filas)
    assert len(salida["escuchas"]) == 30
    assert len(salida["catalogo"]) == 30, "el videoId distingue: 30 canciones distintas"


def test_la_misma_cancion_con_otro_nombre_es_otra_entrada(srv):
    """Si el usuario edita el artista a mitad de año, las dos versiones cuentan aparte."""
    filas = [("aaaaaaaaaaa", "Bad Bunny", "Uno", 1000, 100), ("aaaaaaaaaaa", "BadBunnyPR", "Uno", 2000, 100)]
    assert len(srv.comprimir_escuchas(filas)["catalogo"]) == 2


def test_comprimir_una_lista_vacia(srv):
    assert srv.comprimir_escuchas([]) == {"catalogo": [], "escuchas": []}


# ========================================
# GET /api/resumen/escuchas (T1)
# ========================================

def test_sin_sesion_no_se_puede_consultar(client):
    assert client.get("/api/resumen/escuchas?anio=2026").status_code == 401


def test_con_sesion_devuelve_el_formato_compacto(authed_client, db, user):
    anotar(db, user, [
        (1, "aaaaaaaaaaa", "A", "Uno", ms(2026, 3, 1), 200),
        (2, "aaaaaaaaaaa", "A", "Uno", ms(2026, 3, 2), 210),
        (3, "bbbbbbbbbbb", "B", "Dos", ms(2026, 3, 3), 220),
    ])
    datos = authed_client.get("/api/resumen/escuchas?anio=2026").get_json()
    assert datos["anio"] == 2026
    assert datos["catalogo"] == [["aaaaaaaaaaa", "A", "Uno"], ["bbbbbbbbbbb", "B", "Dos"]]
    assert [e[0] for e in datos["escuchas"]] == [0, 0, 1]


def test_sin_anio_usa_el_actual(authed_client, db, user):
    actual = datetime.now(timezone.utc).year
    assert authed_client.get("/api/resumen/escuchas").get_json()["anio"] == actual


@pytest.mark.parametrize("valor", ["1999", "2100", "abc", "2026.5", "-2026", "'; DROP TABLE listens; --", "1e9"])
def test_un_anio_no_valido_da_400(authed_client, valor):
    assert authed_client.get(f"/api/resumen/escuchas?anio={valor}").status_code == 400


def test_una_cuenta_no_ve_las_escuchas_de_otra_por_la_ruta(client, srv, db, user, other_user, monkeypatch):
    monkeypatch.setattr(srv, "db", db)
    anotar(db, user, [(1, "aaaaaaaaaaa", "Mia", "Mia", ms(2026, 3, 1), 100)])
    anotar(db, other_user, [(1, "bbbbbbbbbbb", "Suya", "Suya", ms(2026, 3, 1), 100)])
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {srv.create_jwt_token(other_user['id'])}"
    datos = client.get("/api/resumen/escuchas?anio=2026").get_json()
    assert datos["catalogo"] == [["bbbbbbbbbbb", "Suya", "Suya"]]
