/**
 * Deshacer lo que se borra (plan 24, P9): quitar canciones y volver a ponerlas
 * cada una en su sitio, aunque mientras tanto la lista haya cambiado.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reinsertar, separar } from '../../frontend/src/features/seleccion/sitios.js';

const c = (id) => ({ src: `idb://${id}`, title: id });
const ids = (lista) => lista.map((s) => s.title);

describe('separar', () => {
    test('lo quitado sale con su índice y lo demás queda en orden', () => {
        const { quedan, quitados } = separar([c('a'), c('b'), c('c'), c('d')], ['idb://b', 'idb://d']);
        assert.deepEqual(ids(quedan), ['a', 'c']);
        assert.deepEqual(quitados.map((q) => [q.item.title, q.indice]), [['b', 1], ['d', 3]]);
    });

    test('un src que no está no quita nada', () => {
        const { quedan, quitados } = separar([c('a')], ['idb://x']);
        assert.deepEqual(ids(quedan), ['a']);
        assert.equal(quitados.length, 0);
    });
});

describe('reinsertar', () => {
    test('deshacer deja la lista exactamente como estaba', () => {
        const antes = [c('a'), c('b'), c('c'), c('d'), c('e')];
        const { quedan, quitados } = separar(antes, ['idb://a', 'idb://c', 'idb://e']);
        assert.deepEqual(ids(reinsertar(quedan, quitados)), ids(antes));
    });

    test('en el orden de los índices, aunque lleguen desordenados', () => {
        const { quedan, quitados } = separar([c('a'), c('b'), c('c')], ['idb://a', 'idb://c']);
        assert.deepEqual(ids(reinsertar(quedan, [...quitados].reverse())), ['a', 'b', 'c']);
    });

    test('si mientras tanto la lista encogió, lo de más allá va al final', () => {
        const { quitados } = separar([c('a'), c('b'), c('c')], ['idb://c']);
        assert.deepEqual(ids(reinsertar([c('a')], quitados)), ['a', 'c']);
    });

    test('lo que ya volvió por otro camino no se duplica', () => {
        const { quitados } = separar([c('a'), c('b')], ['idb://b']);
        assert.deepEqual(ids(reinsertar([c('a'), c('b')], quitados)), ['a', 'b']);
    });
});
