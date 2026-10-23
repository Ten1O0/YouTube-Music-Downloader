/**
 * Filas que entran, salen y se recolocan (plan 09, T14).
 *
 * Lo que se fija aquí es la decisión: qué fila es nueva, cuál se ha movido y
 * cuánto, y cuándo son demasiados cambios para animar. Si se equivoca, una
 * lista larga se pone a bailar entera al añadir una canción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { anclarScroll, planListChange } from '../../frontend/src/ui/motion/list.js';
import { codigoCliente, leer } from './fuentes.mjs';

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

describe('planListChange con filas lejos de la pantalla (plan 19, T7)', () => {
    const r = (top) => ({ top });
    test('una fila lejos de la pantalla (null) no se anima, ni antes ni después', () => {
        const antes = new Map([['a', r(0)], ['b', null]]);
        const despues = new Map([['a', r(64)], ['b', r(0)], ['c', null]]);
        // b estaba (lejos): no «entra»; c es nueva pero lejos: tampoco
        assert.deepEqual(planListChange(antes, despues), [{ clave: 'a', tipo: 'move', dy: -64 }]);
    });

    test('lo que se ve se anima igual que antes', () => {
        const antes = new Map([['a', r(0)], ['b', r(72)]]);
        const despues = new Map([['n', r(0)], ['a', r(72)], ['b', r(144)]]);
        assert.deepEqual(planListChange(antes, despues), [
            { clave: 'n', tipo: 'enter' },
            { clave: 'a', tipo: 'move', dy: -72 },
            { clave: 'b', tipo: 'move', dy: -72 },
        ]);
    });
});

// La biblioteca, repintada entera mientras se mira (APK 2.1.0: el scroll iba a
// saltos). Filas de 72 px, la zona que se desplaza empieza en 100 px de pantalla
describe('anclarScroll', () => {
    const ALTO = 72;
    function lista(claves, scrollTop) {
        const scroller = { scrollTop, getBoundingClientRect: () => ({ top: 100 }) };
        const lista = {
            claves,
            closest: (sel) => (sel === '.main-content' ? scroller : null),
            querySelectorAll: () => lista.claves.map((clave, i) => ({
                clave,
                getBoundingClientRect: () => ({ top: 100 + i * ALTO - scroller.scrollTop, bottom: 100 + (i + 1) * ALTO - scroller.scrollTop }),
            })),
        };
        return { lista, scroller };
    }
    const claveDe = (el) => el.clave;

    test('si se va una fila de arriba, la que se veía se queda en su sitio', () => {
        const { lista: l, scroller } = lista(['a', 'b', 'c', 'd', 'e', 'f'], 3 * ALTO);
        const recolocar = anclarScroll(l, '.fila', claveDe);
        l.claves = ['b', 'c', 'd', 'e', 'f'];
        recolocar();
        assert.equal(scroller.scrollTop, 2 * ALTO);
    });

    test('si se va justo la que se veía, la de encima no se mueve y las de debajo suben a su sitio', () => {
        const { lista: l, scroller } = lista(['a', 'b', 'c', 'd', 'e', 'f'], 3 * ALTO);
        const recolocar = anclarScroll(l, '.fila', claveDe);
        l.claves = ['a', 'b', 'c', 'e', 'f'];
        recolocar();
        assert.equal(scroller.scrollTop, 3 * ALTO);
    });

    test('si se van varias de las que se veían, igual: lo de encima no se mueve', () => {
        const { lista: l, scroller } = lista(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 3 * ALTO);
        const recolocar = anclarScroll(l, '.fila', claveDe);
        l.claves = ['a', 'b', 'c', 'g'];
        recolocar();
        assert.equal(scroller.scrollTop, 3 * ALTO);
    });

    test('arriba del todo no se toca nada', () => {
        const { lista: l, scroller } = lista(['a', 'b', 'c'], 0);
        const recolocar = anclarScroll(l, '.fila', claveDe);
        l.claves = ['n', 'a', 'b', 'c'];
        recolocar();
        assert.equal(scroller.scrollTop, 0);
    });

    test('una lista abierta se ancla al repintar, y lo que llega en segundo plano la repinta con turno (tras la 2.2.0)', () => {
        const listas = leer('frontend/src/features/playlists/playlists.js');
        assert.match(listas, /anclarScroll\(list, '\.library-item'/);
        assert.ok(listas.indexOf('recolocar();') > listas.indexOf("list.innerHTML = vista.map("));
        assert.match(listas, /function repintarAbiertaConTurno\(\) \{\n\s+repintePendiente \?\?= esperarTurno\(PRIORIDAD\.baja\)/);
        assert.match(leer('frontend/src/features/library/library.js'), /PlaylistModule\.repintarAbiertaConTurno\(\)/);
        const sync = leer('frontend/src/features/sync/sync.js');
        assert.match(sync, /PlaylistModule\.repintarAbiertaConTurno\(\)/);
        assert.doesNotMatch(sync, /openPlaylistDetail\(/, 'la sincronización no vuelve a abrir la lista');
    });

    test('la biblioteca se ancla al repintar entera', () => {
        const fuente = leer('frontend/src/features/library/library.js');
        assert.match(fuente, /anclarScroll\(list, '\.library-item'/);
        assert.ok(fuente.indexOf('recolocar();') > fuente.indexOf("insertAdjacentHTML('beforeend', filas)"));
    });

    test('lo que repara el buscador de ids se pinta con turno, y fila a fila si no se unió ninguna', () => {
        const fuente = leer('frontend/src/features/sync/sync.js');
        const reparar = fuente.slice(fuente.indexOf('async function repararIdentidades'), fuente.indexOf('async function buscarIdsPendientes'));
        assert.ok(reparar.indexOf('esperarTurno') > 0 && reparar.indexOf('esperarTurno') < reparar.indexOf('LibraryModule.render'));
        assert.match(reparar, /LibraryModule\.renderFila\(src\)/);
    });
});
