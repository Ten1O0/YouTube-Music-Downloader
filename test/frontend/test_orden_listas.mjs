/**
 * El orden y el resumen de una lista (plan 23, T4).
 *
 * Lo descargado primero y lo de la nube después, cada grupo en el orden que le
 * dio el usuario; al reordenar, cada canción se queda en su grupo y el orden
 * guardado conserva los huecos de cada grupo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const { ordenDeVista, moverEnGrupo, cuentasDeLista, textoDeLista } = api;

const local = (id, duration) => ({ src: `idb://${id}`, title: id, ...(duration ? { duration } : {}) });
const nube = (id, duration) => ({ src: `nube://${id}`, title: id, nube: true, ...(duration ? { duration } : {}) });
// El arnés corre en otro contexto: se compara una copia de aquí
const ids = (lista) => [...lista].map((s) => s.title);
const copia = (x) => JSON.parse(JSON.stringify(x));

// Guardada intercalada: a (local), X (nube), b, Y, c
const GUARDADA = [local('a'), nube('X'), local('b'), nube('Y'), local('c')];

describe('ordenDeVista', () => {
    test('lo descargado primero y la nube después, cada grupo en su orden', () => {
        assert.deepEqual(ids(ordenDeVista(GUARDADA)), ['a', 'b', 'c', 'X', 'Y']);
    });

    test('no cambia la lista guardada y aguanta una lista que no existe', () => {
        const antes = copia(GUARDADA);
        ordenDeVista(GUARDADA);
        assert.deepEqual(GUARDADA, antes);
        assert.equal(ordenDeVista(undefined).length, 0);
    });
});

describe('moverEnGrupo', () => {
    test('mueve dentro de lo descargado y respeta los huecos de la nube', () => {
        // Vista a b c X Y: c (2) arriba del todo (0)
        const nueva = moverEnGrupo(GUARDADA, 2, 0);
        assert.deepEqual(ids(nueva), ['c', 'X', 'a', 'Y', 'b']);
        assert.deepEqual(ids(ordenDeVista(nueva)), ['c', 'a', 'b', 'X', 'Y']);
    });

    test('mueve dentro de la nube', () => {
        // Vista a b c X Y: Y (4) antes de X (3)
        const nueva = moverEnGrupo(GUARDADA, 4, 3);
        assert.deepEqual(ids(nueva), ['a', 'Y', 'b', 'X', 'c']);
    });

    test('soltada en el otro grupo, se queda en el extremo del suyo', () => {
        // a (0) soltada sobre Y (4): al final de lo descargado
        assert.deepEqual(ids(ordenDeVista(moverEnGrupo(GUARDADA, 0, 4))), ['b', 'c', 'a', 'X', 'Y']);
        // Y (4) soltada sobre a (0): al principio de la nube
        assert.deepEqual(ids(ordenDeVista(moverEnGrupo(GUARDADA, 4, 0))), ['a', 'b', 'c', 'Y', 'X']);
    });

    test('si una de la nube se descarga, vuelve a donde la puso el usuario', () => {
        const nueva = moverEnGrupo(GUARDADA, 2, 0).map((s) => (s.title === 'Y' ? local('Y') : s));
        assert.deepEqual(ids(ordenDeVista(nueva)), ['c', 'a', 'Y', 'b', 'X']);
    });

    test('sin moverse o fuera de la lista, la deja igual y devuelve una copia', () => {
        for (const [desde, hasta] of [[1, 1], [9, 0]]) {
            const nueva = moverEnGrupo(GUARDADA, desde, hasta);
            assert.notEqual(nueva, GUARDADA);
            assert.deepEqual(copia(nueva), GUARDADA);
        }
    });
});

describe('el resumen', () => {
    test('cuenta todas, suma solo lo descargado y cuenta la nube', () => {
        const lista = [local('a', 1500), nube('X', 600), local('b', 1320), local('c')];
        assert.deepEqual(copia(cuentasDeLista(lista)), { total: 4, segundos: 2820, enNube: 1 });
        assert.equal(textoDeLista(lista), '4 canciones · 47 min · 1 en la nube');
    });

    test('sin duración ni nube, solo cuántas', () => {
        assert.equal(textoDeLista([local('a'), local('b')]), '2 canciones');
        assert.equal(textoDeLista([]), '0 canciones');
    });
});
