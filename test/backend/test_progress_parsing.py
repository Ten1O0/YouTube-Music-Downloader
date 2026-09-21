"""
Parseo del progreso de yt-dlp.

Estas funciones leen stdout de un proceso externo cuyo formato puede cambiar
entre versiones. Si se rompen, la barra de progreso miente o se queda colgada,
que es el síntoma más visible para el usuario.
"""

import pytest

# Identificadores con el formato actual: 32 hex (plan 02, T7)
DID = "a" * 32
DID_INEXISTENTE = "d" * 32


# ========================================
# is_progress_line
# ========================================

@pytest.mark.parametrize("line", [
    "[download]  45.2% of 3.50MiB at 1.20MiB/s ETA 00:02",
    "[download] 100% of 3.50MiB in 00:03",
    "[download]   0.0% of ~5.00MiB at Unknown B/s ETA Unknown",
])
def test_detects_progress_lines(srv, line):
    assert srv.is_progress_line(line) is True


@pytest.mark.parametrize("line", [
    "[youtube] dQw4w9WgXcQ: Downloading webpage",
    "[download] Destination: cancion.m4a",
    "[ExtractAudio] Destination: cancion.m4a",
    "ERROR: Video unavailable",
    "",
    "100%",                       # sin la marca [download]
    "[download] Resuming download",
])
def test_ignores_non_progress_lines(srv, line):
    assert srv.is_progress_line(line) is False


# ========================================
# parse_ytdlp_progress_line
# ========================================

def test_parses_full_progress_line(srv):
    percent, speed, eta = srv.parse_ytdlp_progress_line(
        "[download]  45.2% of 3.50MiB at 1.20MiB/s ETA 00:02"
    )
    assert percent == "45.2%"
    assert speed == "1.20MiB/s"
    assert eta == "00:02"


def test_parses_line_without_eta(srv):
    percent, speed, eta = srv.parse_ytdlp_progress_line(
        "[download] 100% of 3.50MiB at 2.00MiB/s"
    )
    assert percent == "100%"
    assert speed == "2.00MiB/s"
    assert eta == ""


def test_parses_line_without_speed(srv):
    percent, speed, eta = srv.parse_ytdlp_progress_line("[download] 50% of 3.50MiB")
    assert percent == "50%"
    assert speed == ""
    assert eta == ""


def test_unknown_values_do_not_crash(srv):
    percent, speed, eta = srv.parse_ytdlp_progress_line(
        "[download]   0.0% of ~5.00MiB at Unknown B/s ETA Unknown"
    )
    assert percent == "0.0%"
    assert eta == "Unknown"


def test_line_without_percent_gets_default(srv):
    percent, _, _ = srv.parse_ytdlp_progress_line("[download] Destination: x.m4a")
    assert percent == "0%"


def test_empty_line_does_not_crash(srv):
    percent, speed, eta = srv.parse_ytdlp_progress_line("")
    assert percent == "0%"
    assert speed == ""
    assert eta == ""


def test_eta_at_end_without_value(srv):
    """'ETA' como última palabra no debe provocar IndexError."""
    percent, _, eta = srv.parse_ytdlp_progress_line("[download] 10% of 1MiB ETA")
    assert percent == "10%"
    assert eta == ""


def test_at_at_end_without_value(srv):
    percent, speed, _ = srv.parse_ytdlp_progress_line("[download] 10% of 1MiB at")
    assert percent == "10%"
    assert speed == ""


def test_fragment_progress_line(srv):
    """Las descargas por fragmentos añaden texto extra al final."""
    percent, speed, eta = srv.parse_ytdlp_progress_line(
        "[download]  33.3% of ~ 10.00MiB at    500.00KiB/s ETA 00:14 (frag 2/6)"
    )
    assert percent == "33.3%"
    assert eta == "00:14"


# ========================================
# format_download_status
# ========================================

def test_status_with_all_parts(srv):
    msg = srv.format_download_status("50%", "1.2MiB/s", "00:10")
    assert "50%" in msg
    assert "1.2MiB/s" in msg
    assert "00:10" in msg
    assert msg.startswith("Descargando:")


def test_status_without_speed(srv):
    msg = srv.format_download_status("50%", "", "00:10")
    assert "50%" in msg
    assert "()" not in msg


def test_status_without_eta(srv):
    msg = srv.format_download_status("50%", "1.2MiB/s", "")
    assert "ETA" not in msg


def test_status_only_percent(srv):
    assert srv.format_download_status("7%", "", "") == "Descargando: 7%"


# ========================================
# update_download_progress
# ========================================

def test_updates_existing_entry(srv):
    srv.download_progress[DID] = {"status": "downloading"}
    try:
        srv.update_download_progress(
            DID, "[download]  42.0% of 3.50MiB at 1.20MiB/s ETA 00:02"
        )
        assert srv.download_progress[DID]["percent"] == "42.0%"
        assert "42.0%" in srv.download_progress[DID]["message"]
    finally:
        srv.download_progress.pop(DID, None)


def test_unknown_id_does_not_create_entry(srv):
    """No debe crear entradas fantasma: eso sería una fuga de memoria."""
    before = set(srv.download_progress.keys())
    srv.update_download_progress("no-existe", "[download] 10% of 1MiB")
    assert set(srv.download_progress.keys()) == before


def test_malformed_line_does_not_raise(srv):
    srv.download_progress[DID] = {"status": "downloading"}
    try:
        for line in ["", "basura", "[download] %%%%", None]:
            srv.update_download_progress(DID, line)  # no debe lanzar
    finally:
        srv.download_progress.pop(DID, None)


# ========================================
# is_download_cancelled
# ========================================

def test_not_cancelled_by_default(srv, cancel_event):
    cancel_event("abc123", cancelled=False)
    assert srv.is_download_cancelled("abc123") is False


def test_detects_cancellation(srv, cancel_event):
    cancel_event("abc123", cancelled=True)
    assert srv.is_download_cancelled("abc123") is True


def test_unknown_id_is_not_cancelled(srv):
    assert srv.is_download_cancelled("jamas-registrado") is False
