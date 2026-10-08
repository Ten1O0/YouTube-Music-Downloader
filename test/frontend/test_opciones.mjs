/**
 * «Opciones de la canción», el botón ⋮ de la pantalla completa (plan 21, T5):
 * qué se ofrece para cada canción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, plain } from './harness.mjs';

const { api } = app();

describe('accionesDe', () => {
    const deYoutube = { src: 'idb://a', videoId: 'aaaaaaaaaaa', title: 'Artista - Canción' };

    test('una canción de la biblioteca: añadir, compartir y abrir en YouTube; guardar no', () => {
        assert.deepEqual(plain(api.accionesDe(deYoutube, { radio: false, artista: true })),
            { guardar: false, anadir: true, artista: true, compartir: true, youtube: true });
    });

    test('de la radio: guardar en vez de añadir a una lista', () => {
        const acciones = api.accionesDe({ ...deYoutube, radio: true }, { radio: true, artista: false });
        assert.equal(acciones.guardar, true);
        assert.equal(acciones.anadir, false);
        assert.equal(acciones.artista, false);
    });

    test('un fichero importado, sin id de YouTube: ni compartir ni abrir en YouTube', () => {
        const acciones = api.accionesDe({ src: 'imported_x.mp3', title: 'Mi grabación' }, { artista: true });
        assert.equal(acciones.compartir, false);
        assert.equal(acciones.youtube, false);
        assert.equal(acciones.anadir, true);
    });
});

describe('enlaceDe', () => {
    test('el enlace de YouTube, solo con un id válido', () => {
        assert.equal(api.enlaceDe({ videoId: 'dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        assert.equal(api.enlaceDe({ videoId: 'no-vale' }), null);
        assert.equal(api.enlaceDe({ videoId: 'aaaaaaaaaaa&list=RD' }), null);
        assert.equal(api.enlaceDe(null), null);
    });
});
