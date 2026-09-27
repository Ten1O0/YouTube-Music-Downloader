/**
 * La sesión se inicia una sola vez (plan 10, T2).
 *
 * main.js llamaba a auth.init() desde dos DOMContentLoaded: dos
 * google.accounts.id.initialize() (Google lo avisaba en consola), dos
 * /api/auth/me y dos sincronizaciones con sesión.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './harness.mjs';
import { leer } from './fuentes.mjs';

describe('inicio de la sesión', () => {
    test('init() dos veces inicializa Google una sola vez', async () => {
        const { api, context } = loadApp();
        let inicializaciones = 0;
        context.google = { accounts: { id: { initialize() { inicializaciones++; }, renderButton() {}, prompt() {} } } };

        const primera = api.auth.init();
        const segunda = api.auth.init();
        assert.equal(primera, segunda, 'la segunda llamada devuelve la misma promesa');
        await primera;
        assert.equal(inicializaciones, 1);
    });

    test('main.js solo la llama en un sitio', () => {
        const llamadas = leer('frontend/src/main.js').match(/\bauth\.init\(\)/g) ?? [];
        assert.equal(llamadas.length, 1);
    });
});
