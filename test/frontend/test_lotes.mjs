/**
 * Descargas en lote (plan 20, T2): cómo va un lote para el cliente y qué se
 * manda de cada canción.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancionDeLote, estadoDelLote } from '../../frontend/src/features/download/estado-lote.js';

const cancion = (i, estado) => ({ i, downloadId: `d${i}`, videoId: `vid${String(i).padStart(8, '0')}`, titulo: `T${i}`, estado });
const resumen = (estados, extra = {}) => ({ canciones: estados.map((e, i) => cancion(i, e)), terminado: false, ...extra });

test('lo terminado en el servidor y aún no guardado aquí, por recoger', () => {
    const e = estadoDelLote(resumen(['hecha', 'hecha', 'descargando', 'en_cola']), ['d0']);
    assert.deepEqual(e.porRecoger.map((c) => c.downloadId), ['d1']);
    assert.equal(e.hechas, 1);
    assert.equal(e.enCurso, 1);
    assert.equal(e.total, 4);
});

test('el avance cuenta lo guardado, lo fallido y medio de lo que se está bajando', () => {
    const e = estadoDelLote(resumen(['hecha', 'fallida', 'descargando', 'en_cola']), ['d0']);
    assert.equal(e.percent, ((1 + 1 + 0.5) / 4) * 100);
    assert.equal(e.fallidas, 1);
});

test('terminado solo cuando el servidor acabó y todo lo hecho está guardado aquí', () => {
    const r = resumen(['hecha', 'fallida', 'caducada'], { terminado: true });
    assert.equal(estadoDelLote(r, []).terminado, false);
    const e = estadoDelLote(r, ['d0']);
    assert.equal(e.terminado, true);
    assert.equal(e.fallidas, 2);
    assert.equal(e.percent, 100);
});

test('sin resumen, un lote vacío', () => {
    const e = estadoDelLote(null);
    assert.equal(e.total, 0);
    assert.equal(e.percent, 0);
    assert.equal(e.terminado, false);
});

test('cancionDeLote: una del selector lleva su enlace y lo que sabe la biblioteca', () => {
    const c = cancionDeLote({ id: 'aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Uno', channel: 'Canal', duration: 180 });
    assert.equal(c.url, 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    assert.equal(c.videoInfo.videoId, 'aaaaaaaaaaa');
    assert.equal(c.videoInfo.thumbnail, 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg');
    assert.equal(c.videoInfo.duration, 180);
});

test('cancionDeLote: una de la biblioteca (en la nube) se pide por su videoId', () => {
    const c = cancionDeLote({ videoId: 'bbbbbbbbbbb', src: 'nube://bbbbbbbbbbb', title: 'Dos', thumbnail: 'x.jpg' });
    assert.equal(c.url, 'https://www.youtube.com/watch?v=bbbbbbbbbbb');
    assert.equal(c.videoInfo.thumbnail, 'x.jpg');
});

test('cancionDeLote: un favorito sin enlace va como búsqueda; sin nada, no va', () => {
    assert.equal(cancionDeLote({ url: 'Artista - Canción', title: 'Canción' }).url, 'Artista - Canción');
    assert.equal(cancionDeLote({ url: 'Artista - Canción' }).videoInfo.videoId, undefined);
    assert.equal(cancionDeLote({ title: 'Sin nada' }), null);
});
