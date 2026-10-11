/**
 * La cabecera de una lista (plan 24, T2): «actualizada hace…», el texto de
 * Compartir, la portada elegida y lo que viaja de ella a la cuenta.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const { haceCuanto, textoParaCompartir, caratulaElegida, caratulasDeLista, marcarActualizadas, listaACuenta, validarLista, leerTexto } = api;

const AHORA = Date.parse('2026-10-10T12:00:00Z');
const hace = (segundos) => new Date(AHORA - segundos * 1000).toISOString();
const cancion = (id, extra = {}) => ({ src: `idb://${id}`, videoId: id.padEnd(11, 'x'), title: `T ${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/0.jpg`, ...extra });

describe('actualizada hace…', () => {
    test('en el idioma de la interfaz y con la unidad que toca', () => {
        assert.equal(haceCuanto(hace(2 * 86_400), AHORA, 'es'), 'anteayer');
        assert.equal(haceCuanto(hace(3 * 86_400), AHORA, 'es'), 'hace 3 días');
        assert.equal(haceCuanto(hace(5 * 3_600), AHORA, 'en'), '5 hours ago');
        assert.equal(haceCuanto(hace(20), AHORA, 'es'), 'este minuto');
        assert.equal(haceCuanto(hace(40 * 86_400), AHORA, 'es'), 'el mes pasado');
    });

    test('una fecha que no lo es: nada', () => {
        assert.equal(haceCuanto('no es una fecha', AHORA), '');
    });
});

describe('Compartir', () => {
    test('«Artista – Canción» por línea, y solo el título si no hay artista', () => {
        const texto = textoParaCompartir([
            { title: 'Algo', artist: 'Mecano', track: 'Hijo de la luna' },
            { title: 'Grabación casera' },
        ]);
        assert.equal(texto, 'Mecano – Hijo de la luna\nGrabación casera');
    });

    test('«Importar lista» lo lee tal cual', () => {
        const filas = leerTexto(textoParaCompartir([{ artist: 'Mecano', track: 'Hijo de la luna', title: 'x' }]));
        assert.equal(filas.length, 1);
        assert.deepEqual([...filas[0].artistas], ['Mecano']);
        assert.equal(filas[0].titulo, 'Hijo de la luna');
    });
});

describe('la portada elegida (P11)', () => {
    const pl = { portada: 'bbbbbbbbbbb', songs: [cancion('aaaaaaaaaaa'), cancion('bbbbbbbbbbb')] };

    test('la carátula de esa canción; si salió de la lista o no tiene carátula, la automática', () => {
        assert.equal(caratulaElegida(pl), 'https://i.ytimg.com/vi/bbbbbbbbbbb/0.jpg');
        assert.equal(caratulaElegida({ ...pl, portada: 'ccccccccccc' }), null);
        assert.equal(caratulaElegida({ ...pl, songs: [cancion('bbbbbbbbbbb', { thumbnail: '' })] }), null);
        assert.equal(caratulaElegida({ songs: pl.songs }), null);
    });

    test('se puede elegir una carátula por canción de YouTube, sin repetir', () => {
        const canciones = [cancion('aaaaaaaaaaa'), cancion('aaaaaaaaaaa'), { src: 'idb://local', thumbnail: 'x.jpg' }, cancion('bbbbbbbbbbb')];
        assert.deepEqual([...caratulasDeLista(canciones).map((c) => c.videoId)], ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    });

    test('viaja a la cuenta solo si es una de sus canciones, y vuelve igual', () => {
        assert.equal(listaACuenta({ id: '1', name: 'L', ...pl }).portada, 'bbbbbbbbbbb');
        assert.equal(listaACuenta({ id: '1', name: 'L', ...pl, portada: 'ccccccccccc' }).portada, '');
        const remota = { id: '1', name: 'L', songs: ['aaaaaaaaaaa', 'bbbbbbbbbbb'], createdAt: hace(0) };
        assert.equal(validarLista({ ...remota, portada: 'bbbbbbbbbbb' }).portada, 'bbbbbbbbbbb');
        assert.equal(validarLista({ ...remota, portada: 'ccccccccccc' }).portada, '');
        assert.equal(validarLista({ ...remota, portada: 42 }).portada, '');
    });
});

describe('cuándo se actualizó una lista', () => {
    const base = () => [{ id: '1', name: 'L', songs: [cancion('aaaaaaaaaaa')] }, { id: '2', name: 'Otra', songs: [] }];

    test('al cambiar lo que se ve: nombre, canciones, su orden o la portada', () => {
        const antes = base();
        const despues = base();
        despues[0].songs.push(cancion('bbbbbbbbbbb'));
        marcarActualizadas(antes, despues, 'AHORA');
        assert.equal(despues[0].updatedAt, 'AHORA');
        assert.equal(despues[1].updatedAt, undefined);
    });

    test('no al rellenar la duración ni al bajar de la nube una canción', () => {
        const antes = [{ id: '1', name: 'L', songs: [cancion('aaaaaaaaaaa', { src: 'nube://aaaaaaaaaaa', nube: true })] }];
        const despues = [{ id: '1', name: 'L', songs: [cancion('aaaaaaaaaaa', { duration: 200 })] }];
        marcarActualizadas(antes, despues, 'AHORA');
        assert.equal(despues[0].updatedAt, undefined);
    });

    test('una lista nueva, también', () => {
        const despues = [...base(), { id: '3', name: 'Nueva', songs: [] }];
        marcarActualizadas(base(), despues, 'AHORA');
        assert.equal(despues[2].updatedAt, 'AHORA');
    });
});
