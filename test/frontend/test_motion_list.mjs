/**
 * Filas que entran, salen y se recolocan (plan 09, T14).
 *
 * Lo que se fija aquí es la decisión: qué fila es nueva, cuál se ha movido y
 * cuánto, y cuándo son demasiados cambios para animar. Si se equivoca, una
 * lista larga se pone a bailar entera al añadir una canción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planListChange } from '../../frontend/src/ui/motion/list.js';
import { codigoCliente } from './fuentes.mjs';

const r = top => ({ top });

describe('planListChange', () => {
    test('una fila nueva arriba entra, y las demás bajan lo que ocupa', () => {
        const antes = new Map([['a', r(0)], ['b', r(72)]]);
        const despues = new Map([['n', r(0)], ['a', r(72)], ['b', r(144)]]);
        assert.deepEqual(planListChange(antes, despues), [
            { clave: 'n', tipo: 'enter' },
            { clave: 'a', tipo: 'move', dy: -72 },
            { clave: 'b', tipo: 'move', dy: -72 },
        ]);
    });

    test('lo que no se ha movido no se anima', () => {
        const mismo = new Map([['a', r(0)], ['b', r(72)]]);
        assert.deepEqual(planListChange(mismo, new Map(mismo)), []);
    });

    test('al borrar, las de debajo suben desde donde estaban', () => {
        const antes = new Map([['a', r(0)], ['b', r(72)], ['c', r(144)]]);
        const despues = new Map([['a', r(0)], ['c', r(72)]]);
        assert.deepEqual(planListChange(antes, despues), [{ clave: 'c', tipo: 'move', dy: 72 }]);
    });

    test('con demasiados cambios no se anima nada', () => {
        const antes = new Map(Array.from({ length: 30 }, (_, i) => [`k${i}`, r(i * 72)]));
        const despues = new Map([['nueva', r(0)], ...Array.from({ length: 30 }, (_, i) => [`k${i}`, r((i + 1) * 72)])]);
        assert.deepEqual(planListChange(antes, despues, { maxChanges: 20 }), []);
    });
});

describe('integración en las listas', () => {
    const app = codigoCliente();

    test('biblioteca, playlist y cola miden antes de repintar', () => {
        const veces = (app.match(/animateListChange\(/g) || []).length;
        assert.ok(veces >= 4, `solo ${veces} listas animan sus cambios`);
    });

    test('borrar una canción ya no encadena temporizadores', () => {
        const i = app.indexOf('async function removeSong(src, itemElement)');
        const cuerpo = app.slice(i, app.indexOf('const lib = await getLibrary();', i));
        assert.match(cuerpo, /collapseAndRemove\(itemElement\)/);
        assert.ok(!/setTimeout\(/.test(cuerpo), 'vuelve la cadena de setTimeout');
    });
});
