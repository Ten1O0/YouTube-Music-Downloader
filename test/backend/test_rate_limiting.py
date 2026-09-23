"""
Rate limiting y confianza en la IP del cliente (plan 02, T3 y T4).

Dos invariantes que se contradicen entre sí y hay que verificar juntas:

  1. Los endpoints caros se cortan antes de que alguien pueda abusar de ellos.
  2. Los que el cliente llama de continuo (`/api/progress` cada segundo durante
     toda la descarga) **nunca** se cortan, o la aplicación se rompe sola.

Un límite mal puesto en el punto 2 no se nota en desarrollo: aparece cuando un
usuario descarga una playlist larga y la barra se queda congelada a mitad.
"""

import pytest


# ========================================
# Configuración
# ========================================

def test_limiter_is_enabled(srv):
    assert srv.limiter is not None
    assert srv.limiter.enabled


def test_default_limit_is_configured(srv):
    """
    Todo endpoint sin límite propio queda cubierto por el límite global.
    Se comprueba por comportamiento y no por atributos internos, porque los
    privados de flask-limiter cambian entre versiones menores.
    """
    limites = [str(lim) for lim in srv.limiter.limit_manager.default_limits]
    assert any("200" in lim for lim in limites), f"límite global inesperado: {limites}"


def test_proxyfix_is_installed(srv):
    """Sin ProxyFix, el limitador vería siempre la IP de nginx (127.0.0.1)."""
    from werkzeug.middleware.proxy_fix import ProxyFix
    assert isinstance(srv.app.wsgi_app, ProxyFix)


def test_proxyfix_trusts_exactly_one_proxy(srv):
    """
    x_for debe ser el número real de proxies (nginx = 1). Un valor mayor deja
    que el cliente falsee su IP inyectando cabeceras X-Forwarded-For y el rate
    limiting deja de servir para nada.
    """
    assert srv.app.wsgi_app.x_for == 1


def _remote_addr_visto(srv, forwarded_for):
    """
    Pasa una petición por ProxyFix con la MISMA configuración que usa la app y
    devuelve el REMOTE_ADDR resultante.

    Se prueba al nivel del middleware WSGI a propósito: `test_request_context`
    no ejecuta la cadena WSGI, así que ahí ProxyFix ni siquiera interviene.
    """
    from werkzeug.middleware.proxy_fix import ProxyFix
    from werkzeug.test import create_environ

    capturado = {}

    def app_falsa(environ, start_response):
        capturado["remote_addr"] = environ.get("REMOTE_ADDR")
        start_response("200 OK", [("Content-Type", "text/plain")])
        return [b""]

    envuelta = ProxyFix(app_falsa, x_for=srv.app.wsgi_app.x_for)
    environ = create_environ("/api/health", headers={"X-Forwarded-For": forwarded_for})
    environ["REMOTE_ADDR"] = "127.0.0.1"   # la IP de nginx
    envuelta(environ, lambda *a, **k: None)

    return capturado["remote_addr"]


def test_client_ip_comes_from_forwarded_header(srv):
    """Con ProxyFix, remote_addr es la IP del cliente y no la del proxy."""
    assert _remote_addr_visto(srv, "203.0.113.42") == "203.0.113.42"


def test_forwarded_header_cannot_be_chained(srv):
    """
    Con x_for=1 solo se confía en el último salto. Si un cliente inyecta una
    cadena falsa por delante, debe ganar la que añade nginx (la de la derecha),
    no la que eligió el atacante.
    """
    assert _remote_addr_visto(srv, "1.2.3.4, 203.0.113.42") == "203.0.113.42"


# ========================================
# Endpoints exentos: los que el cliente llama continuamente
# ========================================

EXENTOS = [
    ("get", "/api/health"),
    ("get", "/api/progress/{did}"),
    ("get", "/api/stream/{did}"),
    ("get", "/api/download/{did}"),
]


@pytest.mark.parametrize("metodo,ruta", EXENTOS)
def test_polled_endpoints_are_never_rate_limited(client, metodo, ruta):
    """
    120 peticiones seguidas (dos minutos de sondeo) sin un solo 429.

    `/api/progress` es el crítico: el cliente lo pide una vez por segundo
    durante toda la descarga. Limitarlo rompe descargas largas.
    """
    did = "a" * 32
    url = ruta.format(did=did)
    codigos = {getattr(client, metodo)(url).status_code for _ in range(120)}
    assert 429 not in codigos, f"{ruta} recibió 429 y está sondeado por el cliente"


# ========================================
# La propia página: nunca se corta
# ========================================

PAGINA = ["/", "/download", "/sw.js", "/manifest.json", "/favicon.png", "/assets/main.js"]


@pytest.mark.parametrize("ruta", PAGINA)
def test_page_itself_is_never_rate_limited(client, ruta):
    """
    Cada carga de la web pide media docena de estos ficheros. Con el límite
    general de 200 por hora e IP, unas treinta recargas bloqueaban la página,
    y en redes móviles, donde muchos usuarios comparten IP, se agotaba entre
    todos. 250 peticiones seguidas superan ese límite sin un solo 429.
    """
    codigos = {client.get(ruta).status_code for _ in range(250)}
    assert 429 not in codigos, f"{ruta} recibió 429: la web dejaría de cargar"


def test_general_limit_still_applies_to_the_api(client):
    """
    Control del test anterior: una ruta de la API sin límite propio sí se
    corta al pasar de 200. Si esto dejara de dar 429, el test de la página
    pasaría aunque el limitador estuviera apagado.
    """
    codigos = [client.get("/api/auth/me").status_code for _ in range(210)]
    assert 429 in codigos, "el límite general de 200 por hora no se está aplicando"


# ========================================
# Endpoints caros: sí se cortan
# ========================================

def test_search_is_limited(client, srv, monkeypatch):
    """20 por minuto: cada petición lanza un yt-dlp de hasta 30 segundos."""
    monkeypatch.setattr(srv.subprocess, "run", lambda *a, **k: pytest.fail("no debe ejecutarse"))

    codigos = []
    for _ in range(25):
        # query de 1 carácter: se rechaza con 400 antes de llamar a yt-dlp,
        # pero el limitador ya ha contado la petición
        codigos.append(client.post("/api/search", json={"query": "a"}).status_code)

    assert 429 in codigos, "‎/api/search no está limitado"
    assert codigos.index(429) >= 20, f"cortó demasiado pronto: en la {codigos.index(429) + 1}"


def test_batch_download_is_limited(client):
    """3 por minuto: es la petición más cara (un coordinador + N descargas)."""
    codigos = [
        client.post("/api/start-batch-download", json={"videos": []}).status_code
        for _ in range(6)
    ]
    assert 429 in codigos


def test_playlist_info_is_limited(client):
    codigos = [
        client.post("/api/playlist-info", json={}).status_code
        for _ in range(15)
    ]
    assert 429 in codigos


def test_rate_limit_error_has_the_api_format(client):
    """El cliente espera siempre {'error': ...}; un 429 en HTML rompería la UI."""
    resp = None
    for _ in range(30):
        resp = client.post("/api/playlist-info", json={})
        if resp.status_code == 429:
            break

    assert resp.status_code == 429
    assert resp.is_json, "el 429 debe ser JSON, no la página HTML de Flask"
    assert "error" in resp.get_json()
    assert "Demasiadas" in resp.get_json()["error"]


def test_limit_is_per_ip(client, srv):
    """Agotar la cuota de una IP no debe afectar a las demás."""
    for _ in range(15):
        client.post("/api/playlist-info", json={},
                    headers={"X-Forwarded-For": "203.0.113.1"})

    otra = client.post("/api/playlist-info", json={},
                       headers={"X-Forwarded-For": "203.0.113.99"})
    assert otra.status_code != 429, "el límite se está aplicando globalmente, no por IP"


# ========================================
# Contención de las descargas en lote (T5)
# ========================================

def test_batch_coordinator_pool_is_bounded(srv):
    """Un hilo por petición era ilimitado; ahora hay un pool acotado."""
    assert srv.batch_executor._max_workers == srv.MAX_BATCH_COORDINATORS
    assert srv.MAX_BATCH_COORDINATORS <= 4


def test_batch_pool_is_separate_from_download_pool(srv):
    """
    Si los coordinadores fuesen al executor principal, varios lotes a la vez
    ocuparían todos los workers esperando a sus propias descargas en ese mismo
    pool: interbloqueo.
    """
    assert srv.batch_executor is not srv.executor


def test_batch_size_is_capped(client, srv):
    videos = [{"url": f"https://youtu.be/v{i:09d}"} for i in range(srv.MAX_BATCH_VIDEOS + 1)]
    resp = client.post("/api/start-batch-download", json={"videos": videos})
    assert resp.status_code == 400
    assert "Máximo" in resp.get_json()["error"]


def test_batch_at_the_limit_is_accepted(client, srv, monkeypatch):
    monkeypatch.setattr(srv.batch_executor, "submit", lambda *a, **k: None)
    videos = [{"url": f"https://youtu.be/v{i:09d}"} for i in range(srv.MAX_BATCH_VIDEOS)]
    resp = client.post("/api/start-batch-download", json={"videos": videos})
    assert resp.status_code == 200
