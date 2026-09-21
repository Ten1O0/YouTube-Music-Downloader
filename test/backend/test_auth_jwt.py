"""
Emisión y validación de tokens JWT.

Un fallo aquí significa suplantación de cuentas, así que se cubren también los
ataques clásicos: alg=none, firma cambiada, token de otro secreto y caducidad.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest


# ========================================
# create_jwt_token
# ========================================

def test_token_is_issued_and_decodes(srv):
    token = srv.create_jwt_token(42)
    payload = jwt.decode(token, srv.JWT_SECRET, algorithms=["HS256"])
    assert payload["user_id"] == 42


def test_token_carries_expiry_and_issued_at(srv):
    payload = jwt.decode(
        srv.create_jwt_token(1), srv.JWT_SECRET, algorithms=["HS256"]
    )
    assert "exp" in payload
    assert "iat" in payload
    assert payload["exp"] > payload["iat"]


def test_expiry_matches_configuration(srv):
    payload = jwt.decode(
        srv.create_jwt_token(1), srv.JWT_SECRET, algorithms=["HS256"]
    )
    vida_horas = (payload["exp"] - payload["iat"]) / 3600
    assert abs(vida_horas - srv.JWT_EXPIRATION_HOURS) < 1


def test_different_users_get_different_tokens(srv):
    assert srv.create_jwt_token(1) != srv.create_jwt_token(2)


def test_algorithm_is_hs256(srv):
    header = jwt.get_unverified_header(srv.create_jwt_token(1))
    assert header["alg"] == "HS256"


# ========================================
# get_current_user: camino correcto
# ========================================

def test_valid_token_resolves_to_user(srv, db, user, monkeypatch):
    monkeypatch.setattr(srv, "db", db)
    token = srv.create_jwt_token(user["id"])
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {token}"}):
        resolved = srv.get_current_user()
    assert resolved is not None
    assert resolved["email"] == user["email"]


# ========================================
# get_current_user: rechazos
# ========================================

@pytest.mark.parametrize("header", [
    "",
    "Bearer",
    "Bearer ",
    "basura",
    "Basic dXNlcjpwYXNz",
    "bearer token-en-minuscula",
    "Token abc123",
])
def test_malformed_authorization_header_is_rejected(srv, header):
    with srv.app.test_request_context(headers={"Authorization": header}):
        assert srv.get_current_user() is None


def test_missing_header_is_rejected(srv):
    with srv.app.test_request_context():
        assert srv.get_current_user() is None


def test_garbage_token_is_rejected(srv):
    with srv.app.test_request_context(headers={"Authorization": "Bearer no.es.jwt"}):
        assert srv.get_current_user() is None


def test_expired_token_is_rejected(srv):
    payload = {
        "user_id": 1,
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
    }
    caducado = jwt.encode(payload, srv.JWT_SECRET, algorithm="HS256")
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {caducado}"}):
        assert srv.get_current_user() is None


def test_token_signed_with_another_secret_is_rejected(srv):
    ajeno = jwt.encode(
        {"user_id": 1, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "otro-secreto-distinto",
        algorithm="HS256",
    )
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {ajeno}"}):
        assert srv.get_current_user() is None


def test_alg_none_attack_is_rejected(srv):
    """
    El ataque clásico: firmar con alg=none para saltarse la verificación.
    PyJWT debe rechazarlo porque decode() fija algorithms=['HS256'].
    """
    sin_firma = jwt.encode(
        {"user_id": 1, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        key="",
        algorithm="none",
    )
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {sin_firma}"}):
        assert srv.get_current_user() is None


def test_tampered_signature_is_rejected(srv):
    token = srv.create_jwt_token(1)
    cabecera, cuerpo, firma = token.split(".")
    manipulado = f"{cabecera}.{cuerpo}.{firma[:-4]}XXXX"
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {manipulado}"}):
        assert srv.get_current_user() is None


def test_tampered_payload_is_rejected(srv):
    """Cambiar user_id sin recalcular la firma no debe colar."""
    import base64
    import json as _json

    token = srv.create_jwt_token(1)
    cabecera, cuerpo, firma = token.split(".")
    relleno = "=" * (-len(cuerpo) % 4)
    datos = _json.loads(base64.urlsafe_b64decode(cuerpo + relleno))
    datos["user_id"] = 999
    nuevo = base64.urlsafe_b64encode(_json.dumps(datos).encode()).decode().rstrip("=")

    with srv.app.test_request_context(headers={"Authorization": f"{'Bearer'} {cabecera}.{nuevo}.{firma}"}):
        assert srv.get_current_user() is None


def test_valid_token_of_deleted_user_returns_none(srv, db, monkeypatch):
    """Token bien firmado pero cuyo usuario ya no existe en la base de datos."""
    monkeypatch.setattr(srv, "db", db)
    token = srv.create_jwt_token(999999)
    with srv.app.test_request_context(headers={"Authorization": f"Bearer {token}"}):
        assert srv.get_current_user() is None


# ========================================
# Configuración del secreto
# ========================================

def test_secret_is_configured(srv):
    assert srv.JWT_SECRET
    assert len(srv.JWT_SECRET) >= 16


def test_server_refuses_to_start_without_secret():
    """
    Sin JWT_SECRET el servidor debe abortar, no arrancar con un valor conocido:
    un fallo silencioso y permanente es peor que uno ruidoso e inmediato.

    Se ejecuta en un subproceso para no recargar el módulo `server` en mitad
    de la suite, que dejaría al resto de tests apuntando a otra instancia.
    """
    import os
    import subprocess
    import sys

    raiz = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    entorno = {k: v for k, v in os.environ.items() if k != "JWT_SECRET"}

    proc = subprocess.run(
        [sys.executable, "-c", "import server"],
        cwd=raiz, env=entorno, capture_output=True, text=True, timeout=60,
    )

    assert proc.returncode != 0, "el servidor arrancó sin JWT_SECRET"
    assert "JWT_SECRET" in proc.stderr
    assert "RuntimeError" in proc.stderr


def test_secret_must_not_have_a_hardcoded_default(srv):
    """
    Antes, si la variable no estaba definida el servidor arrancaba con un
    secreto conocido y publicado en el repositorio. Corregido en el plan 02 T1:
    ahora aborta el arranque.
    """
    assert "change-in-production" not in srv.JWT_SECRET
    assert "yt-music-downloader-secret" not in srv.JWT_SECRET


# ========================================
# Decorador auth_required
# ========================================

@pytest.mark.parametrize("method,path", [
    ("get", "/api/user/history"),
    ("post", "/api/user/history"),
    ("delete", "/api/user/history"),
    ("get", "/api/user/favorites"),
    ("post", "/api/user/favorites"),
    ("delete", "/api/user/favorites/abc123"),
    ("post", "/api/user/sync"),
])
def test_protected_endpoints_require_auth(client, method, path):
    resp = getattr(client, method)(path)
    assert resp.status_code == 401


def test_protected_endpoint_rejects_invalid_token(client):
    resp = client.get(
        "/api/user/history", headers={"Authorization": "Bearer token-falso"}
    )
    assert resp.status_code == 401


def test_auth_me_without_token_is_not_authenticated(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code in (200, 401)
    if resp.status_code == 200:
        assert resp.get_json().get("authenticated") is False
