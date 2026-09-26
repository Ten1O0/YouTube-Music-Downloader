/**
 * Dónde se ejecuta la app y a qué servidor llama (config/env.js, plan 08 D2).
 *
 * Antes había dos detecciones con lógicas distintas (IS_NATIVE/API_BASE y
 * API_URL), y API_URL, al ser una constante, no se enteraba si Capacitor
 * aparecía después de cargar. Ahora son funciones: se prueba que responden con
 * el estado del momento en los cuatro entornos posibles.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, isNative, SERVIDOR } from '../../frontend/src/config/env.js';

function entorno({ capacitor, userAgent = 'Mozilla/5.0 Chrome/120', protocolo = 'https:' } = {}) {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
    Object.defineProperty(globalThis, 'location', { value: { protocol: protocolo }, configurable: true });
    if (capacitor) globalThis.Capacitor = capacitor; else delete globalThis.Capacitor;
}

describe('isNative y apiBase', () => {
    beforeEach(() => entorno());

    test('en la web: mismo origen', () => {
        assert.equal(isNative(), false);
        assert.equal(apiBase(), '');
    });

    test('en la APK, con Capacitor', () => {
        entorno({ capacitor: { isNative: true } });
        assert.equal(isNative(), true);
        assert.equal(apiBase(), SERVIDOR);
    });

    test('Capacitor sin isNative pero con plataforma móvil', () => {
        entorno({ capacitor: { platform: 'android' } });
        assert.equal(isNative(), true);
    });

    test('Capacitor en la web (plataforma web) no cuenta como APK', () => {
        entorno({ capacitor: { isNative: false, platform: 'web' } });
        assert.equal(isNative(), false);
    });

    test('cargada desde file: o capacitor:', () => {
        entorno({ protocolo: 'file:' });
        assert.equal(isNative(), true);
        entorno({ protocolo: 'capacitor:' });
        assert.equal(isNative(), true);
    });

    test('solo por el agente de usuario', () => {
        entorno({ userAgent: 'Mozilla/5.0 Capacitor' });
        assert.equal(isNative(), true);
    });

    test('responde con el estado del momento: Capacitor puede llegar después', () => {
        assert.equal(apiBase(), '');
        globalThis.Capacitor = { isNative: true };
        assert.equal(apiBase(), SERVIDOR);
    });

    test('el servidor es el de producción', () => {
        assert.equal(SERVIDOR, 'https://music.dannarita.es');
    });
});
