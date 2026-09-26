/**
 * El vuelo de la carátula (plan 09, T7).
 *
 * La geometría FLIP es fácil de equivocar por un signo o un eje: el clon
 * saldría disparado desde la esquina contraria, o las esquinas redondeadas se
 * estirarían al escalar. Y darle la vuelta a mitad tiene que acabar donde se
 * pidió, no donde se empezó.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { flightPose, fly } from '../../frontend/src/ui/motion/flight.js';
import { scheduler } from '../../frontend/src/ui/motion/spring.js';
import {  } from './fuentes.mjs';

const cerca = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('flightPose', () => {
    const mini = { left: 20, top: 700, width: 44, height: 44 };
    const grande = { left: 40, top: 150, width: 310, height: 310 };

    test('en p = 0 el clon ocupa exactamente la miniatura', () => {
        const q = flightPose(mini, grande, 0, 8, 12);
        assert.ok(cerca(q.tx, -20) && cerca(q.ty, 550), 'no parte de la miniatura');
        assert.ok(cerca(q.sx, 44 / 310) && cerca(q.sy, 44 / 310));
    });

    test('en p = 1 es la identidad: el clon está en su sitio y a su tamaño', () => {
        const q = flightPose(mini, grande, 1, 8, 12);
        assert.ok(cerca(q.tx, 0) && cerca(q.ty, 0) && cerca(q.sx, 1) && cerca(q.sy, 1));
        assert.ok(cerca(q.rx, 12) && cerca(q.ry, 12));
    });

    test('el radio se compensa con la escala para que las esquinas no se estiren', () => {
        const q = flightPose(mini, grande, 0, 8, 12);
        // A escala 44/310 el radio visible debe seguir siendo 8 px
        assert.ok(cerca(q.rx * q.sx, 8) && cerca(q.ry * q.sy, 8));
    });

    test('con formas distintas, cada eje se compensa por separado', () => {
        const ancho = { left: 0, top: 0, width: 100, height: 50 };
        const q = flightPose(ancho, grande, 0, 10, 10);
        assert.ok(cerca(q.rx * q.sx, 10) && cerca(q.ry * q.sy, 10));
        assert.notEqual(q.sx, q.sy);
    });
});

describe('fly', () => {
    let reloj;

    before(() => {
        // Un documento mínimo: el vuelo solo crea y quita el clon
        const hijos = new Set();
        globalThis.document = {
            createElement: () => ({
                style: {}, setAttribute() {},
                remove() { hijos.delete(this); },
            }),
            body: { appendChild: (el) => hijos.add(el) },
            __hijos: hijos,
        };
        let ahora = 0, sig = 1; const cola = new Map();
        Object.assign(scheduler, {
            now: () => ahora,
            request: (cb) => { const id = sig++; cola.set(id, cb); return id; },
            cancel: (id) => cola.delete(id),
            slow: 1,
        });
        reloj = (ms) => {
            const fin = ahora + ms;
            while (ahora < fin && cola.size) {
                ahora = Math.min(fin, ahora + 1000 / 60);
                const p = [...cola.values()]; cola.clear(); p.forEach(cb => cb(ahora));
            }
        };
    });

    const rect = r => ({ getBoundingClientRect: () => r });
    const origen = rect({ left: 20, top: 700, width: 44, height: 44 });
    const destino = rect({ left: 40, top: 150, width: 310, height: 310 });

    test('llega, informa del progreso y retira el clon', async () => {
        const vistos = [];
        const v = fly({ source: origen, target: destino, image: 'a.jpg', onProgress: p => vistos.push(p) });
        assert.equal(document.__hijos.size, 1, 'no creó el clon');
        reloj(1500);
        assert.equal(await v.done, 1);
        assert.equal(document.__hijos.size, 0, 'el clon se quedó en pantalla');
        assert.equal(vistos[0], 0);
        assert.equal(vistos.at(-1), 1);
    });

    test('dar la vuelta a mitad termina donde se pidió', async () => {
        const v = fly({ source: origen, target: destino, image: 'a.jpg', from: 0, to: 1 });
        reloj(150);
        const aMitad = v.progress;
        assert.ok(aMitad > 0 && aMitad < 1);
        v.retarget(0);
        assert.equal(v.heading, 0);
        reloj(1500);
        assert.equal(await v.done, 0, 'terminó abierto aunque se pidió cerrar');
        assert.equal(document.__hijos.size, 0);
    });
});
