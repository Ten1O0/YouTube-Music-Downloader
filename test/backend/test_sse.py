"""
Progreso por Server-Sent Events (plan 07, T1 y T2).

El test que más importa es el del respaldo: si SSE falla y el cliente no vuelve
al sondeo, la barra de progreso se queda congelada para siempre y el usuario no
sabe si esperar o reintentar. Aquí se cubre el lado servidor de esa garantía:
que el endpoint rechace limpiamente cuando no puede servir, en vez de colgarse.
"""

import json

import pytest

DID = "a" * 32


def _eventos(respuesta, maximo=10):
    """Extrae los payloads JSON de un flujo SSE."""
    texto = respuesta.get_data(as_text=True)
    salida = []
    for bloque in texto.split("\n\n"):
        linea = bloque.strip()
        if linea.startswith("data: "):
            salida.append(json.loads(linea[6:]))
            if len(salida) >= maximo:
                break
    return salida


# ========================================
# Contrato HTTP
# ========================================

def test_stream_rejects_a_bad_id(client):
    assert client.get("/api/progress/stream/no-valido").status_code == 400


def test_stream_has_event_stream_headers(client, srv):
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    try:
        resp = client.get(f"/api/progress/stream/{DID}")
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["Content-Type"]
        assert "no-cache" in resp.headers["Cache-Control"].lower()
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_stream_disables_nginx_buffering(client, srv):
    """
    Sin X-Accel-Buffering, nginx acumula la respuesta y el cliente no recibe
    nada hasta el final, que es lo contrario del objetivo de SSE.
    """
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    try:
        resp = client.get(f"/api/progress/stream/{DID}")
        assert resp.headers.get("X-Accel-Buffering") == "no"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_stream_is_exempt_from_rate_limiting(client, srv):
    """Es una conexión larga: limitarla por frecuencia no tiene sentido."""
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    try:
        codigos = {client.get(f"/api/progress/stream/{DID}").status_code for _ in range(30)}
        assert 429 not in codigos
    finally:
        srv.forget_download(DID, remove_folder=False)


# ========================================
# Formato y contenido de los eventos
# ========================================

def test_format_sse_is_well_formed(srv):
    salida = srv.format_sse({"status": "downloading"})
    assert salida.startswith("data: ")
    assert salida.endswith("\n\n")
    assert json.loads(salida[6:].strip())["status"] == "downloading"


def test_unknown_download_emits_unknown_and_closes(client, srv):
    resp = client.get(f"/api/progress/stream/{'b' * 32}")
    eventos = _eventos(resp)
    assert eventos, "el flujo no emitió nada"
    assert eventos[0]["status"] == "unknown"


def test_terminal_status_closes_the_stream(client, srv):
    """Un flujo que no cierra deja la conexión abierta media hora."""
    for estado in srv.TERMINAL_STATUSES:
        srv.register_download(DID, 1)
        srv.update_progress(DID, status=estado)
        try:
            eventos = _eventos(client.get(f"/api/progress/stream/{DID}"))
            assert eventos[-1]["status"] == estado
            assert len(eventos) <= 2, f"emitió de más en estado {estado}"
        finally:
            srv.forget_download(DID, remove_folder=False)


def test_stream_carries_code_and_params(client, srv):
    srv.register_download(DID, 3)
    srv.update_progress(DID, status="complete", code="complete_n", params={"count": 3})
    try:
        evento = _eventos(client.get(f"/api/progress/stream/{DID}"))[-1]
        assert evento["code"] == "complete_n"
        assert evento["params"] == {"count": 3}
        assert evento["message"], "message debe seguir viniendo como respaldo"
    finally:
        srv.forget_download(DID, remove_folder=False)


# ========================================
# Contención de conexiones
# ========================================

def test_connection_limit_is_bounded(srv):
    assert srv.SSE_MAX_CONNECTIONS > 0
    assert srv.SSE_MAX_CONNECTIONS <= 100


def test_no_free_slot_returns_503(client, srv):
    """
    Sin hueco, el cliente debe recibir un rechazo inmediato para poder caer al
    sondeo. Colgarse esperando sería peor que no ofrecer SSE.
    """
    srv.register_download(DID, 1)
    adquiridos = 0
    try:
        while srv._sse_connections.acquire(blocking=False):
            adquiridos += 1

        resp = client.get(f"/api/progress/stream/{DID}")
        assert resp.status_code == 503
        assert resp.get_json()["code"] == "sse_unavailable"
    finally:
        for _ in range(adquiridos):
            srv._sse_connections.release()
        srv.forget_download(DID, remove_folder=False)


def test_slot_is_released_after_the_stream(client, srv):
    """Sin el finally, un cliente que corta se queda un hueco para siempre."""
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete")
    try:
        for _ in range(5):
            client.get(f"/api/progress/stream/{DID}").get_data()

        # Si los huecos no se liberasen, estos cinco ya estarían perdidos
        assert srv._sse_connections.acquire(blocking=False)
        srv._sse_connections.release()
    finally:
        srv.forget_download(DID, remove_folder=False)


# ========================================
# El sondeo sigue existiendo como respaldo
# ========================================

def test_polling_endpoint_still_works(client, srv):
    """SSE no sustituye al sondeo: lo adelanta. El respaldo debe seguir entero."""
    srv.register_download(DID, 2)
    srv.update_progress(DID, status="downloading", current=1)
    try:
        resp = client.get(f"/api/progress/{DID}")
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "downloading"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_polling_also_carries_codes(client, srv):
    srv.register_download(DID, 1)
    srv.update_progress(DID, status="complete", code="complete_n", params={"count": 1})
    try:
        datos = client.get(f"/api/progress/{DID}").get_json()
        assert datos["code"] == "complete_n"
        assert datos["params"]["count"] == 1
    finally:
        srv.forget_download(DID, remove_folder=False)


# ========================================
# Códigos de mensaje (T2)
# ========================================

@pytest.mark.parametrize("campo", ["code", "params"])
def test_register_download_sets_the_code(srv, campo):
    srv.register_download(DID, 1)
    try:
        assert campo in srv.download_progress[DID]
        assert srv.download_progress[DID]["code"] == "starting"
    finally:
        srv.forget_download(DID, remove_folder=False)


def test_message_is_kept_alongside_the_code(srv):
    """
    El `message` en castellano sigue viniendo como respaldo: un cliente antiguo
    que no entienda `code` debe seguir pintando algo legible.
    """
    srv.register_download(DID, 1)
    try:
        entrada = srv.download_progress[DID]
        assert entrada["message"]
        assert entrada["code"]
    finally:
        srv.forget_download(DID, remove_folder=False)
