/**
 * Modo radio (plan 16, T2): qué suena después y cuántas tener listas.
 *
 * `elegir` filtra las candidatas de la mezcla (§2.1 del plan) y `ventana`
 * decide cuántas canciones bajar por adelantado (§2.3). Las dos son puras.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { claveDeTitulo, elegir, ventana } from '../../frontend/src/features/radio/pick.js';

const c = (id, title, extra = {}) => ({
    id, title, channel: 'Canal', duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, ...extra,
});
const ids = (canciones) => canciones.map((s) => s.videoId);

describe('elegir', () => {
    test('las primeras n, en el orden de la mezcla y listas para la cola', () => {
        const candidatas = [c('aaaaaaaaaaa', 'Uno - A'), c('bbbbbbbbbbb', 'Dos - B'), c('ccccccccccc', 'Tres - C'), c('ddddddddddd', 'Cuatro - D')];
        const elegidas = elegir(candidatas, { n: 3 });
        assert.deepEqual(ids(elegidas), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
        assert.deepEqual(elegidas[0], {
            radio: true, videoId: 'aaaaaaaaaaa', title: 'Uno - A', channel: 'Canal', duration: 200,
            thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
            // Separados del título, como en la biblioteca (plan 22, T1). Aquí al
            // revés, porque el canal («Canal») contiene el artista «A»
            artist: 'A', track: 'Uno',
        });
    });

    test('por defecto, 3', () => {
        const candidatas = 'abcde'.split('').map((l, i) => c(l.repeat(11), `Artista ${i} - Canción ${i}`));
        assert.equal(elegir(candidatas).length, 3);
    });

    test('fuera las que ya sonaron y las vetadas', () => {
        const candidatas = [c('aaaaaaaaaaa', 'Uno - A'), c('bbbbbbbbbbb', 'Dos - B'), c('ccccccccccc', 'Tres - C'), c('ddddddddddd', 'Cuatro - D')];
        const elegidas = elegir(candidatas, { sonadas: new Set(['aaaaaaaaaaa']), vetadas: new Set(['ccccccccccc']) });
        assert.deepEqual(ids(elegidas), ['bbbbbbbbbbb', 'ddddddddddd']);
    });

    test('la misma canción en vídeo oficial, letra y audio: solo la primera', () => {
        const candidatas = [
            c('aaaaaaaaaaa', 'Rick Astley - Never Gonna Give You Up (Official Video)', { channel: 'Rick Astley' }),
            c('bbbbbbbbbbb', 'Rick Astley - Never Gonna Give You Up (Lyrics)', { channel: 'Letras' }),
            c('ccccccccccc', 'Never Gonna Give You Up', { channel: 'Rick Astley - Topic' }),
            c('ddddddddddd', 'a-ha - Take On Me', { channel: 'a-ha' }),
        ];
        assert.deepEqual(ids(elegir(candidatas)), ['aaaaaaaaaaa', 'ddddddddddd']);
    });

    test('una versión en directo o un remix son otra canción; el feat., no', () => {
        assert.notEqual(claveDeTitulo('Queen - Bohemian Rhapsody', 'Queen'), claveDeTitulo('Queen - Bohemian Rhapsody (Live Aid 1985)', 'Queen'));
        assert.notEqual(claveDeTitulo('Daft Punk - One More Time', 'Daft Punk'), claveDeTitulo('Daft Punk - One More Time (Remix)', 'Daft Punk'));
        assert.equal(claveDeTitulo('Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO'), claveDeTitulo('Despacito', 'Luis Fonsi - Topic'));
        assert.equal(claveDeTitulo('Mötley Crüe - Home Sweet Home', 'X'), claveDeTitulo('motley crue - home  sweet home', 'Y'));
    });

    test('si sonó o se vetó una versión, las otras de esa canción tampoco vuelven', () => {
        const candidatas = [
            c('aaaaaaaaaaa', 'Rick Astley - Never Gonna Give You Up (Official Video)', { channel: 'Rick Astley' }),
            c('bbbbbbbbbbb', 'Rick Astley - Never Gonna Give You Up (Lyrics)', { channel: 'Letras' }),
            c('ccccccccccc', 'a-ha - Take On Me', { channel: 'a-ha' }),
        ];
        assert.deepEqual(ids(elegir(candidatas, { sonadas: new Set(['aaaaaaaaaaa']) })), ['ccccccccccc']);
        assert.deepEqual(ids(elegir(candidatas, { vetadas: new Set(['bbbbbbbbbbb']) })), ['ccccccccccc']);
    });

    test('fuera lo de menos de 1 minuto o más de 10; una duración desconocida no descarta', () => {
        const candidatas = [
            c('aaaaaaaaaaa', 'Corta - A', { duration: 59 }),
            c('bbbbbbbbbbb', 'Justa - B', { duration: 60 }),
            c('ccccccccccc', 'Mix de una hora - C', { duration: 3600 }),
            c('ddddddddddd', 'Diez minutos - D', { duration: 600 }),
            c('eeeeeeeeeee', 'Sin duración - E', { duration: null }),
        ];
        assert.deepEqual(ids(elegir(candidatas, { n: 10 })), ['bbbbbbbbbbb', 'ddddddddddd', 'eeeeeeeeeee']);
        assert.equal(elegir(candidatas, { n: 10 }).at(-1).duration, null);
    });

    test('si está en la biblioteca, la copia local tal cual', () => {
        const local = { src: 'idb://x1', videoId: 'bbbbbbbbbbb', title: 'Dos - B', artist: 'B', track: 'Dos', loudness: { lufs: -14 } };
        const elegidas = elegir([c('aaaaaaaaaaa', 'Uno - A'), c('bbbbbbbbbbb', 'Dos - B')], { biblioteca: [local] });
        assert.equal(elegidas[1], local);
        assert.equal(elegidas[0].radio, true);
    });

    test('entre versiones de la misma canción gana la descargada, en el sitio de la primera', () => {
        const local = { src: 'idb://x2', videoId: 'bbbbbbbbbbb', title: 'Never Gonna Give You Up' };
        const candidatas = [
            c('aaaaaaaaaaa', 'Rick Astley - Never Gonna Give You Up (Official Video)', { channel: 'Rick Astley' }),
            c('ccccccccccc', 'a-ha - Take On Me', { channel: 'a-ha' }),
            c('bbbbbbbbbbb', 'Never Gonna Give You Up', { channel: 'Rick Astley - Topic' }),
        ];
        const elegidas = elegir(candidatas, { biblioteca: [local] });
        assert.equal(elegidas[0], local);
        assert.deepEqual(ids(elegidas), ['bbbbbbbbbbb', 'ccccccccccc']);
    });

    test('lo que está «en la nube» o sin audio no cuenta como local', () => {
        const biblioteca = [
            { src: 'nube://a', videoId: 'aaaaaaaaaaa', nube: true },
            { src: 'idb://b', videoId: 'bbbbbbbbbbb', unavailable: true },
        ];
        const elegidas = elegir([c('aaaaaaaaaaa', 'Uno - A'), c('bbbbbbbbbbb', 'Dos - B')], { biblioteca });
        assert.deepEqual(elegidas.map((s) => s.radio), [true, true]);
    });

    test('lo raro de la mezcla no rompe nada', () => {
        assert.deepEqual(elegir(null), []);
        assert.deepEqual(elegir([null, {}, { id: 42 }, c('aaaaaaaaaaa', undefined, { channel: undefined })]).length, 1);
    });
});

describe('ventana', () => {
    const AHORA = 1_000_000;

    test('normal: 3', () => {
        assert.equal(ventana({ ahora: AHORA }), 3);
        assert.equal(ventana({ saltos: [{ en: AHORA - 5_000, escuchado: 40 }], ahora: AHORA }), 3);
    });

    test('dos saltos en menos de 30 s: 6', () => {
        const saltos = [{ en: AHORA - 20_000, escuchado: 30 }, { en: AHORA - 1_000, escuchado: 20 }];
        assert.equal(ventana({ saltos, ahora: AHORA }), 6);
    });

    test('dos saltos pero separados más de 30 s: 3', () => {
        const saltos = [{ en: AHORA - 45_000, escuchado: 30 }, { en: AHORA - 1_000, escuchado: 20 }];
        assert.equal(ventana({ saltos, ahora: AHORA }), 3);
    });

    test('saltar antes de 15 s de escucha: 6', () => {
        assert.equal(ventana({ saltos: [{ en: AHORA - 1_000, escuchado: 14.9 }], ahora: AHORA }), 6);
        assert.equal(ventana({ saltos: [{ en: AHORA - 1_000, escuchado: 15 }], ahora: AHORA }), 3);
    });

    test('al escuchar una entera (los saltos se vacían), vuelve a 3', () => {
        assert.equal(ventana({ saltos: [{ en: AHORA - 1_000, escuchado: 3 }], ahora: AHORA }), 6);
        assert.equal(ventana({ saltos: [], ahora: AHORA }), 3);
    });

    test('con datos móviles, 2 y 4', () => {
        assert.equal(ventana({ ahora: AHORA, redMovil: true }), 2);
        assert.equal(ventana({ saltos: [{ en: AHORA - 1_000, escuchado: 3 }], ahora: AHORA, redMovil: true }), 4);
    });
});

describe('artista y canción separados, como la biblioteca (plan 22, T1)', () => {
    test('el título con el artista delante, con guion largo', () => {
        const [cancion] = elegir([c('aaaaaaaaaaa', 'Ariana Grande – hate that i made you love me (Official Audio)', { channel: 'Ariana Grande' })]);
        assert.equal(cancion.artist, 'Ariana Grande');
        assert.equal(cancion.track, 'hate that i made you love me');
        // El título de YouTube se conserva tal cual
        assert.equal(cancion.title, 'Ariana Grande – hate that i made you love me (Official Audio)');
    });

    test('sin guion, el artista es el canal limpio', () => {
        const [cancion] = elegir([c('aaaaaaaaaaa', 'Bohemian Rhapsody', { channel: 'Queen - Topic' })]);
        assert.equal(cancion.artist, 'Queen');
        assert.equal(cancion.track, 'Bohemian Rhapsody');
    });

    test('la copia de la biblioteca no se toca', () => {
        const local = { src: 'idb://x', videoId: 'aaaaaaaaaaa', title: 'Uno - A', artist: 'Editado', track: 'A mano', editado: true };
        assert.equal(elegir([c('aaaaaaaaaaa', 'Uno - A')], { biblioteca: [local] })[0], local);
    });
});
