/**
 * Avisos de descarga: isla y banners (plan 09, T13).
 *
 * Lo visual lo cubren los recorridos 8 y 9 en un navegador. Aquí se fija la
 * lógica que decide qué se dice y dónde va cada aviso, y una trampa que ya
 * nos pasó: dos claves de traducción con el mismo nombre, donde la segunda
 * anula a la primera sin que nada falle.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resumenDescargas, posicionesPila } from '../../frontend/src/ui/downloads-hud.js';
import { codigoCliente, leer } from './fuentes.mjs';


describe('resumenDescargas', () => {
    test('el progreso es la media de las que siguen en curso', () => {
        const r = resumenDescargas([
            { status: 'downloading', percent: 20 },
            { status: 'downloading', percent: 60 },
            { status: 'complete', percent: 100 },
        ]);
        assert.equal(r.total, 3);
        assert.equal(r.activos, 2);
        assert.equal(r.percent, 40);
    });

    test('si todas terminaron, la media es de todas', () => {
        const r = resumenDescargas([{ status: 'complete', percent: 100 }, { status: 'error', percent: 30 }]);
        assert.equal(r.activos, 0);
        assert.equal(r.percent, 65);
    });

    test('sin descargas no hay división entre cero', () => {
        assert.deepEqual(resumenDescargas([]), { total: 0, activos: 0, percent: 0 });
    });
});

describe('posicionesPila', () => {
    test('cada banner va debajo del anterior, con su hueco', () => {
        assert.deepEqual(posicionesPila([64, 70, 64], 10), [0, 74, 154]);
    });

    test('a partir del tercero no caben y se agrupan en «+N»', () => {
        assert.deepEqual(posicionesPila([64, 64, 64, 64, 64], 10, 3), [0, 74, 148, null, null]);
    });
});

describe('traducciones', () => {
    test('ninguna clave está repetida dentro de un idioma', () => {
        // En un objeto literal, una clave repetida anula a la anterior sin
        // error. Así un «dl_done» nuevo tapó al que ya existía.
        const idiomas = ['es', 'en', 'fr', 'de', 'pt', 'zh'];
        for (const nombre of idiomas) {
            const fuente = leer(`frontend/src/i18n/translations/${nombre}.js`);
            const claves = [...fuente.matchAll(/^\s{4}([a-z0-9_]+):/gm)].map(m => m[1]);
            assert.ok(claves.length > 100, `${nombre}: no se encuentran las claves`);
            const repetidas = claves.filter((k, i) => claves.indexOf(k) !== i);
            assert.deepEqual(repetidas, [], `${nombre}: claves repetidas`);
        }
    });

    test('los textos de los avisos existen en los seis idiomas', () => {
        const fuente = codigoCliente();
        for (const clave of ['hud_count', 'hud_more', 'hud_done', 'hud_failed', 'hud_announce_start', 'hud_announce_done']) {
            const veces = (fuente.match(new RegExp(`^\\s+${clave}:`, 'gm')) || []).length;
            assert.equal(veces, 6, `${clave} aparece ${veces} veces`);
        }
    });
});
