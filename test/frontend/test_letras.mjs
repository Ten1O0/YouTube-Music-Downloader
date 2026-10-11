/**
 * Qué preguntar a LRCLIB y qué letra aceptar (plan 22, T2).
 *
 * Con respuestas reales de LRCLIB (test/frontend/datos/lrclib.json, del
 * 2026-10-09): el ejemplo del usuario con sus versiones de 164, 198 y 300 s,
 * «Gasolina» de otros artistas, la búsqueda suelta de «Yellow» y una entrada
 * basura con los campos cambiados. La regla: mejor ninguna letra que la de
 * otra canción o la de otra versión desacompasada.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CONSULTAS_LETRA, consultasDeLetra, elegirLetra, puntuarLetra, tiemposDeOtraVersion } from '../../frontend/src/features/letras/elegir.js';

const DATOS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos', 'lrclib.json'), 'utf8'));
const { ariana, gasolina, yellow_suelto: yellowSuelto, yellow_coldplay: yellowColdplay, yellow_basura: yellowBasura } = DATOS;

/** El ejemplo del usuario: de la radio, con el artista en el título y guion largo. */
const RADIO = { title: 'Ariana Grande – hate that i made you love me', channel: 'Ariana Grande', duration: 198 };

describe('consultasDeLetra: la cascada', () => {
    test('título y artista primero, de lo más preciso a lo más suelto', () => {
        const pasos = consultasDeLetra({ title: 'x', channel: 'y', artist: 'KAROL G, Shakira', track: 'TQG', duration: 197 });
        assert.deepEqual(pasos, [
            { paso: 1, params: { track_name: 'TQG', artist_name: 'KAROL G, Shakira' } },
            { paso: 2, params: { track_name: 'TQG', artist_name: 'KAROL G' } },
            { paso: 4, params: { q: 'TQG KAROL G' } },
            { paso: 5, params: { q: 'TQG' } },
        ]);
    });

    test('la canción de la radio sin separar: del título de YouTube, también con «–»', () => {
        const [primera] = consultasDeLetra(RADIO);
        assert.deepEqual(primera, { paso: 1, params: { track_name: 'hate that i made you love me', artist_name: 'Ariana Grande' } });
    });

    test('al revés solo si el título de YouTube es «A - B»', () => {
        const alReves = consultasDeLetra({ title: 'Yellow - Coldplay (Lyrics)', channel: 'Lyrics Channel' }).find((c) => c.paso === 3);
        assert.deepEqual(alReves.params, { track_name: 'Yellow', artist_name: 'Coldplay' });
        assert.equal(consultasDeLetra({ title: 'Bohemian Rhapsody', channel: 'Queen - Topic' }).some((c) => c.paso === 3), false);
    });

    test('sin repetidas (ni por mayúsculas) y nunca más de cinco', () => {
        const pasos = consultasDeLetra({ title: 'Queen - Bohemian Rhapsody', channel: 'Queen Official', artist: 'Queen', track: 'Bohemian Rhapsody' });
        const claves = pasos.map((c) => JSON.stringify(c.params).toLowerCase());
        assert.equal(new Set(claves).size, claves.length);
        assert.ok(pasos.length <= MAX_CONSULTAS_LETRA);
        // El primer artista es el mismo que el artista: el paso 2 sobra
        assert.equal(pasos.some((c) => c.paso === 2), false);
    });

    test('sin nada con que buscar, nada', () => {
        assert.deepEqual(consultasDeLetra({}), []);
    });
});

describe('elegirLetra: la misma canción y la misma versión', () => {
    test('el ejemplo del usuario: la sincronizada de 198 s', () => {
        const letra = elegirLetra(ariana.resultados, RADIO, 1);
        assert.equal(letra.tipo, 'synced');
        assert.equal(letra.duracion, 198);
        assert.match(letra.texto, /^\[\d{2}:\d{2}/);
    });

    test('cada versión con la suya: 164 s y 300 s', () => {
        assert.equal(elegirLetra(ariana.resultados, { ...RADIO, duration: 164 }).duracion, 164);
        assert.equal(elegirLetra(ariana.resultados, { ...RADIO, duration: 300 }).duracion, 300);
        // Con varias cerca, la más parecida
        const duraciones = ariana.resultados.filter((x) => x.syncedLyrics).map((x) => x.duration);
        const masCerca = (d) => duraciones.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
        for (const d of [170, 197, 301]) assert.equal(elegirLetra(ariana.resultados, { ...RADIO, duration: d }).duracion, masCerca(d), `${d} s`);
    });

    test('de 3 a 15 s de diferencia (un videoclip con intro): la letra sin sincronizar', () => {
        const letra = elegirLetra(ariana.resultados, { ...RADIO, duration: 212 });
        assert.equal(letra.tipo, 'plain');
        assert.doesNotMatch(letra.texto, /\[\d{2}:\d{2}/);
    });

    test('a más de 15 s de cualquier versión: ninguna', () => {
        assert.equal(elegirLetra(ariana.resultados, { ...RADIO, duration: 250 }), null);
    });

    test('sin duración en la canción: deciden título y artista', () => {
        const letra = elegirLetra(ariana.resultados, { ...RADIO, duration: null });
        assert.equal(letra.tipo, 'synced');
    });

    test('«Gasolina» de Daddy Yankee nunca coge la de otro artista', () => {
        const cancion = { title: 'Daddy Yankee - Gasolina', channel: 'Daddy Yankee', duration: 193 };
        for (const paso of [1, 4, 5]) {
            const letra = elegirLetra(gasolina.resultados, cancion, paso);
            assert.equal(letra?.duracion, 193, `paso ${paso}`);
        }
        // Con la búsqueda por título, la primera con letra era la de Xyclone
        assert.equal(gasolina.resultados.find((x) => x.syncedLyrics || x.plainLyrics).artistName, 'Xyclone');
    });

    test('con el artista claro, otro artista no vale aunque dure lo mismo (pasos 1 a 4)', () => {
        const xyclone = gasolina.resultados.find((x) => x.artistName === 'Xyclone');
        const p = puntuarLetra(xyclone, { artist: 'Daddy Yankee', track: 'Gasolina', duration: xyclone.duration }, { paso: 4 });
        assert.equal(p.valida, false);
        assert.equal(p.motivo, 'otro artista');
    });

    test('la búsqueda suelta de «Yellow» no da la de Coldplay por buena', () => {
        const coldplay = { track: 'Yellow', artist: 'Coldplay', duration: 269 };
        // «Yellow Magic», «Yellow Claw - Shotgun»…: otro título, ninguna vale
        assert.equal(elegirLetra(yellowSuelto.resultados, coldplay, 5), null);
        assert.equal(elegirLetra(yellowColdplay.resultados, coldplay, 1).duracion, 269);
    });

    test('las fichas con restos de nombre de fichero («Yellow(MP3_160K)») no valen, ni con los campos cambiados', () => {
        const coldplay = { track: 'Yellow', artist: 'Coldplay', duration: 267 };
        for (const ficha of yellowBasura.resultados) {
            assert.equal(puntuarLetra(ficha, coldplay).valida, false, `${ficha.trackName} | ${ficha.artistName}`);
        }
        assert.equal(elegirLetra(yellowBasura.resultados, coldplay, 1), null);
        // Y con el título de YouTube al revés («Yellow - Coldplay (Lyrics)»), la ficha cambiada tampoco
        const alReves = { title: 'Yellow - Coldplay (Lyrics)', channel: '7clouds', duration: 267 };
        assert.equal(elegirLetra(yellowBasura.resultados, alReves, 1), null);
    });

    test('el paso 3 (al revés) compara también al revés', () => {
        const alReves = { title: 'Yellow - Coldplay (Lyrics)', channel: '7clouds', duration: 270 };
        assert.equal(elegirLetra(yellowColdplay.resultados, alReves, 1), null);
        assert.equal(elegirLetra(yellowColdplay.resultados, alReves, 3).duracion, 270);
    });

    test('solo el título (paso 5): la duración es obligatoria', () => {
        const sinDuracion = { title: 'hate that i made you love me', channel: 'Letras Latinas' };
        assert.equal(elegirLetra(ariana.resultados, sinDuracion, 5), null);
        // Con duración, aunque el canal no sea el artista
        assert.equal(elegirLetra(ariana.resultados, { ...sinDuracion, duration: 198 }, 5).duracion, 198);
        // A ±3 s; a 10 s ya no confirma nada
        assert.equal(elegirLetra(ariana.resultados, { ...sinDuracion, duration: 230 }, 5), null);
    });

    test('una candidata sin duración: deciden título y artista, salvo en el paso 5', () => {
        const sinDuracion = { ...ariana.resultados[0], duration: null };
        assert.equal(puntuarLetra(sinDuracion, RADIO).valida, true);
        assert.equal(puntuarLetra(sinDuracion, RADIO, { paso: 5 }).valida, false);
        assert.equal(puntuarLetra({ ...sinDuracion, duration: 0 }, RADIO).valida, true);
    });

    test('entre las válidas gana la sincronizada y, después, la de duración más parecida', () => {
        const base = ariana.resultados[0];
        const resultados = [
            { ...base, id: 1, duration: 198, syncedLyrics: null, plainLyrics: 'simple' },
            { ...base, id: 2, duration: 200, syncedLyrics: '[00:01.00] dos', plainLyrics: 'dos' },
            { ...base, id: 3, duration: 199, syncedLyrics: '[00:01.00] tres', plainLyrics: 'tres' },
        ];
        assert.equal(elegirLetra(resultados, RADIO).texto, '[00:01.00] tres');
    });

    test('sin letra simple, la sincronizada sin sus marcas de tiempo', () => {
        const base = { ...ariana.resultados[0], duration: 210, plainLyrics: null, syncedLyrics: '[00:01.50] Uno\n[00:03.20]Dos' };
        assert.deepEqual(elegirLetra([base], RADIO), { tipo: 'plain', texto: 'Uno\nDos', duracion: 210 });
    });

    test('también sin las marcas por palabra del «LRC mejorado» (como «TU OLVIDO» de KAZE)', () => {
        const synced = '[00:20.05]<00:20.05>es <00:20.31>que <00:20.80>tu\n[00:22.10] <00:22.10>olvido <00:23.00>';
        const base = { ...ariana.resultados[0], duration: 210, plainLyrics: null, syncedLyrics: synced };
        assert.equal(elegirLetra([base], RADIO).texto, 'es que tu\nolvido');
    });

    test('instrumentales, vacías y respuestas raras: nada', () => {
        const base = ariana.resultados[0];
        assert.equal(elegirLetra([{ ...base, instrumental: true }], RADIO), null);
        assert.equal(elegirLetra([{ ...base, syncedLyrics: '', plainLyrics: '  ' }], RADIO), null);
        assert.equal(elegirLetra(null, RADIO), null);
        assert.equal(elegirLetra([null, {}, 'x'], RADIO), null);
    });

    test('el mismo título con tildes, mayúsculas, signos o «feat.» distintos', () => {
        const base = { ...ariana.resultados[0], duration: null };
        const cancion = { artist: 'Mecano', track: 'Hijo de la luna', duration: null };
        for (const trackName of ['Hijo De La Luna', 'Hijo de la Luna (Remasterizado)', 'hijo de la luna']) {
            assert.equal(puntuarLetra({ ...base, trackName, artistName: 'Mecano' }, cancion).valida, true, trackName);
        }
        assert.equal(puntuarLetra({ ...base, trackName: 'Hijo de la luna feat. Alguien', artistName: 'Mecano' }, cancion).valida, true);
        assert.equal(puntuarLetra({ ...base, trackName: 'Entre dos tierras', artistName: 'Mecano' }, cancion).valida, false);
        // El artista con el canal de YouTube («- Topic») cuenta igual
        assert.equal(puntuarLetra({ ...base, trackName: 'Hijo de la luna', artistName: 'Mecano - Topic' }, cancion).valida, true);
    });
});

describe('el paso 5 (solo el título): ni versiones de otros ni coincidencias', () => {
    const ficha = (artistName, duration, id) => ({ ...ariana.resultados[0], id, trackName: 'Bohemian Rhapsody', artistName, duration });
    const canal = { title: 'bohemian rhapsody lyrics', channel: 'Lyrics Channel', duration: 359 };

    test('una versión de otro con la misma duración no pasa si el original tiene más fichas', () => {
        const resultados = [ficha('Queen', 355, 1), ficha('Queen', 354, 2), ficha('Queen - Topic', 356, 3), ficha('Marc Martel', 359, 4)];
        // La de Queen más cercana está a 3 s: vale; la de Marc Martel, a 0 s, no
        assert.equal(elegirLetra(resultados, canal, 5).duracion, 356);
        // Sin ninguna de Queen a ±3 s, ninguna: mejor sin letra que la versión de otro
        assert.equal(elegirLetra(resultados.filter((x) => x.id !== 3), canal, 5), null);
    });

    test('con un empate entre artistas, ninguno', () => {
        const resultados = [ficha('Uno', 359, 1), ficha('Otro', 358, 2)];
        assert.equal(elegirLetra(resultados, canal, 5), null);
    });

    test('«feat.», «&» y «- Topic» cuentan como el mismo artista', () => {
        const resultados = [ficha('Queen (feat. Alguien)', 359, 1), ficha('Queen & Otro', 340, 2), ficha('Queen - Topic', 362, 3), ficha('Marc Martel', 359, 4)];
        assert.equal(elegirLetra(resultados, canal, 5).duracion, 359);
        assert.equal(elegirLetra(resultados, canal, 5).texto, ficha('Queen (feat. Alguien)', 359, 1).syncedLyrics);
    });
});

describe('los tiempos de otra versión (plan 24): «NO SOY TUYO» de KAZE', () => {
    // Los tiempos reales de LRCLIB (2026-10-10), con el texto sustituido por relleno.
    // Las tres fichas llevan los mismos: los del disco (3:24), también las del videoclip (4:02)
    const TIEMPOS = ["00:11.47", "00:13.65", "00:17.35", "00:19.51", "00:22.95", "00:24.90", "00:28.28", "00:30.06", "00:33.88", "00:35.84", "00:39.58", "00:41.42", "00:46.35", "00:47.46", "00:50.11", "00:52.85", "00:57.55", "01:04.23", "01:08.89", "01:13.14", "01:18.99", "01:21.12", "01:24.44", "01:27.58", "01:32.35", "01:38.03", "01:41.73", "01:45.38", "01:47.25", "01:49.05", "01:52.67", "01:56.12", "01:58.61", "02:00.51", "02:04.14", "02:07.16", "02:09.82", "02:12.62", "02:15.83", "02:17.31", "02:21.17", "02:23.63", "02:27.23", "02:29.73", "02:32.38", "02:34.85", "02:37.49", "02:40.15", "02:43.89", "02:46.17", "02:50.38", "02:57.28", "03:01.62", "03:04.70", "03:09.13", "03:11.23"];
    const sincronizada = TIEMPOS.map((t, i) => `[${t}] línea ${i + 1}`).join('\n');
    const ficha = (id, duration, albumName) => ({
        id, trackName: 'NO SOY TUYO', artistName: 'KAZE', albumName, duration, instrumental: false,
        plainLyrics: TIEMPOS.map((_, i) => `línea ${i + 1}`).join('\n'), syncedLyrics: sincronizada,
    });
    const RESULTADOS = [ficha(36109323, 242, '4,9 M de visualizaciones'), ficha(25415149, 242, 'KAZE Videos'), ficha(13525394, 204, 'No Soy Tuyo')];
    const cancion = (duration) => ({ title: 'NO SOY TUYO', channel: 'KAZE', artist: 'KAZE', track: 'NO SOY TUYO', duration });

    test('con el videoclip (4:01), la letra sale sin sincronizar: sus tiempos son los del disco', () => {
        assert.equal(tiemposDeOtraVersion(RESULTADOS[0], RESULTADOS), true);
        const letra = elegirLetra(RESULTADOS, cancion(241));
        assert.equal(letra.tipo, 'plain');
        assert.doesNotMatch(letra.texto, /\[\d{2}:\d{2}/);
    });

    test('con la versión del disco (3:24), sincronizada', () => {
        assert.equal(tiemposDeOtraVersion(RESULTADOS[2], RESULTADOS), false);
        assert.equal(elegirLetra(RESULTADOS, cancion(204)).tipo, 'synced');
    });

    test('si los tiempos del videoclip son suyos (distintos), sincronizada', () => {
        const propia = { ...RESULTADOS[0], syncedLyrics: TIEMPOS.map((t, i) => `[${t}] línea ${i + 1}`).join('\n').replace('[00:11.47]', '[00:49.47]') };
        assert.equal(elegirLetra([propia, RESULTADOS[2]], cancion(241)).tipo, 'synced');
    });

    test('una letra incompleta (acaba antes de la mitad) no se juzga', () => {
        const corta = TIEMPOS.slice(0, 4).map((t, i) => `[${t}] línea ${i + 1}`).join('\n');
        const fichas = RESULTADOS.map((f) => ({ ...f, syncedLyrics: corta }));
        assert.equal(tiemposDeOtraVersion(fichas[0], fichas), false);
    });
});
