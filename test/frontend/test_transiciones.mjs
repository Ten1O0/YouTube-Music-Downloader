/**
 * Cuándo y cómo se pasa de una canción a otra (plan 12, T3): precarga, arranque
 * sin cortes, fundido de igual potencia y los casos en que no hay transición.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    curvaIgualPotencia, fundidoEfectivo, planDeTransicion, FUNDIDOS, LATENCIA_ARRANQUE, PRECARGA, VENTANA_SIN_CORTES,
} from '../../frontend/src/features/player/crossfade.js';

const plan = (actual, extra = {}) => planDeTransicion({ duracion: 200, actual, fundido: 0, ...extra });

describe('curvaIgualPotencia', () => {
    test('las potencias suman 1 en todo el cruce', () => {
        for (let x = 0; x <= 1.0001; x += 0.05) {
            const { sale, entra } = curvaIgualPotencia(x);
            assert.ok(Math.abs(sale ** 2 + entra ** 2 - 1) < 1e-9, `x=${x}`);
        }
    });

    test('empieza en la que sale y acaba en la que entra; fuera de 0-1 se recorta', () => {
        assert.deepEqual(curvaIgualPotencia(0), { sale: 1, entra: 0 });
        const fin = curvaIgualPotencia(1);
        assert.ok(fin.sale < 1e-12 && fin.entra === 1);
        assert.deepEqual(curvaIgualPotencia(-3), curvaIgualPotencia(0));
        assert.deepEqual(curvaIgualPotencia(7), curvaIgualPotencia(1));
    });

    test('a mitad no se hunde: cada una a ~0,707 (−3 dB), no a 0,5', () => {
        const { sale, entra } = curvaIgualPotencia(0.5);
        assert.ok(Math.abs(sale - Math.SQRT1_2) < 1e-9 && Math.abs(entra - Math.SQRT1_2) < 1e-9);
    });
});

describe('fundidoEfectivo', () => {
    test('sin fundido o sin duración, 0', () => {
        assert.equal(fundidoEfectivo(0, 200), 0);
        assert.equal(fundidoEfectivo(6, NaN), 0);
        assert.equal(fundidoEfectivo(6, 0), 0);
    });
    test('en una canción corta, como mucho un tercio', () => {
        assert.equal(fundidoEfectivo(12, 200), 12);
        assert.equal(fundidoEfectivo(12, 9), 3);
    });
});

describe('sin cortes', () => {
    test(`precarga cuando quedan ${PRECARGA} s, no antes`, () => {
        assert.equal(plan(200 - PRECARGA - 0.1).precargar, false);
        assert.equal(plan(200 - PRECARGA).precargar, true);
    });

    test(`arranca al acabar: se programa cuando quedan menos de ${VENTANA_SIN_CORTES} s`, () => {
        assert.equal(plan(200 - VENTANA_SIN_CORTES - 0.01).arrancarEn, null);
        const p = plan(199.7);
        assert.ok(Math.abs(p.arrancarEn - (0.3 - LATENCIA_ARRANQUE)) < 1e-9);
        assert.equal(p.cruce, null, 'sin cortes no hay fundido');
        assert.equal(p.cambiar, true);
    });

    test('ya acabada: arrancar ya', () => {
        assert.equal(plan(200).arrancarEn, 0);
        assert.equal(plan(205).arrancarEn, 0);
    });
});

describe('fundido', () => {
    test('arranca cuando quedan N s, a volumen 0', () => {
        assert.equal(plan(200 - 6.1, { fundido: 6 }).arrancarEn, null);
        const p = plan(194, { fundido: 6 });
        assert.equal(p.arrancarEn, 0);
        assert.equal(p.cruce, 0);
        assert.equal(p.cambiar, false);
    });

    test('a mitad del cruce la siguiente pasa a ser la actual', () => {
        assert.equal(plan(196.9, { fundido: 6 }).cambiar, false);
        assert.equal(plan(197, { fundido: 6 }).cambiar, true);
        assert.ok(Math.abs(plan(197, { fundido: 6 }).cruce - 0.5) < 1e-9);
    });

    test('la precarga llega antes que el fundido más largo', () => {
        for (const n of FUNDIDOS) assert.ok(plan(200 - n - 1, { fundido: n }).precargar, `fundido ${n}`);
    });

    test('a 4 timeupdate por segundo, un fundido de 2 s tiene al menos 8 pasos', () => {
        const pasos = new Set();
        for (let t = 198; t <= 200; t += 0.25) {
            const p = plan(t, { fundido: 2 });
            if (p.cruce !== null) pasos.add(p.cruce.toFixed(3));
        }
        assert.ok(pasos.size >= 8, `${pasos.size} pasos`);
    });
});

describe('sin transición', () => {
    test('con «Repetir una» (o en bucle) no hay nada', () => {
        assert.deepEqual(plan(199.9, { repetir: true }), { precargar: false, arrancarEn: null, cruce: null, cambiar: false });
        assert.equal(plan(195, { repetir: true, fundido: 6 }).cruce, null);
    });

    test('sin siguiente (última de la cola) no hay nada', () => {
        assert.equal(plan(199.9, { haySiguiente: false }).arrancarEn, null);
        assert.equal(plan(199.9, { haySiguiente: false }).precargar, false);
    });

    test('sin duración conocida (directo, cargando) no hay nada', () => {
        for (const duracion of [NaN, Infinity, 0]) {
            assert.equal(planDeTransicion({ duracion, actual: 1, fundido: 6 }).precargar, false);
        }
    });
});

test('los fundidos que ofrece la hoja: sin cortes y de 2 a 12 s', () => {
    assert.deepEqual(FUNDIDOS, [0, 2, 4, 6, 8, 12]);
});
