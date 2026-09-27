/**
 * Listas automáticas (plan 11, T7): umbrales, orden y que las vacías no salgan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { esAutomatica, listasAutomaticas, PRESENTACION_AUTO } from '../../frontend/src/features/playlists/auto.js';

const AHORA = Date.parse('2026-09-27T12:00:00Z');
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias) => new Date(AHORA - dias * DIA).toISOString();
const c = (id, extra = {}) => ({ src: `idb://${id}`, videoId: id, title: id, ...extra });
const lista = (listas, id) => listas.find((l) => l.id === id)?.songs.map((s) => s.videoId);

describe('listasAutomaticas', () => {
    test('biblioteca vacía: ninguna lista', () => {
        assert.deepEqual(listasAutomaticas([], {}, AHORA), []);
        assert.deepEqual(listasAutomaticas(undefined, undefined, AHORA), []);
    });

    test('las tres, en su orden, con sus ids', () => {
        const l = listasAutomaticas([c('a', { addedAt: hace(1) }), c('b')], { a: { n: 3 } }, AHORA);
        assert.deepEqual(l.map((x) => x.id), ['auto:top', 'auto:recent', 'auto:unplayed']);
    });

    describe('Más escuchadas', () => {
        test('mínimo 2 escuchas', () => {
            const l = listasAutomaticas([c('a'), c('b')], { a: { n: 1 }, b: { n: 2 } }, AHORA);
            assert.deepEqual(lista(l, 'auto:top'), ['b']);
        });

        test('de más a menos; empate, la escuchada más recientemente', () => {
            const l = listasAutomaticas([c('a'), c('b'), c('c')], {
                a: { n: 2, ultima: hace(5) }, b: { n: 7, ultima: hace(9) }, c: { n: 2, ultima: hace(1) },
            }, AHORA);
            assert.deepEqual(lista(l, 'auto:top'), ['b', 'c', 'a']);
        });

        test('como mucho 25', () => {
            const bib = Array.from({ length: 30 }, (_, i) => c(`v${i}`));
            const cont = Object.fromEntries(bib.map((s, i) => [s.videoId, { n: 2 + i }]));
            const top = lista(listasAutomaticas(bib, cont, AHORA), 'auto:top');
            assert.equal(top.length, 25);
            assert.equal(top[0], 'v29');
        });

        test('sin videoId cuenta por src', () => {
            const l = listasAutomaticas([{ src: 'blob:x', title: 'x' }], { 'blob:x': { n: 4 } }, AHORA);
            assert.equal(l[0].id, 'auto:top');
        });
    });

    describe('Añadidas recientemente', () => {
        test('últimos 30 días, las más nuevas primero', () => {
            const l = listasAutomaticas([
                c('vieja', { addedAt: hace(31) }), c('ayer', { addedAt: hace(1) }), c('mes', { addedAt: hace(29.9) }), c('hoy', { addedAt: hace(0) }),
            ], {}, AHORA);
            assert.deepEqual(lista(l, 'auto:recent'), ['hoy', 'ayer', 'mes']);
        });

        test('sin fecha o con fecha futura o rota no entra', () => {
            const l = listasAutomaticas([c('a'), c('b', { addedAt: hace(-2) }), c('d', { addedAt: 'no es fecha' })], {}, AHORA);
            assert.equal(lista(l, 'auto:recent'), undefined);
        });

        test('como mucho 50', () => {
            const bib = Array.from({ length: 60 }, (_, i) => c(`v${i}`, { addedAt: hace(i / 10) }));
            assert.equal(lista(listasAutomaticas(bib, {}, AHORA), 'auto:recent').length, 50);
        });
    });

    describe('Sin escuchar', () => {
        test('las de 0 escuchas, en el orden de la biblioteca', () => {
            const l = listasAutomaticas([c('b'), c('a'), c('x')], { x: { n: 1 } }, AHORA);
            assert.deepEqual(lista(l, 'auto:unplayed'), ['b', 'a']);
        });

        test('todo escuchado: la lista no aparece', () => {
            const l = listasAutomaticas([c('a')], { a: { n: 1 } }, AHORA);
            assert.deepEqual(l.map((x) => x.id), []);
        });
    });

    test('las canciones sin audio no entran en ninguna', () => {
        const l = listasAutomaticas([c('a', { unavailable: true, addedAt: hace(1) })], { a: { n: 5 } }, AHORA);
        assert.deepEqual(l, []);
    });

    test('no modifica la biblioteca ni los contadores', () => {
        const bib = [c('b', { addedAt: hace(2) }), c('a', { addedAt: hace(1) })];
        const cont = { a: { n: 3 }, b: { n: 2 } };
        const copia = JSON.stringify([bib, cont]);
        listasAutomaticas(bib, cont, AHORA);
        assert.equal(JSON.stringify([bib, cont]), copia);
    });
});

test('esAutomatica y cada id tiene nombre e icono', () => {
    assert.equal(esAutomatica('auto:top'), true);
    assert.equal(esAutomatica('favorites'), false);
    assert.equal(esAutomatica('1712345678'), false);
    assert.equal(esAutomatica(undefined), false);
    for (const id of ['auto:top', 'auto:recent', 'auto:unplayed']) {
        assert.ok(PRESENTACION_AUTO[id].nombre && PRESENTACION_AUTO[id].icono, id);
    }
});
