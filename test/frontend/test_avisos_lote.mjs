/**
 * El aviso de un lote (plan 20, T3): un solo aviso para muchas canciones.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filasDeIsla, resumenDescargas, textoDeLote } from '../../frontend/src/ui/downloads-hud.js';

const t = (clave, p = {}) => `${clave}${Object.keys(p).length ? JSON.stringify(p) : ''}`;
const lote = (status, lote, extra = {}) => ({ id: 'L', tipo: 'lote', status, percent: 40, info: { title: 'Lista E2E' }, lote, ...extra });

test('en marcha: cuántas van de cuántas', () => {
    assert.equal(textoDeLote(lote('downloading', { hechas: 12, total: 35 }), t), 'hud_batch_progress{"n":12,"total":35}');
});

test('termina bien: cuántas se descargaron', () => {
    assert.equal(textoDeLote(lote('complete', { hechas: 35, total: 35 }), t), 'hud_batch_done{"n":35}');
});

test('termina con fallos: cuántas de cuántas y cuántas no se pudieron', () => {
    assert.equal(textoDeLote(lote('error', { hechas: 33, total: 35, fallidas: 2 }), t),
        'hud_batch_partial{"n":33,"total":35,"fallidas":2}');
});

test('la isla desplegada enseña lo que se está bajando (hasta 3)', () => {
    const item = lote('downloading', { hechas: 1, total: 9, enCurso: ['A', 'B', 'C', 'D'].map((titulo) => ({ titulo })) });
    const filas = filasDeIsla([item]);
    assert.deepEqual(filas.map((f) => f.tipo), ['item', 'sub', 'sub', 'sub']);
    assert.deepEqual(filas.slice(1).map((f) => f.titulo), ['A', 'B', 'C']);
});

test('con fallos: cuáles fallaron y las acciones «Reintentar» y «Cerrar»', () => {
    const item = lote('error', { hechas: 1, total: 3, fallidas: 2, nombresFallidas: ['X', 'Y'] }, { alReintentar: () => {} });
    const filas = filasDeIsla([item]);
    assert.deepEqual(filas.map((f) => f.tipo), ['item', 'sub', 'sub', 'acciones']);
    assert.ok(filas.slice(1, 3).every((f) => f.fallida));
});

test('una descarga suelta sigue siendo una sola fila', () => {
    const suelta = { id: 'S', status: 'downloading', percent: 50, info: { title: 'Una' } };
    assert.deepEqual(filasDeIsla([suelta]).map((f) => f.tipo), ['item']);
});

test('el recuento de la isla cuenta el lote como un aviso, con su avance', () => {
    const r = resumenDescargas([lote('downloading', { hechas: 2, total: 5 })]);
    assert.equal(r.total, 1);
    assert.equal(r.percent, 40);
});
