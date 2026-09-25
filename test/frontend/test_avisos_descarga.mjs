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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumenDescargas, posicionesPila } from '../../src/ui/downloads-hud.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
        const fuente = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
        const inicio = fuente.indexOf('const TRANSLATIONS = {');
        assert.ok(inicio >= 0, 'no se encuentra TRANSLATIONS');
        const bloque = fuente.slice(inicio, fuente.indexOf('\n};', inicio));
        const idiomas = bloque.split(/\n    (?=[a-z]{2}: \{)/).slice(1);
        assert.equal(idiomas.length, 6, 'se esperaban seis idiomas');
        for (const idioma of idiomas) {
            const nombre = idioma.slice(0, 2);
            const claves = [...idioma.matchAll(/^\s{8}([a-z0-9_]+):/gm)].map(m => m[1]);
            const repetidas = claves.filter((k, i) => claves.indexOf(k) !== i);
            assert.deepEqual(repetidas, [], `${nombre}: claves repetidas`);
        }
    });

    test('los textos de los avisos existen en los seis idiomas', () => {
        const fuente = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
        for (const clave of ['hud_count', 'hud_more', 'hud_done', 'hud_failed', 'hud_announce_start', 'hud_announce_done']) {
            const veces = (fuente.match(new RegExp(`^\\s+${clave}:`, 'gm')) || []).length;
            assert.equal(veces, 6, `${clave} aparece ${veces} veces`);
        }
    });
});
