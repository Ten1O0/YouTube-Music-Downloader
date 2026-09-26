/**
 * Hápticos (plan 09, T19).
 *
 * En la APK cada momento de la tabla del §2.7 tiene su háptico; en la web, y
 * con el complemento ausente o fallando, no pasa nada y nada se rompe.
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { avisar, haptics } from '../../frontend/src/ui/haptics.js';
import { codigoCliente, leer } from './fuentes.mjs';

const esperar = () => new Promise(r => setTimeout(r, 0));

function apk() {
    const llamadas = [];
    const registrar = nombre => (arg) => { llamadas.push(arg ? `${nombre}:${Object.values(arg)[0]}` : nombre); return Promise.resolve(); };
    globalThis.Capacitor = {
        isNative: true,
        Plugins: {
            Haptics: {
                selectionStart: registrar('selectionStart'),
                selectionChanged: registrar('selectionChanged'),
                selectionEnd: registrar('selectionEnd'),
                impact: registrar('impact'),
                notification: registrar('notification'),
            },
        },
    };
    return llamadas;
}

afterEach(() => { delete globalThis.Capacitor; });

describe('en la APK', () => {
    test('cada nombre de la interfaz es su háptico', async () => {
        const llamadas = apk();
        avisar('light');
        avisar('success');
        avisar('error');
        avisar('selection');
        await esperar();
        assert.deepEqual(llamadas, [
            'impact:LIGHT', 'notification:SUCCESS', 'notification:ERROR',
            'selectionStart', 'selectionChanged', 'selectionEnd',
        ]);
    });

    test('un nombre desconocido no hace nada', async () => {
        const llamadas = apk();
        avisar('trueno');
        await esperar();
        assert.deepEqual(llamadas, []);
    });

    test('si el sistema los rechaza, no hay error sin capturar', async () => {
        globalThis.Capacitor = { isNative: true, Plugins: { Haptics: { impact: () => Promise.reject(new Error('desactivados')) } } };
        haptics.impact();
        await esperar();
    });

    test('una APK antigua sin el complemento tampoco rompe nada', () => {
        globalThis.Capacitor = { isNative: true, Plugins: { Haptics: { impact() { throw new Error('no implementado'); } } } };
        assert.doesNotThrow(() => avisar('light'));
    });
});

describe('en la web', () => {
    test('no llama a nada aunque exista un Capacitor que no es nativo', async () => {
        const llamadas = apk();
        globalThis.Capacitor.isNative = false;
        avisar('light');
        await esperar();
        assert.deepEqual(llamadas, []);
    });

    test('sin Capacitor, tampoco', () => {
        assert.doesNotThrow(() => avisar('success'));
    });
});

describe('momentos del §2.7 conectados', () => {
    const APP = codigoCliente();

    test('avisarHaptico va al complemento', () => {
        assert.match(APP, /export function avisarHaptico\(tipo\) \{ avisar\(tipo\); \}/);
    });

    test('reproducir/pausar vibra al pulsar, no desde los auriculares', () => {
        assert.match(APP, /addOptionalEventListener\(playerPlay, 'click', \(e\) => \{ e\.stopPropagation\(\); avisarHaptico\('light'\); togglePlay\(\); \}\)/);
        const i = APP.indexOf('    function togglePlay() {');
        assert.ok(!APP.slice(i, APP.indexOf('\n    }\n', i)).includes('avisarHaptico'), 'togglePlay lo usan también los auriculares');
    });

    test('umbral, reordenar, cola, favorito y hoja', () => {
        const usos = (APP.match(/avisarHaptico\('(?:selection|light)'\)/g) || []).length;
        assert.ok(usos >= 7, `solo ${usos} momentos conectados`);
        assert.match(leer('frontend/src/ui/sheets.js'), /haptico\('light'\)/);
    });

    test('el complemento está en la APK', () => {
        assert.match(leer('mobile/package.json'), /"@capacitor\/haptics": "\^5/);
        assert.match(leer('mobile/android/capacitor.settings.gradle'), /capacitor-haptics/);
    });
});

describe('lo que no vibra', () => {
    test('cambiar de pestaña es navegar: no vibra', () => {
        const APP = codigoCliente();
        const i = APP.indexOf("document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {");
        const manejador = APP.slice(i, APP.indexOf('switchView(btn.dataset.view);', i));
        assert.ok(!manejador.includes('avisarHaptico'), 'la pestaña vuelve a vibrar');
    });
});
