/**
 * La caché de la radio (plan 16, §2.4 y §2.5).
 *
 * Lo que la radio descarga va aquí y no a la biblioteca: como mucho 10
 * canciones o 150 MB, sin borrar nunca la que suena. «Guardar» la lleva a la
 * biblioteca sin volver a descargarla, y queda igual que una descarga normal.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PREFIJO, TOPE_BYTES, TOPE_CANCIONES, cancionDeRadio, sobrantes } from '../../frontend/src/features/radio/cache-modelo.js';
import { leer } from './fuentes.mjs';

const MB = 1024 * 1024;
const entrada = (videoId, en, extra = {}) => ({ videoId, en, bytes: 4 * MB, extension: '.m4a', ...extra });

describe('qué sobra en la caché', () => {
    test('por número: con 12, salen las 2 más antiguas', () => {
        const lista = Array.from({ length: 12 }, (_, i) => entrada(`v${String(i).padStart(10, '0')}`, 1000 + i));
        assert.deepEqual(sobrantes(lista).map((e) => e.en), [1000, 1001]);
        assert.equal(TOPE_CANCIONES, 10);
    });

    test('por tamaño: 150 MB aunque sean pocas', () => {
        const lista = [entrada('a', 1, { bytes: 90 * MB }), entrada('b', 2, { bytes: 50 * MB }), entrada('c', 3, { bytes: 40 * MB })];
        assert.equal(TOPE_BYTES, 150 * MB);
        assert.deepEqual(sobrantes(lista).map((e) => e.videoId), ['a']);
    });

    test('la que suena no sale nunca, aunque sea la más antigua', () => {
        const lista = Array.from({ length: 11 }, (_, i) => entrada(`v${i}`, i));
        assert.deepEqual(sobrantes(lista, { proteger: new Set(['v0']) }).map((e) => e.videoId), ['v1']);
    });

    test('las ya guardadas en la biblioteca salen primero y no cuentan para el tope', () => {
        const lista = [entrada('g', 5, { guardada: true }), entrada('a', 1), entrada('b', 2)];
        assert.deepEqual(sobrantes(lista).map((e) => e.videoId), ['g']);
        // …salvo que estén sonando
        assert.deepEqual(sobrantes(lista, { proteger: new Set(['g']) }), []);
    });

    test('dentro del tope no sobra nada', () => {
        assert.deepEqual(sobrantes([entrada('a', 1), entrada('b', 2)]), []);
    });
});

describe('la canción de radio para la cola', () => {
    const meta = {
        url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
        videoInfo: { videoId: 'aaaaaaaaaaa', title: 'Del mix', channel: 'Canal', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', duration: 200 },
        finalProgressData: { title: 'Artista - Canción', channel: 'Artista', artist: 'Artista', track: 'Canción', loudness: { lufs: -9.5, pico: -0.4 } },
    };

    test('en la web, su audio en IndexedDB con el prefijo de la radio', () => {
        const c = cancionDeRadio({ videoId: 'aaaaaaaaaaa', meta });
        assert.equal(c.src, `idb://${PREFIJO}aaaaaaaaaaa`);
        assert.equal(c.radio, true);
        assert.equal(c.localPath, undefined);
        assert.equal(c.title, 'Artista - Canción');
        assert.equal(c.artist, 'Artista');
        assert.equal(c.duration, 200);
    });

    test('en la APK, su fichero en DATA/radio', () => {
        assert.equal(cancionDeRadio({ videoId: 'aaaaaaaaaaa', ruta: 'radio/aaaaaaaaaaa.m4a', meta }).localPath, 'radio/aaaaaaaaaaa.m4a');
        // …y el reproductor lo busca en DATA, no en Documentos
        assert.match(leer('frontend/src/core/audio-store.js'), /song\.localPath\.startsWith\('radio\/'\)/);
    });

    test('con la misma medida de sonoridad que una descarga normal: suena igualada', () => {
        assert.deepEqual(cancionDeRadio({ videoId: 'aaaaaaaaaaa', meta }).loudness, { lufs: -9.5, pico: -0.4, fuente: 'servidor' });
        const sinMedida = { ...meta, finalProgressData: { title: 'x' } };
        assert.equal(cancionDeRadio({ videoId: 'aaaaaaaaaaa', meta: sinMedida }).loudness, undefined);
    });

    test('el prefijo de la web es el de la biblioteca (el reproductor la encuentra igual)', () => {
        assert.match(leer('frontend/src/core/audio-store.js'), /export const IDB_SRC_PREFIX = 'idb:\/\/';/);
    });
});

describe('el camino de la radio no toca la biblioteca', () => {
    const cache = leer('frontend/src/features/radio/cache.js');
    const lotes = leer('frontend/src/features/download/lotes.js');
    const descarga = leer('frontend/src/features/download/download.js');

    test('guardar en la caché no añade a la biblioteca ni al historial', () => {
        const i = cache.indexOf('export async function guardarEnCache');
        const cuerpo = cache.slice(i, cache.indexOf('\n}\n', i));
        assert.ok(i > 0);
        assert.doesNotMatch(cuerpo, /LibraryModule|addToHistory|entregarFichero/);
    });

    test('la descarga en silencio no toca la isla, los avisos ni los pendientes', () => {
        const i = descarga.indexOf('export async function descargarEnSilencio');
        const cuerpo = descarga.slice(i, descarga.indexOf('\n}\n', i));
        assert.ok(i > 0);
        assert.doesNotMatch(cuerpo, /queueManager|showStatus|showProgress|updateProgress|apuntarPendiente|avisar|guardarDescarga/);
    });

    test('un lote en silencio no apunta pendientes ni sale en la isla, y entrega a quien lo pidió', () => {
        assert.match(lotes, /if \(!silencioso\) await apuntarPendiente/);
        assert.match(lotes, /const isla = silencioso \? \{ actualizarLote\(\) \{\} \} : queueManager;/);
        assert.match(lotes, /await \(recoger \?\? guardarDescarga\)\(/);
        assert.match(lotes, /if \(silencioso\) return resultado;/);
    });

    test('guardar reutiliza la entrada de biblioteca y el historial de una descarga normal, sin volver a bajar', () => {
        const i = cache.indexOf('export async function aBiblioteca');
        const cuerpo = cache.slice(i, cache.indexOf('\n}\n', i));
        assert.match(cuerpo, /entradaDeBiblioteca\(/);
        assert.match(cuerpo, /addToHistory\(buildHistoryEntry\(/);
        assert.doesNotMatch(cuerpo, /bajarAudio|fetch\(|start-download/);
    });
});
