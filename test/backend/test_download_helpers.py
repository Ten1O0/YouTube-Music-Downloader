"""
Helpers del flujo de descarga: resolución de la entrada, construcción de los
comandos de yt-dlp, parseo de su salida JSON y utilidades de ficheros.

Los tests de comandos son importantes porque cualquier argumento que se pierda
cambia silenciosamente el formato de audio o rompe la descarga entera.
"""

import json
import os
import zipfile

import pytest


# ========================================
# resolve_download_input
# ========================================

def test_plain_text_becomes_a_search(srv):
    query, content_type, content_id, total = srv.resolve_download_input("bad bunny")
    assert query == "ytsearch:bad bunny"
    assert content_type == "search"
    assert content_id is None
    assert total == 1


def test_video_url_is_passed_through_verbatim(srv):
    url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    query, content_type, content_id, total = srv.resolve_download_input(url)
    assert query == url
    assert content_type == "video"
    assert content_id == "dQw4w9WgXcQ"
    assert total == 1


def test_shorts_url_resolves(srv):
    query, content_type, _, total = srv.resolve_download_input(
        "https://www.youtube.com/shorts/dQw4w9WgXcQ"
    )
    assert content_type == "shorts"
    assert total == 1


def test_invalid_url_raises(srv):
    """Tipo propio desde el plan 06 T1: distingue entrada inválida de fallo interno."""
    with pytest.raises(srv.InvalidInputError):
        srv.resolve_download_input("https://vimeo.com/12345")


def test_search_with_special_characters(srv):
    query, content_type, _, _ = srv.resolve_download_input("AC/DC - Thunderstruck")
    assert content_type == "search"
    assert query.startswith("ytsearch:")


def test_playlist_builds_canonical_url(srv, monkeypatch):
    """Una playlist normal se reescribe a la URL canónica /playlist?list=..."""
    monkeypatch.setattr(srv, "get_playlist_count", lambda url: 7)
    query, content_type, content_id, total = srv.resolve_download_input(
        "https://www.youtube.com/watch?v=abc&list=PLreal123"
    )
    assert content_type == "playlist"
    assert query == "https://www.youtube.com/playlist?list=PLreal123"
    assert total == 7


def test_mix_playlist_keeps_original_url(srv, monkeypatch):
    """Las Mix (RD...) no existen como /playlist?list=, hay que conservar la URL."""
    original = "https://www.youtube.com/watch?v=abc12345678&list=RDabc12345678"
    monkeypatch.setattr(srv, "get_playlist_count", lambda url: 25)
    query, content_type, content_id, _ = srv.resolve_download_input(original)
    assert content_type == "playlist"
    assert content_id.startswith("RD")
    assert query == original


def test_playlist_count_failure_yields_zero(srv, monkeypatch):
    monkeypatch.setattr(srv, "get_playlist_count", lambda url: None)
    _, _, _, total = srv.resolve_download_input(
        "https://www.youtube.com/playlist?list=PLx"
    )
    assert total == 0


# ========================================
# build_ytdlp_download_cmd
# ========================================

def test_download_cmd_core_flags(srv):
    cmd = srv.build_ytdlp_download_cmd("video", "https://youtu.be/dQw4w9WgXcQ")
    assert "-x" in cmd, "falta la extracción de audio"
    assert "--audio-format" in cmd
    assert cmd[cmd.index("--audio-format") + 1] == "m4a"
    assert "--embed-thumbnail" in cmd
    assert "--add-metadata" in cmd
    assert "--ignore-errors" in cmd
    assert cmd[-1] == "https://youtu.be/dQw4w9WgXcQ"


def test_single_video_disables_playlist(srv):
    cmd = srv.build_ytdlp_download_cmd("video", "url")
    assert "--no-playlist" in cmd


def test_playlist_does_not_disable_playlist(srv):
    cmd = srv.build_ytdlp_download_cmd("playlist", "url")
    assert "--no-playlist" not in cmd


def test_output_template_is_the_title(srv):
    cmd = srv.build_ytdlp_download_cmd("video", "url")
    assert cmd[cmd.index("-o") + 1] == "%(title)s.%(ext)s"


def test_ffmpeg_location_is_passed(srv):
    cmd = srv.build_ytdlp_download_cmd("video", "url")
    assert "--ffmpeg-location" in cmd


def test_ffmpeg_is_taken_from_path(srv):
    """
    En macOS Homebrew instala ffmpeg en /opt/homebrew/bin. Con la ruta de
    Linux fijada, yt-dlp no lo encontraba y toda descarga real fallaba.
    """
    assert srv.find_ffmpeg(lambda _: "/opt/homebrew/bin/ffmpeg") == "/opt/homebrew/bin/ffmpeg"


def test_ffmpeg_falls_back_to_the_linux_path(srv):
    """Si no está en el PATH (servicio con PATH mínimo), se usa el de apt."""
    assert srv.find_ffmpeg(lambda _: None) == "/usr/bin/ffmpeg"


def test_command_is_a_list_not_a_shell_string(srv):
    """
    Invariante de seguridad: el comando se pasa como lista a subprocess,
    nunca como cadena con shell=True. Si esto cambia, hay inyección de comandos.
    """
    cmd = srv.build_ytdlp_download_cmd("video", "url; rm -rf /")
    assert isinstance(cmd, list)
    assert cmd[-1] == "url; rm -rf /"   # el argumento viaja entero, sin interpretar


def test_url_is_always_the_last_argument(srv):
    for content_type in ("video", "playlist", "shorts", "search"):
        cmd = srv.build_ytdlp_download_cmd(content_type, "LA-URL")
        assert cmd[-1] == "LA-URL"


# ========================================
# build_playlist_cmd
# ========================================

def test_playlist_cmd_uses_canonical_url(srv):
    cmd = srv.build_playlist_cmd("https://youtube.com/watch?v=x&list=PLabc", "PLabc")
    assert "https://www.youtube.com/playlist?list=PLabc" in cmd
    assert "--flat-playlist" in cmd
    assert "--dump-json" in cmd


def test_mix_cmd_limits_results(srv):
    """Las Mix son infinitas: hay que cortarlas o la petición no termina."""
    cmd = srv.build_playlist_cmd("https://youtube.com/watch?v=x&list=RDabc", "RDabc")
    assert "--playlist-end" in cmd
    assert cmd[cmd.index("--playlist-end") + 1] == "35"


def test_normal_playlist_has_no_limit(srv):
    cmd = srv.build_playlist_cmd("https://youtube.com/playlist?list=PLabc", "PLabc")
    assert "--playlist-end" not in cmd


# ========================================
# parse_video_json_output
# ========================================

def _line(**kwargs):
    return json.dumps(kwargs)


def test_parses_single_video(srv):
    out = _line(id="abc12345678", title="Mi canción", duration=210, channel="Canal")
    videos = srv.parse_video_json_output(out)
    assert len(videos) == 1
    v = videos[0]
    assert v["id"] == "abc12345678"
    assert v["title"] == "Mi canción"
    assert v["duration"] == 210
    assert v["channel"] == "Canal"
    assert v["url"] == "https://www.youtube.com/watch?v=abc12345678"
    assert v["thumbnail"] == "https://i.ytimg.com/vi/abc12345678/mqdefault.jpg"


def test_parses_multiple_lines(srv):
    out = "\n".join([_line(id=f"vid{i:08d}", title=f"T{i}") for i in range(5)])
    assert len(srv.parse_video_json_output(out)) == 5


def test_skips_entries_without_id(srv):
    out = "\n".join([_line(title="sin id"), _line(id="ok123456789", title="con id")])
    videos = srv.parse_video_json_output(out)
    assert len(videos) == 1
    assert videos[0]["id"] == "ok123456789"


def test_skips_malformed_json(srv):
    out = "\n".join(["{no es json}", _line(id="ok123456789"), "otra basura"])
    assert len(srv.parse_video_json_output(out)) == 1


def test_skips_blank_lines(srv):
    out = f"\n\n{_line(id='ok123456789')}\n\n"
    assert len(srv.parse_video_json_output(out)) == 1


def test_empty_output_yields_empty_list(srv):
    assert srv.parse_video_json_output("") == []
    assert srv.parse_video_json_output("\n\n\n") == []


def test_falls_back_to_uploader_when_no_channel(srv):
    videos = srv.parse_video_json_output(_line(id="ok123456789", uploader="Subidor"))
    assert videos[0]["channel"] == "Subidor"


def test_default_title_and_channel(srv):
    videos = srv.parse_video_json_output(_line(id="ok123456789"))
    assert videos[0]["title"] == "Sin título"
    assert videos[0]["channel"] == "Canal desconocido"


def test_unicode_titles_survive(srv):
    videos = srv.parse_video_json_output(
        _line(id="ok123456789", title="Cançó 日本語 🎵 Ñandú")
    )
    assert videos[0]["title"] == "Cançó 日本語 🎵 Ñandú"


# ========================================
# count_downloaded_files
# ========================================

def test_counts_only_audio(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["a.m4a", "b.mp3", "c.opus", "notas.txt", "x.part"])
    assert srv.count_downloaded_files(str(folder)) == 3


def test_count_is_case_insensitive(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["A.M4A", "B.Mp3"])
    assert srv.count_downloaded_files(str(folder)) == 2


def test_count_on_missing_folder_is_zero(srv, tmp_path):
    assert srv.count_downloaded_files(str(tmp_path / "no-existe")) == 0


def test_count_on_empty_folder_is_zero(srv, tmp_path):
    folder = tmp_path / "vacia"
    folder.mkdir()
    assert srv.count_downloaded_files(str(folder)) == 0


def test_all_supported_extensions_count(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    names = [f"f{i}{ext}" for i, ext in enumerate(srv.AUDIO_EXTENSIONS)]
    make_audio_files(str(folder), names)
    assert srv.count_downloaded_files(str(folder)) == len(srv.AUDIO_EXTENSIONS)


# ========================================
# cleanup_temp_folder
# ========================================

def test_cleanup_removes_folder(srv, tmp_path, make_audio_files):
    folder = tmp_path / "borrar"
    make_audio_files(str(folder), ["a.m4a"])
    assert folder.exists()
    srv.cleanup_temp_folder(str(folder))
    assert not folder.exists()


def test_cleanup_on_missing_folder_is_silent(srv, tmp_path):
    srv.cleanup_temp_folder(str(tmp_path / "no-existe"))  # no debe lanzar


# ========================================
# create_zip_from_folder
# ========================================

def test_zip_contains_only_audio(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["a.m4a", "b.mp3", "notas.txt"])
    zip_path = srv.create_zip_from_folder(str(folder), "prueba")
    assert zip_path and os.path.exists(zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert "a.m4a" in names
    assert "b.mp3" in names
    assert "notas.txt" not in names


def test_zip_is_flat(srv, tmp_path, make_audio_files):
    """Los ficheros van en la raíz del ZIP, sin recrear rutas del servidor."""
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["a.m4a"])
    zip_path = srv.create_zip_from_folder(str(folder), "prueba")
    with zipfile.ZipFile(zip_path) as zf:
        assert all("/" not in n for n in zf.namelist())


def test_zip_of_empty_folder(srv, tmp_path):
    folder = tmp_path / "vacia"
    folder.mkdir()
    zip_path = srv.create_zip_from_folder(str(folder), "vacio")
    if zip_path and os.path.exists(zip_path):
        with zipfile.ZipFile(zip_path) as zf:
            assert zf.namelist() == []


def test_zip_preserves_unicode_names(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["Cançó Ñandú.m4a"])
    zip_path = srv.create_zip_from_folder(str(folder), "uni")
    with zipfile.ZipFile(zip_path) as zf:
        assert any("Ñandú" in n for n in zf.namelist())


# ========================================
# infer_title_from_folder
# ========================================

def test_infers_title_from_audio_file(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["Mi Canción.m4a"])
    assert srv.infer_title_from_folder(str(folder)) == "Mi Canción"


def test_strips_double_extension(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["Cancion.f140.m4a"])
    assert srv.infer_title_from_folder(str(folder)) == "Cancion"


def test_ignores_placeholder_names(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["download.m4a"])
    assert srv.infer_title_from_folder(str(folder)) is None


def test_missing_folder_yields_none(srv, tmp_path):
    assert srv.infer_title_from_folder(str(tmp_path / "no-existe")) is None


def test_folder_without_audio_yields_none(srv, tmp_path, make_audio_files):
    folder = tmp_path / "d"
    make_audio_files(str(folder), ["leeme.txt"])
    assert srv.infer_title_from_folder(str(folder)) is None


# ========================================
# Formato de audio (plan 05, T1)
# ========================================

def test_default_format_is_m4a(srv):
    assert srv.resolve_audio_format({}) == "m4a"
    assert srv.DEFAULT_AUDIO_FORMAT == "m4a"


@pytest.mark.parametrize("entrada,esperado", [
    ({"format": "m4a"}, "m4a"),
    ({"format": "mp3"}, "mp3"),
    ({"format": "MP3"}, "mp3"),
    ({"format": " mp3 "}, "mp3"),
])
def test_allowed_formats_are_accepted(srv, entrada, esperado):
    assert srv.resolve_audio_format(entrada) == esperado


@pytest.mark.parametrize("fmt", [
    "flac", "wav", "ogg", "opus",        # formatos reales pero no ofrecidos
    "", "  ", "../etc/passwd",
    "mp3; rm -rf /", "mp3 && curl evil.com", "m4a|nc evil.com",
])
def test_unsupported_formats_are_rejected(srv, fmt):
    """
    El formato viene del cliente y acaba en --audio-format de yt-dlp. No hay
    inyección de shell posible (el comando es una lista), pero un valor
    arbitrario provocaría un fallo opaco a mitad de descarga.
    """
    with pytest.raises(srv.InvalidInputError):
        srv.resolve_audio_format({"format": fmt})


def test_quality_is_accepted_and_ignored(srv):
    """Una APK antigua sigue mandando `quality`; no debe romper la petición."""
    assert srv.resolve_audio_format({"quality": "320"}) == "m4a"
    assert srv.resolve_audio_format({"quality": "320", "format": "mp3"}) == "mp3"


def test_none_payload_uses_the_default(srv):
    assert srv.resolve_audio_format(None) == "m4a"


# ---------- Argumentos generados ----------

def test_m4a_remuxes_without_reencoding(srv):
    """m4a debe conservar el flujo original: calidad intacta y CPU cero."""
    args = srv.audio_format_args("m4a")
    assert args[args.index("--audio-format") + 1] == "m4a"
    assert "bestaudio[ext=m4a]/bestaudio" in args


def test_mp3_requests_a_reasonable_bitrate(srv):
    """La fuente es AAC ~128 kbps: V0 solo inflaría el fichero sin ganar nada."""
    args = srv.audio_format_args("mp3")
    assert args[args.index("--audio-format") + 1] == "mp3"
    assert args[args.index("--audio-quality") + 1] == "2"


@pytest.mark.parametrize("fmt", ["m4a", "mp3"])
def test_command_carries_the_requested_format(srv, fmt):
    cmd = srv.build_ytdlp_download_cmd("video", "URL", fmt)
    assert cmd[cmd.index("--audio-format") + 1] == fmt


@pytest.mark.parametrize("fmt", ["m4a", "mp3"])
def test_both_formats_keep_metadata_and_cover(srv, fmt):
    """
    Verificado además con descargas reales: los dos formatos salen con carátula
    embebida y con título y artista. Sin --embed-thumbnail el mp3 saldría pelado.
    """
    cmd = srv.build_ytdlp_audio_cmd("URL", fmt)
    assert "--embed-thumbnail" in cmd
    assert "--add-metadata" in cmd


def test_single_command_keeps_its_specific_flags(srv):
    """Las diferencias entre las dos rutas eran intencionadas, no ruido."""
    cmd = srv.build_ytdlp_audio_cmd("URL", "m4a", batch_item=False)
    assert "--print" in cmd
    assert "--encoding" in cmd
    assert "--user-agent" not in cmd


def test_batch_command_keeps_its_specific_flags(srv):
    cmd = srv.build_ytdlp_audio_cmd("URL", "m4a", batch_item=True)
    assert "--user-agent" in cmd
    assert "--no-warnings" in cmd
    assert "--print" not in cmd


def test_playlist_command_does_not_disable_playlist(srv):
    assert "--no-playlist" not in srv.build_ytdlp_download_cmd("playlist", "URL", "mp3")


def test_transcode_semaphore_is_bounded(srv):
    """
    Solo mp3 pasa por ffmpeg. Sin techo, una playlist de 50 canciones lanzaría
    5 transcodificaciones en paralelo sobre 2 núcleos.
    """
    assert srv.MAX_TRANSCODES >= 1
    assert srv.MAX_TRANSCODES < srv.MAX_WORKERS
    assert srv.transcode_slots is not None


# ---------- Endpoints ----------

def test_start_download_rejects_a_bad_format(client):
    resp = client.post("/api/start-download", json={
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "format": "flac"})
    assert resp.status_code == 400
    assert "formato" in resp.get_json()["error"].lower()


def test_start_download_echoes_the_format(client, srv, monkeypatch):
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(srv, "prefetch_video_metadata", lambda *a, **k: None)

    resp = client.post("/api/start-download", json={
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "format": "mp3"})
    assert resp.status_code == 200
    assert resp.get_json()["format"] == "mp3"


def test_batch_download_rejects_a_bad_format(client):
    resp = client.post("/api/start-batch-download", json={
        "videos": [{"url": "https://youtu.be/v000000001"}], "format": "wav"})
    assert resp.status_code == 400


def test_batch_download_echoes_the_format(client, srv, monkeypatch):
    monkeypatch.setattr(srv.batch_executor, "submit", lambda *a, **k: None)
    resp = client.post("/api/start-batch-download", json={
        "videos": [{"url": "https://youtu.be/v000000001"}], "format": "mp3"})
    assert resp.get_json()["format"] == "mp3"


def test_format_is_recorded_in_progress(client, srv, monkeypatch):
    """El cliente lo lee del progreso para saber qué extensión esperar."""
    monkeypatch.setattr(srv.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(srv, "prefetch_video_metadata", lambda *a, **k: None)

    did = client.post("/api/start-download", json={
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "format": "mp3"}).get_json()["download_id"]

    assert srv.download_progress[did]["format"] == "mp3"
