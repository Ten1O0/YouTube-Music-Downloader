/**
 * Importar audio (plan 20, T4): qué se importa, y qué vídeo es cada fichero.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_BYTES, cabeEnElNavegador, esAudio, repartirImportacion, tituloDeFichero, videoIdDeMetadatos,
} from '../../frontend/src/features/library/importar-audio.js';

test('videoId desde el comentario que escribe yt-dlp (MP4: texto)', () => {
    const comentario = 'https://www.youtube.com/watch?v=Rt9tW3cMLhI\nShop the collection: https://…';
    assert.equal(videoIdDeMetadatos({ comment: comentario }), 'Rt9tW3cMLhI');
});

test('videoId desde un comentario ID3 (objeto con text) y desde otros enlaces de YouTube', () => {
    assert.equal(videoIdDeMetadatos({ comment: { language: 'eng', text: 'https://youtu.be/dQw4w9WgXcQ' } }), 'dQw4w9WgXcQ');
    assert.equal(videoIdDeMetadatos({ comment: 'https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ' }), 'dQw4w9WgXcQ');
    assert.equal(videoIdDeMetadatos({ purl: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }), 'dQw4w9WgXcQ');
});

test('sin enlace de YouTube, null', () => {
    assert.equal(videoIdDeMetadatos({ comment: 'Grabado en casa' }), null);
    assert.equal(videoIdDeMetadatos({ comment: 'https://example.com/watch?v=dQw4w9WgXcQ' }), null);
    assert.equal(videoIdDeMetadatos(null), null);
});

test('solo audio, y no más de 100 MB', () => {
    assert.equal(esAudio({ name: 'a.m4a', type: '', size: 10 }), true);
    assert.equal(esAudio({ name: 'sin-extension', type: 'audio/mpeg', size: 10 }), true);
    assert.equal(esAudio({ name: 'foto.jpg', type: 'image/jpeg', size: 10 }), false);
    assert.equal(esAudio({ name: 'enorme.mp3', type: 'audio/mpeg', size: MAX_BYTES + 1 }), false);
});

test('el título, del nombre del fichero si no trae uno', () => {
    assert.equal(tituloDeFichero('Artista - Canción.m4a'), 'Artista - Canción');
    assert.equal(tituloDeFichero(''), 'Sin título');
});

test('¿cabe en el navegador? Con un 5 % de margen, y cuánto falta si no', () => {
    const mb = 1024 * 1024;
    assert.deepEqual(cabeEnElNavegador({ quota: 1000 * mb, usage: 100 * mb }, 500 * mb), { cabe: true, faltanMB: 0 });
    assert.deepEqual(cabeEnElNavegador({ quota: 1000 * mb, usage: 900 * mb }, 100 * mb), { cabe: false, faltanMB: 50 });
    // Sin estimación, se intenta
    assert.equal(cabeEnElNavegador(null, 10 * mb).cabe, true);
});

test('lo ya descargado aquí se salta; lo que está en la nube sí se importa', () => {
    const biblioteca = [
        { videoId: 'aaaaaaaaaaa', src: 'idb://a' },
        { videoId: 'bbbbbbbbbbb', src: 'nube://bbbbbbbbbbb', nube: true },
    ];
    const leidos = [
        { fichero: 'ya', videoId: 'aaaaaaaaaaa' },
        { fichero: 'nube', videoId: 'bbbbbbbbbbb' },
        { fichero: 'nueva', videoId: 'ccccccccccc' },
        { fichero: 'repetida', videoId: 'ccccccccccc' },
        { fichero: 'sin enlace', videoId: null },
    ];
    const r = repartirImportacion(leidos, biblioteca);
    assert.deepEqual(r.importar.map((l) => l.fichero), ['nube', 'nueva', 'sin enlace']);
    assert.equal(r.saltados, 2);
});
