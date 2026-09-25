/**
 * Gestos (plan 09, T8 y T15).
 *
 * Un gesto mal decidido es de lo más frustrante que hay en el móvil: el
 * reproductor que se cierra cuando querías ver las letras, o que no se cierra
 * con un tirón claro. Aquí se fijan los umbrales y quién se queda con el dedo.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    rubberBand, velocityFrom, shouldDismiss, trackVerticalDrag, swipeOffset, shouldCommitSwipe,
} from '../../src/ui/motion/gesture.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

describe('rubberBand', () => {
    test('crece, pero nunca alcanza la dimensión', () => {
        let anterior = 0;
        for (const x of [1, 10, 50, 200, 1000, 100000]) {
            const r = rubberBand(x, 90);
            assert.ok(r > anterior, `no crece en ${x}`);
            assert.ok(r < 90, `superó la dimensión en ${x}`);
            anterior = r;
        }
    });

    test('cerca de 0 es casi uno a uno, con la constante de iOS', () => {
        assert.ok(Math.abs(rubberBand(1, 1000) - 0.55) < 0.01);
    });

    test('sin desplazamiento no hay resistencia', () => {
        assert.equal(rubberBand(0, 90), 0);
        assert.equal(rubberBand(-5, 90), 0);
    });
});

describe('velocityFrom', () => {
    test('px/s con las muestras recientes', () => {
        const v = velocityFrom([{ value: 0, time: 0 }, { value: 50, time: 50 }]);
        assert.equal(v, 1000);
    });

    test('ignora lo que pasó hace más de 80 ms: cuenta cómo se soltó', () => {
        const muestras = [
            { value: 0, time: 0 }, { value: 300, time: 100 },   // rápido al principio…
            { value: 305, time: 200 }, { value: 306, time: 250 }, // …y casi parado al soltar
        ];
        assert.ok(velocityFrom(muestras) < 100, 'usó el arranque rápido en vez del final');
    });

    test('sin tiempo entre muestras no divide entre cero', () => {
        assert.equal(velocityFrom([{ value: 0, time: 5 }, { value: 9, time: 5 }]), 0);
        assert.equal(velocityFrom([]), 0);
    });
});

describe('shouldDismiss', () => {
    test('el umbral de velocidad es 550 px/s', () => {
        assert.equal(shouldDismiss({ offset: 10, velocity: 551, size: 800 }), true);
        assert.equal(shouldDismiss({ offset: 10, velocity: 549, size: 800 }), false);
    });

    test('llegar al 28 % de la altura también cierra', () => {
        assert.equal(shouldDismiss({ offset: 225, velocity: 0, size: 800 }), true);
        assert.equal(shouldDismiss({ offset: 223, velocity: 0, size: 800 }), false);
    });
});

describe('trackVerticalDrag', () => {
    /** Elemento con eventos táctiles de mentira. */
    function montar(opciones) {
        const el = new EventTarget();
        const llamadas = { start: 0, move: [], end: null };
        trackVerticalDrag(el, {
            onStart: () => { llamadas.start++; },
            onMove: (dy) => llamadas.move.push(dy),
            onEnd: (r) => { llamadas.end = r; },
            ...opciones,
        });
        let t = 0;
        const toque = (tipo, x, y) => {
            const e = new Event(tipo, { cancelable: true });
            e.touches = tipo === 'touchend' ? [] : [{ clientX: x, clientY: y }];
            Object.defineProperty(e, 'timeStamp', { value: (t += 16) });
            el.dispatchEvent(e);
            return e;
        };
        return { el, llamadas, toque };
    }

    test('hacia abajo, se queda con el gesto e impide el scroll', () => {
        const { llamadas, toque } = montar();
        toque('touchstart', 100, 100);
        toque('touchmove', 100, 104);                    // dentro del margen: aún no decide
        const e = toque('touchmove', 100, 140);
        assert.equal(llamadas.start, 1);
        assert.equal(e.defaultPrevented, true, 'no impidió el scroll');
        toque('touchend');
        assert.ok(llamadas.end.offset === 40);
        assert.ok(llamadas.end.velocity > 0);
    });

    test('hacia arriba, el gesto es del scroll', () => {
        const { llamadas, toque } = montar();
        toque('touchstart', 100, 300);
        const e = toque('touchmove', 100, 250);
        assert.equal(llamadas.start, 0);
        assert.equal(e.defaultPrevented, false);
        toque('touchend');
        assert.equal(llamadas.end, null);
    });

    test('de lado, tampoco es nuestro', () => {
        const { llamadas, toque } = montar();
        toque('touchstart', 100, 100);
        toque('touchmove', 160, 110);
        assert.equal(llamadas.start, 0);
    });

    test('si no puede empezar (p. ej. viendo las letras), no hace nada', () => {
        const { llamadas, toque } = montar({ canStart: () => false });
        toque('touchstart', 100, 100);
        const e = toque('touchmove', 100, 200);
        assert.equal(llamadas.start, 0);
        assert.equal(e.defaultPrevented, false);
    });
});

describe('T15 · deslizar una fila para añadirla a la cola', () => {
    test('hasta el umbral sigue al dedo; después, con resistencia', () => {
        assert.equal(swipeOffset(-40), 0, 'hacia la izquierda no se mueve');
        assert.equal(swipeOffset(60), 60);
        assert.equal(swipeOffset(120), 120);
        const pasado = swipeOffset(220);
        assert.ok(pasado > 120 && pasado < 120 + 70, `fuera de la resistencia: ${pasado}`);
        assert.ok(swipeOffset(1000) < 190, 'nunca pasa de umbral + dimensión');
    });

    test('se añade por distancia o por un golpe rápido, no por un roce', () => {
        assert.ok(shouldCommitSwipe({ distance: 120, velocity: 0 }));
        assert.ok(!shouldCommitSwipe({ distance: 119, velocity: 0 }));
        assert.ok(shouldCommitSwipe({ distance: 60, velocity: 1200 }), 'un golpe rápido cuenta');
        assert.ok(!shouldCommitSwipe({ distance: 40, velocity: 1500 }), 'un roce rápido no cuenta');
        assert.ok(!shouldCommitSwipe({ distance: 80, velocity: 600 }));
    });

    test('funciona con cualquier puntero y deja el scroll al navegador', () => {
        const app = leer('app.js');
        const i = app.indexOf('function initSwipeEvents()');
        const cuerpo = app.slice(i, app.indexOf('initSwipeEvents();', i));
        assert.match(cuerpo, /'pointerdown'/);
        assert.match(cuerpo, /'pointercancel'/);
        assert.ok(!/touchstart/.test(cuerpo), 'sigue escuchando solo toques');
        assert.match(leer('styles.css'), /\.library-item \{[^}]*touch-action: pan-y/);
    });

    test('ni vibraciones de la web ni textos sin traducir', () => {
        const app = leer('app.js');
        assert.ok(!app.includes('navigator.vibrate'), 'navigator.vibrate es tosco y no existe en iPhone');
        assert.ok(!app.includes('<span>Siguiente</span>'));
    });
});
