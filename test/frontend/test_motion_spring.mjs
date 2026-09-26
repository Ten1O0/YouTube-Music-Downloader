/**
 * Motor y tokens de muelles (plan 09, T2).
 *
 * Los muelles son la base de todo el movimiento de la app: si su física se
 * desvía, cada animación cambia a la vez sin que nadie haya tocado una línea
 * de CSS. Y los tokens de styles.css tienen que ser exactamente los que genera
 * esta física, o una transición CSS y un gesto dejan de sentirse iguales.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SPRINGS, physics, springToLinear, springTiming, Spring, scheduler } from '../../frontend/src/ui/motion/spring.js';
import { springsBlock } from '../../scripts/generate-springs.mjs';
import { leer } from './fuentes.mjs';


/** Planificador manual: los fotogramas avanzan cuando el test lo dice. */
function relojManual() {
    let ahora = 0, siguiente = 1;
    const cola = new Map();
    Object.assign(scheduler, {
        now: () => ahora,
        request: (cb) => { const id = siguiente++; cola.set(id, cb); return id; },
        cancel: (id) => cola.delete(id),
        slow: 1,
    });
    return {
        /** Avanza `ms` en fotogramas de 1/60 s. */
        avanzar(ms) {
            const fin = ahora + ms;
            while (ahora < fin && cola.size) {
                ahora = Math.min(fin, ahora + 1000 / 60);
                const pendientes = [...cola.entries()];
                cola.clear();
                pendientes.forEach(([, cb]) => cb(ahora));
            }
            ahora = fin;
        },
        get activos() { return cola.size; },
    };
}

/** Recorrido completo de 0 a 1 con el propio motor. */
function recorrido(preset) {
    const reloj = relojManual();
    const valores = [];
    const s = new Spring({ value: 0, preset, onUpdate: v => valores.push(v), precision: 0.0005 });
    s.to(1);
    let t = 0;
    while (reloj.activos && t < 3000) { reloj.avanzar(1000 / 60); t += 1000 / 60; }
    return { valores, ms: t };
}

describe('física', () => {
    test('rigidez y amortiguación coinciden con la tabla del plan', () => {
        const esperado = { smooth: [195.0, 27.93], snappy: [438.6, 35.60], bouncy: [157.9, 17.09] };
        for (const [nombre, [k, c]] of Object.entries(esperado)) {
            const f = physics(SPRINGS[nombre]);
            assert.ok(Math.abs(f.stiffness - k) < 0.1, `${nombre}: rigidez ${f.stiffness}`);
            assert.ok(Math.abs(f.damping - c) < 0.01, `${nombre}: amortiguación ${f.damping}`);
        }
    });

    test('el suave no rebota, el ágil apenas y el vivo sí', () => {
        const sobrepaso = n => Math.max(...recorrido(n).valores) - 1;
        assert.ok(sobrepaso('smooth') < 0.002, 'el suave rebota');
        assert.ok(sobrepaso('snappy') > 0 && sobrepaso('snappy') < 0.012, `ágil: ${sobrepaso('snappy')}`);
        assert.ok(sobrepaso('bouncy') > 0.04 && sobrepaso('bouncy') < 0.065, `vivo: ${sobrepaso('bouncy')}`);
    });
});

describe('curvas linear()', () => {
    test('empiezan en 0, terminan en 1 y se asientan en su tiempo', () => {
        const esperado = { smooth: 683, snappy: 433, bouncy: 833 };
        for (const [nombre, ms] of Object.entries(esperado)) {
            const { easing, durationMs } = springToLinear(nombre);
            const puntos = easing.slice(7, -1).split(',').map(Number);
            assert.equal(puntos[0], 0);
            assert.equal(puntos.at(-1), 1);
            assert.ok(Math.abs(durationMs - ms) <= 17, `${nombre}: ${durationMs} ms`);
        }
    });

    test('la del muelle suave no retrocede nunca', () => {
        const puntos = springToLinear('smooth').easing.slice(7, -1).split(',').map(Number);
        for (let i = 1; i < puntos.length; i++) assert.ok(puntos[i] >= puntos[i - 1], `retrocede en ${i}`);
    });

    test('los tokens de styles.css son exactamente los que da la física', () => {
        // Si alguien retoca una curva a mano, el CSS y los gestos dejan de
        // sentirse iguales. Se regeneran con `npm run springs`.
        const css = leer('frontend/src/styles.css');
        const inicio = css.indexOf('/* springs:begin');
        const fin = css.indexOf('/* springs:end */') + '/* springs:end */'.length;
        assert.ok(inicio > 0 && fin > inicio, 'faltan los marcadores springs:begin / springs:end');
        assert.equal(css.slice(inicio, fin), springsBlock(), 'tokens desactualizados: ejecuta npm run springs');
    });
});

describe('Spring', () => {
    let reloj;
    beforeEach(() => { reloj = relojManual(); });

    test('llega al destino y resuelve la promesa', async () => {
        let ultimo;
        const s = new Spring({ value: 0, onUpdate: v => { ultimo = v; } });
        const p = s.to(100);
        reloj.avanzar(1500);
        await p;
        assert.equal(ultimo, 100);
        assert.equal(s.animating, false);
    });

    test('redirigir a mitad conserva la velocidad', () => {
        const s = new Spring({ value: 0, preset: 'smooth' });
        s.to(100);
        reloj.avanzar(120);
        const velocidad = s.velocity;
        assert.ok(velocidad > 0, 'debería ir lanzado hacia 100');
        s.to(0);
        // Justo después de cambiar de destino sigue moviéndose hacia arriba:
        // un muelle no se para en seco.
        const antes = s.value;
        reloj.avanzar(1000 / 60);
        assert.ok(s.value > antes, 'se paró en seco al cambiar de destino');
    });

    test('la velocidad inicial se respeta', () => {
        const s = new Spring({ value: 0, preset: 'snappy' });
        s.to(0, { velocity: 1000 });
        reloj.avanzar(1000 / 60);
        assert.ok(s.value > 5, 'no salió disparado con la velocidad dada');
    });

    test('jump coloca sin animar y resuelve lo pendiente', async () => {
        const s = new Spring({ value: 0 });
        const p = s.to(50);
        s.jump(10);
        await p;
        assert.equal(s.value, 10);
        assert.equal(s.animating, false);
    });

    test('stop lo deja donde está, sin velocidad', () => {
        const s = new Spring({ value: 0 });
        s.to(100);
        reloj.avanzar(100);
        const donde = s.value;
        s.stop();
        reloj.avanzar(500);
        assert.equal(s.value, donde);
        assert.equal(s.velocity, 0);
    });

    test('con «Reducir movimiento» salta al destino en el acto', async () => {
        const original = globalThis.matchMedia;
        globalThis.matchMedia = () => ({ matches: true });
        try {
            const s = new Spring({ value: 0 });
            await s.to(42);
            assert.equal(s.value, 42);
        } finally {
            globalThis.matchMedia = original;
        }
    });

    test('un muelle desconocido es un error, no un movimiento raro', () => {
        assert.throws(() => new Spring({ preset: 'elastico' }), /desconocido/);
    });
});

describe('springTiming', () => {
    test('fuera del navegador, la curva y la duración salen de la propia física', () => {
        assert.deepEqual(springTiming('snappy'), springToLinear('snappy'));
        assert.equal(springTiming('snappy').durationMs, 433);
    });
});
