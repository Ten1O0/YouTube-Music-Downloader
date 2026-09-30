"""
Miniaturas ligeras en la base (plan 19): ni un base64 en favoritos ni en el
historial. En producción, 24 favoritos con la miniatura en base64 ocupaban
12,5 de los 13 MB de la base y viajaban en cada sincronización.
"""

import pytest

VID = "dQw4w9WgXcQ"
YTIMG = f"https://i.ytimg.com/vi/{VID}/mqdefault.jpg"
BASE64 = "data:image/jpeg;base64," + "A" * 40_000


@pytest.mark.parametrize("entrada, esperada", [
    (BASE64, YTIMG),
    ("https://i.ytimg.com/vi/otro/hqdefault.jpg", "https://i.ytimg.com/vi/otro/hqdefault.jpg"),
    ("https://example.com/" + "x" * 600, YTIMG),
    ("http://localhost/_capacitor_file_/data/miniaturas/x.jpg", YTIMG),
    ("", YTIMG),
    (None, YTIMG),
])
def test_only_short_https_links_are_kept(db, entrada, esperada):
    assert db.miniatura_segura(entrada, VID) == esperada


def test_without_a_valid_video_id_there_is_no_thumbnail(db):
    assert db.miniatura_segura(BASE64, "malo") == ""


def test_a_favorite_with_a_base64_thumbnail_is_stored_as_a_link(db, user):
    db.add_favorite(user["id"], {"id": VID, "title": "T", "thumbnail": BASE64, "url": "u"})
    assert db.get_favorites(user["id"])[0]["thumbnail"] == YTIMG


def test_history_and_first_sync_also_clean_thumbnails(db, user):
    db.add_history(user["id"], {"id": VID, "title": "T", "thumbnail": BASE64, "url": "u"})
    otro = "aaaaaaaaaaa"
    db.sync_user_data(user["id"], [{"id": otro, "thumbnail": BASE64}], [{"id": otro, "thumbnail": BASE64, "url": "u"}])
    conn = db.get_db()
    miniaturas = [r[0] for r in conn.execute("SELECT thumbnail FROM download_history UNION ALL SELECT thumbnail FROM favorites")]
    conn.close()
    assert miniaturas and all(m.startswith("https://i.ytimg.com/") for m in miniaturas)


def test_existing_base64_thumbnails_are_fixed_once_on_start(db, user):
    conn = db.get_db()
    conn.execute("INSERT INTO favorites (user_id, video_id, title, thumbnail, url) VALUES (?, ?, 'T', ?, 'u')",
                 (user["id"], VID, BASE64))
    conn.execute("INSERT INTO favorites (user_id, video_id, title, thumbnail, url) VALUES (?, 'malo', 'T', ?, 'u')",
                 (user["id"], BASE64))
    conn.execute("INSERT INTO favorites (user_id, video_id, title, thumbnail, url) VALUES (?, 'bbbbbbbbbbb', 'T', 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg', 'u')",
                 (user["id"],))
    conn.commit()
    conn.close()

    db.init_db()
    conn = db.get_db()
    filas = dict(conn.execute("SELECT video_id, thumbnail FROM favorites"))
    conn.close()
    assert filas[VID] == YTIMG
    assert filas["malo"] == ""
    # Lo que ya era un enlace, igual
    assert filas["bbbbbbbbbbb"] == "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg"

    # Idempotente: una segunda vez no cambia nada
    conn = db.get_db()
    assert db._miniaturas_a_enlace(conn) == 0
    conn.close()
