/**
 * La vuelta de una hoja soltada a medio arrastrar (plan 28, T5): en el
 * compositor con la misma curva del muelle, agarrable a mitad, que se quita al
 * cerrar la hoja, y con el muelle de siempre sin Web Animations o con
 * «Reducir movimiento».
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { volverHoja } from '../../frontend/src/ui/hoja-vuelta.js';
import { curvaDesde } from '../../frontend/src/ui/motion/curva.js';
import { leer } from './fuentes.mjs';

/** Un panel con un animate() de mentira: guarda los fotogramas y se termina o se cancela a mano. */
function panelFalso() {
    const panel = { animaciones: [] };
    panel.animate = (fotogramas, opciones) => {
        let ok, ko;
        const a = {
            fotogramas, opciones, currentTime: 0, canceladas: 0,
            finished: new Promise((r, j) => { ok = r; ko = j; }),
            terminar: () => ok(),
            cancel: () => { a.canceladas++; ko(new Error('AbortError')); },
        };
        panel.animaciones.push(a);
        return a;
    };
    return panel;
}

/** El muelle de la hoja: lo que se le pide, en orden. */
function muelleFalso(value) {
    const llamadas = [];
    return {
        llamadas, value,
        jump(v) { llamadas.push(['jump', v]); this.value = v; },
        to(v, o) { llamadas.push(['to', v, o]); this.value = v; return Promise.resolve(); },
    };
}

const y = (fotograma) => Number(/translateY\((-?[\d.e-]+)px\)/.exec(fotograma.transform)[1]);
const espera = () => new Promise((r) => setTimeout(r, 0));

describe('volverHoja', () => {
    afterEach(() => { delete globalThis.matchMedia; });

    test('en el compositor: la curva del muelle ágil desde donde se soltó hasta su sitio, y al llegar el muelle queda en 0', async () => {
        const panel = panelFalso(), muelle = muelleFalso(120), vueltas = new Map();
        const llega = volverHoja({ modal: 'm', panel, muelle, velocidad: -300, vueltas });
        const [a] = panel.animaciones;
        assert.equal(a.opciones.easing, 'linear');
        const esperada = curvaDesde({ desde: 120, hasta: 0, velocidad: -300, preset: 'snappy', precision: 0.5 });
        assert.deepEqual(a.fotogramas.map(y), esperada.valores, 'un fotograma por cada valor del muelle');
        assert.ok(vueltas.has('m'));
        a.terminar();
        assert.equal(await llega, true);
        assert.deepEqual(muelle.llamadas, [['jump', 0]]);
        assert.equal(a.canceladas, 1, 'se quita al llegar: el muelle ya está en 0');
        assert.equal(vueltas.has('m'), false);
    });

    test('agarrada a mitad: el muelle sigue desde donde iba y la vuelta se quita', async () => {
        const panel = panelFalso(), muelle = muelleFalso(120), vueltas = new Map();
        const llega = volverHoja({ modal: 'm', panel, muelle, velocidad: 0, vueltas });
        panel.animaciones[0].currentTime = 50;
        vueltas.get('m').agarrar();
        assert.equal(await llega, false);
        const [[que, donde]] = muelle.llamadas;
        assert.equal(que, 'jump');
        assert.ok(donde > 0 && donde < 120, `a mitad: ${donde}`);
        assert.equal(vueltas.has('m'), false);
    });

    test('cerrada durante la vuelta: se quita sin tocar el muelle', async () => {
        const panel = panelFalso(), muelle = muelleFalso(80), vueltas = new Map();
        const llega = volverHoja({ modal: 'm', panel, muelle, velocidad: 0, vueltas });
        vueltas.get('m').quitar();
        assert.equal(await llega, false);
        assert.deepEqual(muelle.llamadas, []);
    });

    test('sin Web Animations, el muelle de siempre', async () => {
        const muelle = muelleFalso(60);
        assert.equal(await volverHoja({ modal: 'm', panel: {}, muelle, velocidad: -100, vueltas: new Map() }), true);
        assert.deepEqual(muelle.llamadas, [['to', 0, { velocity: -100 }]]);
    });

    test('con «Reducir movimiento», el muelle (que salta a su sitio)', async () => {
        globalThis.matchMedia = () => ({ matches: true });
        const panel = panelFalso(), muelle = muelleFalso(60);
        await volverHoja({ modal: 'm', panel, muelle, velocidad: 0, vueltas: new Map() });
        assert.equal(panel.animaciones.length, 0);
        assert.deepEqual(muelle.llamadas.map(([q]) => q), ['to']);
        await espera();
    });
});

describe('sheets.js', () => {
    const fuente = leer('frontend/src/ui/sheets.js');

    test('la vuelta se carga aparte (el arranque no tiene sitio)', () => {
        assert.match(fuente, /import\('\.\/hoja-vuelta\.js'\)/);
        assert.doesNotMatch(fuente, /^import .*hoja-vuelta/m);
        assert.doesNotMatch(fuente, /^import .*motion\/curva/m);
    });

    test('la curva es la del muelle de la hoja: ágil y con la misma precisión', () => {
        assert.match(fuente, /new Spring\(\{\s*preset: 'snappy', precision: 0\.5,/);
        assert.match(leer('frontend/src/ui/hoja-vuelta.js'), /preset: 'snappy', precision: 0\.5/);
    });
});
