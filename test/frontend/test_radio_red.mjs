/**
 * ¿Datos móviles o Wi-Fi? (plan 16): para «Radio solo con Wi-Fi».
 *
 * En la APK manda el plugin @capacitor/network; en la web, lo que sepa el
 * navegador. Si no se sabe, se da por Wi-Fi.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { alCambiarRed, redMovil } from '../../frontend/src/features/radio/red.js';

/** El plugin de red de Capacitor, con su estado y sus oyentes. */
function pluginFalso(connectionType, { falla = false } = {}) {
    const oyentes = new Set();
    const Network = {
        getStatus: async () => {
            if (falla) throw new Error('sin permiso');
            return { connected: connectionType !== 'none', connectionType };
        },
        addListener(evento, fn) {
            assert.equal(evento, 'networkStatusChange');
            oyentes.add(fn);
            // Como Capacitor 5: una promesa que además es el propio manejador
            const manejador = { remove: async () => { oyentes.delete(fn); } };
            return Object.assign(Promise.resolve(manejador), manejador);
        },
        cambiar(tipo) { oyentes.forEach((fn) => fn({ connected: tipo !== 'none', connectionType: tipo })); },
        oyentes,
    };
    return { Plugins: { Network } };
}

/** navigator.connection de Chrome en Android. */
function conexionFalsa(type) {
    const oyentes = new Set();
    return {
        connection: {
            type,
            addEventListener: (e, fn) => { assert.equal(e, 'change'); oyentes.add(fn); },
            removeEventListener: (e, fn) => oyentes.delete(fn),
            cambiar(t) { this.type = t; oyentes.forEach((fn) => fn()); },
            oyentes,
        },
    };
}

describe('redMovil en la APK', () => {
    test('datos móviles: true', async () => {
        assert.equal(await redMovil({ capacitor: pluginFalso('cellular') }), true);
    });

    test('Wi-Fi, sin conexión o sin saberlo: false', async () => {
        for (const tipo of ['wifi', 'none', 'unknown']) {
            assert.equal(await redMovil({ capacitor: pluginFalso(tipo) }), false, tipo);
        }
    });

    test('si el plugin falla, false', async () => {
        assert.equal(await redMovil({ capacitor: pluginFalso('cellular', { falla: true }) }), false);
    });

    test('manda el plugin aunque el navegador diga otra cosa', async () => {
        assert.equal(await redMovil({ capacitor: pluginFalso('wifi'), navegador: conexionFalsa('cellular') }), false);
    });
});

describe('redMovil en la web', () => {
    test('navigator.connection.type «cellular»: true', async () => {
        assert.equal(await redMovil({ capacitor: undefined, navegador: conexionFalsa('cellular') }), true);
    });

    test('wifi, ethernet o un navegador que no lo dice: false', async () => {
        assert.equal(await redMovil({ capacitor: undefined, navegador: conexionFalsa('wifi') }), false);
        assert.equal(await redMovil({ capacitor: undefined, navegador: conexionFalsa('ethernet') }), false);
        assert.equal(await redMovil({ capacitor: undefined, navegador: {} }), false);
        assert.equal(await redMovil({ capacitor: undefined, navegador: undefined }), false);
    });
});

describe('alCambiarRed', () => {
    test('en la APK avisa de cada cambio y deja de hacerlo al quitarlo', async () => {
        const capacitor = pluginFalso('wifi');
        const avisos = [];
        const dejar = alCambiarRed((movil) => avisos.push(movil), { capacitor });
        capacitor.Plugins.Network.cambiar('cellular');
        capacitor.Plugins.Network.cambiar('wifi');
        assert.deepEqual(avisos, [true, false]);
        dejar();
        await new Promise((ok) => setImmediate(ok));
        assert.equal(capacitor.Plugins.Network.oyentes.size, 0);
    });

    test('en la web, con navigator.connection', () => {
        const navegador = conexionFalsa('wifi');
        const avisos = [];
        const dejar = alCambiarRed((movil) => avisos.push(movil), { capacitor: undefined, navegador });
        navegador.connection.cambiar('cellular');
        dejar();
        navegador.connection.cambiar('wifi');
        assert.deepEqual(avisos, [true]);
    });

    test('sin forma de saberlo, no avisa y quitarlo no rompe', () => {
        const dejar = alCambiarRed(() => assert.fail('no debería avisar'), { capacitor: undefined, navegador: {} });
        dejar();
    });
});
