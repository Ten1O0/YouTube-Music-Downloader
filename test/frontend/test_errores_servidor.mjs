/**
 * Los errores del servidor con código (plan 21, T7): YouTube limita, el
 * servidor está lleno, el cupo de la hora. Se enseñan traducidos, no con el
 * texto en castellano que manda el servidor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';
import es from '../../frontend/src/i18n/translations/es.js';

const { api } = app();

test('un código conocido se traduce', () => {
    assert.equal(api.mensajeDelServidor({ code: 'youtube_limit', error: 'texto del servidor' }), es.err_youtube_limit);
    assert.equal(api.mensajeDelServidor({ code: 'server_busy', error: 'x' }), es.err_server_busy);
    assert.equal(api.mensajeDelServidor({ code: 'hour_limit', error: 'x', quedan: 0 }), es.err_hour_limit);
});

test('sin código, o con uno desconocido, el texto del servidor; y si no hay, el de por defecto', () => {
    assert.equal(api.mensajeDelServidor({ error: 'URL de YouTube no válida' }), 'URL de YouTube no válida');
    assert.equal(api.mensajeDelServidor({ code: 'otro', error: 'tal' }), 'tal');
    assert.equal(api.mensajeDelServidor({}, 'por defecto'), 'por defecto');
    assert.equal(api.mensajeDelServidor(null), es.error_download);
});

test('el progreso de una descarga bloqueada por YouTube también se traduce', () => {
    assert.equal(api.resolveProgressText({ status: 'error', code: 'error_youtube_limit', message: 'x' }), es.srv_error_youtube_limit);
});
