/**
 * Descargas que sobreviven a cerrar la app (plan 14, T2): qué se hace con cada
 * una al volver, según lo que diga el servidor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CADUCIDAD_MS, decidirPendiente, MAX_INTENTOS } from '../../frontend/src/features/download/pendientes.js';

const AHORA = 1_800_000_000_000;
const entrada = (extra = {}) => ({ downloadId: 'a'.repeat(32), creada: AHORA - 60_000, intentos: 0, ...extra });

test('terminada en el servidor: se recoge', () => {
    assert.equal(decidirPendiente({ status: 'complete' }, entrada(), AHORA), 'recoger');
});

test('aún en marcha: se sigue su progreso', () => {
    assert.equal(decidirPendiente({ status: 'downloading' }, entrada(), AHORA), 'seguir');
    assert.equal(decidirPendiente({ status: 'starting' }, entrada(), AHORA), 'seguir');
});

test('el servidor ya no la tiene, falló o se canceló: se descarta (y se avisa)', () => {
    for (const progreso of [null, { status: 'unknown' }, { status: 'error' }, { status: 'cancelled' }, {}]) {
        assert.equal(decidirPendiente(progreso, entrada(), AHORA), 'descartar', JSON.stringify(progreso));
    }
});

test('más vieja que lo que guarda el servidor: se descarta sin preguntar', () => {
    assert.equal(decidirPendiente({ status: 'complete' }, entrada({ creada: AHORA - CADUCIDAD_MS - 1 }), AHORA), 'descartar');
});

test('tras varios intentos fallidos de guardarla, se deja', () => {
    assert.equal(decidirPendiente({ status: 'complete' }, entrada({ intentos: MAX_INTENTOS }), AHORA), 'descartar');
    assert.equal(decidirPendiente({ status: 'complete' }, entrada({ intentos: MAX_INTENTOS - 1 }), AHORA), 'recoger');
});

test('una entrada rota no rompe nada', () => {
    assert.equal(decidirPendiente({ status: 'complete' }, null, AHORA), 'descartar');
});
