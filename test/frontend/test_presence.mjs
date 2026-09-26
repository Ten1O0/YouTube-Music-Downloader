/**
 * Entradas y salidas animables (plan 09, T3).
 *
 * `presence` decide cuándo una pieza deja de estar en pantalla: si se
 * equivoca, lo que queda es un modal invisible que se come los toques o uno
 * que desaparece antes de terminar de salir. Los modales, en cambio, entran y
 * salen solo con CSS, y eso también se fija aquí.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { show, hide, isShown } from '../../frontend/src/ui/motion/presence.js';
import { leer } from './fuentes.mjs';

const espera = ms => new Promise(r => setTimeout(r, ms));

/** Elemento mínimo: eventos de transición que el test dispara a mano. */
class Pieza extends EventTarget {
    constructor() { super(); this.hidden = true; this.dataset = {}; }
    get offsetWidth() { return 1; }
    transicion(ms = 5) {
        this.dispatchEvent(new Event('transitionrun'));
        setTimeout(() => this.dispatchEvent(new Event('transitionend')), ms);
    }
}

describe('presence', () => {
    test('show deja la pieza visible y en reposo', async () => {
        const el = new Pieza();
        const p = show(el);
        el.transicion();
        await p;
        assert.equal(el.hidden, false);
        assert.equal(el.dataset.presence, 'shown');
        assert.ok(isShown(el));
    });

    test('hide espera a que termine la salida para ocultar', async () => {
        const el = new Pieza();
        el.hidden = false; el.dataset.presence = 'shown';
        const p = hide(el);
        el.transicion(30);
        await espera(10);
        assert.equal(el.hidden, false, 'se ocultó antes de terminar de salir');
        assert.equal(isShown(el), false, 'mientras sale no cuenta como visible');
        await p;
        assert.equal(el.hidden, true);
        assert.equal(el.dataset.presence, undefined);
    });

    test('volver a mostrar mientras sale gana a la salida', async () => {
        const el = new Pieza();
        el.hidden = false; el.dataset.presence = 'shown';
        const saliendo = hide(el);
        el.transicion(30);
        await espera(5);
        const entrando = show(el);
        el.transicion(5);
        await Promise.all([saliendo, entrando]);
        assert.equal(el.hidden, false, 'la salida antigua ocultó la pieza que se volvió a abrir');
        assert.equal(el.dataset.presence, 'shown');
    });

    test('sin transiciones no se queda esperando', async () => {
        const el = new Pieza();
        const inicio = Date.now();
        await show(el);
        assert.ok(Date.now() - inicio < 200, 'esperó sin que hubiera nada que animar');
    });

    test('si no llega transitionend, el tiempo máximo la desbloquea', async () => {
        const el = new Pieza();
        el.hidden = false;
        const p = hide(el, { timeout: 40 });
        el.dispatchEvent(new Event('transitionrun')); // y nunca termina
        await p;
        assert.equal(el.hidden, true);
    });

    test('ocultar algo ya oculto no hace nada', async () => {
        const el = new Pieza();
        await hide(el);
        assert.equal(el.hidden, true);
        assert.equal(el.dataset.presence, undefined);
    });
});

describe('modales y hoja de la cola', () => {
    const css = leer('frontend/src/styles.css');

    test('entran con @starting-style', () => {
        const bloque = css.slice(css.indexOf('@starting-style'));
        for (const sel of ['.auth-modal:not(.hidden) .auth-modal-content', '.pq-sheet:not(.hidden) .pq-panel']) {
            assert.ok(bloque.includes(sel), `sin pose de entrada para ${sel}`);
        }
    });

    test('salen manteniendo el display vivo mientras dura la transición', () => {
        assert.match(css, /\.auth-modal,\s*\.pq-sheet\s*\{\s*transition:\s*display[^;]*allow-discrete/,
            'sin allow-discrete, el modal desaparece de golpe al cerrarse');
        assert.match(css, /\.auth-modal\.hidden\s+\.auth-modal-content\s*\{[^}]*opacity:\s*0/);
    });

    test('mientras salen no reciben toques', () => {
        assert.match(css, /\.auth-modal\.hidden,\s*\.pq-sheet\.hidden\s*\{[^}]*pointer-events:\s*none/);
    });

    test('ya no usan las animaciones de entrada antiguas', () => {
        assert.ok(!/animation:\s*(scaleIn|slideUp)\b/.test(css), 'vuelve a haber una animación solo de entrada');
    });
});
