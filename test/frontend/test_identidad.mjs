/**
 * La identidad de las canciones antiguas (plan 13): sin su id de YouTube no
 * viajan, y en el otro dispositivo aparecían «en la nube» aunque estuvieran
 * descargadas. Se recupera sin adivinar nunca.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { idDeLaCancion, idDeResultados, indicePorTitulo, repararIds, repararIdsDeListas } from '../../frontend/src/features/sync/identidad.js';
import { aplicarRemotos } from '../../frontend/src/features/sync/fusion.js';

const TURBIO = 'rLZSjJPyulk';
const TITULO = 'KAZE - MODO TURBIO - VIDEOCLIP [PROD. FIGU]';
const DESCARGA = '8a8ceb9e0d4f4b1c9a7e2b3c4d5e6f70'; // el id de la descarga que se guardaba antes
const antigua = (extra = {}) => ({ src: 'idb://viejo', videoId: DESCARGA, title: TITULO, channel: 'KAZE', thumbnail: 'data:image/jpeg;base64,xx', ...extra });

describe('idDeLaCancion', () => {
    test('de la miniatura de YouTube, del fichero o de un enlace', () => {
        assert.equal(idDeLaCancion({ thumbnail: `https://i.ytimg.com/vi/${TURBIO}/mqdefault.jpg` }), TURBIO);
        assert.equal(idDeLaCancion({ localPath: `YTMusic/ytmusic_${TURBIO}.m4a` }), TURBIO);
        assert.equal(idDeLaCancion({ url: `https://www.youtube.com/watch?v=${TURBIO}&t=3` }), TURBIO);
    });

    test('ni de una miniatura incrustada ni del id de la descarga', () => {
        assert.equal(idDeLaCancion(antigua()), null);
        assert.equal(idDeLaCancion({ src: '/api/stream/a6c0a9e3' }), null);
    });
});

test('indicePorTitulo: un título que apunta a dos vídeos no vale', () => {
    const i = indicePorTitulo([{ title: 'Hello', id: 'aaaaaaaaaaa' }, { title: ' hello ', id: 'bbbbbbbbbbb' }, { title: 'Otra', id: 'ccccccccccc' }]);
    assert.equal(i.get('hello'), undefined);
    assert.equal(i.get('otra'), 'ccccccccccc');
});

describe('repararIds', () => {
    test('con el historial de descargas: mismo título, su enlace', () => {
        const r = repararIds([antigua()], [{ title: TITULO, url: `https://www.youtube.com/watch?v=${TURBIO}` }]);
        assert.equal(r.biblioteca[0].videoId, TURBIO);
        assert.equal(r.reparadas, 1);
        assert.deepEqual([...r.ids], [['idb://viejo', TURBIO]]);
    });

    test('«Modo Turbio»: la entrada en la nube de una canción ya descargada sobra', () => {
        const nube = { src: `nube://${TURBIO}`, videoId: TURBIO, title: TITULO, nube: true, artist: 'Kaze', track: 'Modo Turbio', editado: true };
        const r = repararIds([antigua(), nube]);
        assert.equal(r.biblioteca.length, 1, 'no queda duplicada');
        assert.deepEqual([r.biblioteca[0].src, r.biblioteca[0].videoId], ['idb://viejo', TURBIO]);
        assert.equal(r.biblioteca[0].track, 'Modo Turbio', 'lo editado en la cuenta pasa a la descargada');
        assert.equal(r.unidas, 1);
    });

    test('sin pista segura, no se toca', () => {
        const r = repararIds([antigua()], [{ title: 'Otra canción', id: TURBIO }]);
        assert.equal(r.biblioteca[0].videoId, DESCARGA);
        assert.equal(r.reparadas, 0);
    });

    test('dos canciones de aquí no pueden quedarse con el mismo id', () => {
        const r = repararIds([antigua(), antigua({ src: 'idb://copia' })], [{ title: TITULO, id: TURBIO }]);
        assert.deepEqual(r.biblioteca.map((s) => s.videoId), [TURBIO, DESCARGA]);
    });

    test('las que ya tienen id y las de la nube no cambian', () => {
        const buena = { src: 'idb://b', videoId: 'aaaaaaaaaaa', title: TITULO };
        const r = repararIds([buena], [{ title: TITULO, id: TURBIO }]);
        assert.equal(r.biblioteca[0], buena);
    });
});

test('repararIdsDeListas: las copias de las listas llevan el mismo id', () => {
    const listas = [{ id: '1', name: 'L', songs: [antigua(), { src: 'idb://otra', videoId: 'bbbbbbbbbbb' }] }];
    const r = repararIdsDeListas(listas, new Map([['idb://viejo', TURBIO]]));
    assert.equal(r.tocadas, true);
    assert.deepEqual(r.listas[0].songs.map((s) => s.videoId), [TURBIO, 'bbbbbbbbbbb']);
});

test('idDeResultados: solo con el título exacto y un único vídeo', () => {
    assert.equal(idDeResultados(TITULO, [{ id: 'xxxxxxxxxxx', title: 'KAZE - Modo Turbio (Live)' }, { id: TURBIO, title: TITULO }]), TURBIO);
    assert.equal(idDeResultados(TITULO, [{ id: 'xxxxxxxxxxx', title: 'KAZE - Modo Turbio (Live)' }]), null, 'parecido no vale');
    assert.equal(idDeResultados(TITULO, [{ id: TURBIO, title: TITULO }, { id: 'yyyyyyyyyyy', title: TITULO }]), null, 'dos iguales: ambiguo');
});

describe('aplicarRemotos con canciones de antes de guardar el id', () => {
    const remota = { videoId: TURBIO, title: TITULO, channel: 'KAZE', artist: 'KAZE', track: 'MODO TURBIO', extra: '', editado: false, duration: 180, addedAt: '2026-09-22T12:29:33.974Z' };

    test('la descargada aquí con el mismo título es esa: recibe el id y no se duplica en la nube', () => {
        const r = aplicarRemotos({ biblioteca: [antigua()], listas: [{ id: '1', name: 'L', songs: [antigua()] }] }, { biblioteca: [remota], listas: [] });
        assert.equal(r.biblioteca.length, 1);
        assert.deepEqual([r.biblioteca[0].src, r.biblioteca[0].videoId, r.biblioteca[0].nube], ['idb://viejo', TURBIO, undefined]);
        assert.equal(r.listas[0].songs[0].videoId, TURBIO, 'y su copia en la lista también');
    });

    test('una con id propio distinto no se confunde por el título', () => {
        const r = aplicarRemotos({ biblioteca: [antigua({ videoId: 'aaaaaaaaaaa' })], listas: [] }, { biblioteca: [remota], listas: [] });
        assert.equal(r.biblioteca.length, 2);
    });
});
