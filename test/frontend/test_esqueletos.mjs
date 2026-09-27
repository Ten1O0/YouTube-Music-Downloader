/**
 * Esqueletos de carga (plan 10, T8): solo si la carga tarda, y siempre se van.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { conEsqueleto, pintarEsqueletos, RETRASO_MS } from '../../frontend/src/ui/skeleton.js';

/** DOM mínimo: lo justo para crear, anidar y quitar elementos. */
function nodo() {
    const n = {
        className: '', children: [], atributos: {}, padre: null,
        style: { setProperty(k, v) { this[k] = v; } },
        append(...hijos) { for (const h of hijos) { h.padre = n; n.children.push(h); } },
        remove() { if (n.padre) n.padre.children = n.padre.children.filter(h => h !== n); },
        setAttribute(k, v) { n.atributos[k] = v; },
        removeAttribute(k) { delete n.atributos[k]; },
    };
    return n;
}
beforeEach(() => { globalThis.document = { createElement: () => nodo() }; });
const esperar = (ms, valor) => new Promise(r => setTimeout(() => r(valor), ms));

describe('conEsqueleto', () => {
    test('una carga rápida no pinta nada', async () => {
        const lista = nodo();
        let mostrado = false;
        const r = await conEsqueleto(lista, 'fila', 6, esperar(20, 'datos'), { alMostrar: () => { mostrado = true; } });
        assert.equal(r, 'datos');
        assert.equal(lista.children.length, 0);
        assert.equal(mostrado, false);
    });

    test('una carga lenta pinta los esqueletos y los quita al terminar', async () => {
        const lista = nodo();
        const promesa = conEsqueleto(lista, 'fila', 6, esperar(RETRASO_MS + 80, 'datos'));
        await esperar(RETRASO_MS + 30);
        assert.equal(lista.children.length, 1, 'esqueletos puestos');
        assert.equal(lista.children[0].children.length, 6);
        assert.equal(lista.atributos['aria-busy'], 'true');
        assert.equal(await promesa, 'datos');
        assert.equal(lista.children.length, 0, 'esqueletos quitados');
        assert.equal(lista.atributos['aria-busy'], undefined);
    });

    test('si la carga falla, los esqueletos se van igual y el error sigue', async () => {
        const lista = nodo();
        const fallo = esperar(RETRASO_MS + 50).then(() => { throw new Error('red'); });
        await assert.rejects(conEsqueleto(lista, 'resultado', 5, fallo), /red/);
        assert.equal(lista.children.length, 0);
    });

    test('sin contenedor, devuelve la promesa tal cual', async () => {
        assert.equal(await conEsqueleto(null, 'fila', 3, Promise.resolve(7)), 7);
    });
});

describe('pintarEsqueletos', () => {
    test('cada forma lleva sus piezas', () => {
        const lista = nodo();
        const fila = pintarEsqueletos(lista, 'fila', 1).children[0];
        assert.match(fila.className, /esqueleto-fila/);
        assert.deepEqual(fila.children.map(c => c.className), ['esq-arte', 'esq-lineas']);
        const letra = pintarEsqueletos(lista, 'letra', 3);
        assert.ok(letra.children.every(l => l.style['--ancho']), 'las líneas de letra tienen largos distintos');
    });
});
