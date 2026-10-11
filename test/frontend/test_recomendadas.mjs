/**
 * Las recomendadas al final de una lista (plan 24, P7): de qué canciones se
 * parte y cuáles se enseñan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();
const { semillasDe, siguientes, CUANTAS } = api;

const id = (n) => `cancion${String(n).padStart(4, '0')}`;
const candidata = (n, extra = {}) => ({ id: id(n), title: `Grupo ${n} - Tema ${n}`, channel: `Canal ${n}`, duration: 200, ...extra });

test('las semillas: canciones de la lista con su videoId, sin repetir ni las ya usadas', () => {
    const canciones = [{ videoId: id(1) }, { videoId: id(1) }, { videoId: id(2) }, { src: 'idb://local' }, { videoId: id(3) }];
    const todas = [...semillasDe(canciones, 10)].sort();
    assert.deepEqual(todas, [id(1), id(2), id(3)]);
    assert.deepEqual([...semillasDe(canciones, 10, { usadas: new Set([id(1), id(2)]) })], [id(3)]);
    assert.equal(semillasDe([], 2).length, 0);
});

test('al azar: con otro azar, otra semilla', () => {
    const canciones = [1, 2, 3, 4].map((n) => ({ videoId: id(n) }));
    const primera = (valor) => semillasDe(canciones, 1, { azar: () => valor })[0];
    assert.notEqual(primera(0), primera(0.99));
});

test('cinco, sin las de la lista ni las ya enseñadas', () => {
    const candidatas = Array.from({ length: 12 }, (_, i) => candidata(i + 1));
    const lote = siguientes(candidatas, { enLista: new Set([id(1)]), mostradas: new Set([id(2), id(3)]) });
    assert.equal(lote.length, CUANTAS);
    assert.deepEqual([...lote.map((s) => s.videoId)], [id(4), id(5), id(6), id(7), id(8)]);
});

test('la que ya está descargada, tal cual, para añadirla sin bajarla', () => {
    const descargada = { src: 'idb://x', videoId: id(5), title: 'Grupo 5 - Tema 5' };
    const [primera] = siguientes([candidata(5)], { biblioteca: [descargada] });
    assert.equal(primera.src, 'idb://x');
    assert.equal(primera.radio, undefined);
});
