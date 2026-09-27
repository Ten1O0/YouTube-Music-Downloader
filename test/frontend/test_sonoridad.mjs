/**
 * Sonoridad (plan 12, T5 y T6): la medida según BS.1770 con los tonos de
 * referencia de EBU Tech 3341, las compuertas y el volumen con el que suena
 * cada canción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    coeficientesFiltroK, gananciaSonoridad, medidaSonoridad, OBJETIVO_LUFS, siguienteSinMedir, sonoridad, volumenEfectivo,
} from '../../frontend/src/core/loudness.js';

/** Seno de `hz` con pico `dbfs`, durante `seg` segundos. */
function seno(hz, dbfs, seg, fs) {
    const n = Math.round(fs * seg);
    const a = 10 ** (dbfs / 20);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = a * Math.sin(2 * Math.PI * hz * i / fs);
    return s;
}
const juntar = (...partes) => {
    const total = new Float32Array(partes.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of partes) { total.set(p, o); o += p.length; }
    return total;
};
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

describe('filtro K', () => {
    test('a 48 kHz, los coeficientes de la tabla de BS.1770', () => {
        const [e, h] = coeficientesFiltroK(48000);
        const tabla = [[e.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]], [e.a, [-1.69065929318241, 0.73248077421585]],
            [h.b, [1, -2, 1]], [h.a, [-1.99004745483398, 0.99007225036621]]];
        for (const [calc, ref] of tabla) calc.forEach((v, i) => cerca(v, ref[i], 1e-8));
    });
});

describe('EBU Tech 3341', () => {
    for (const fs of [48000, 22050]) {
        test(`1 kHz a −23 dBFS en estéreo da −23 LUFS (${fs} Hz)`, () => {
            const s = seno(1000, -23, 20, fs);
            cerca(sonoridad([s, s], fs).lufs, -23, 0.1);
        });

        test(`también medido en mono con la compensación (${fs} Hz)`, () => {
            cerca(sonoridad(seno(1000, -23, 20, fs), fs, { canalesOriginales: 2 }).lufs, -23, 0.1);
        });
    }

    test('un solo canal a −23 dBFS da 3 dB menos que los dos', () => {
        cerca(sonoridad(seno(1000, -23, 20, 48000), 48000).lufs, -26.01, 0.1);
    });

    test('−33 dBFS da −33 LUFS: la escala es lineal en dB', () => {
        const s = seno(1000, -33, 20, 48000);
        cerca(sonoridad([s, s], 48000).lufs, -33, 0.1);
    });

    test('caso 3 de 3341: −36/−23/−36 dBFS (10/60/10 s) da −23 LUFS por la compuerta relativa', () => {
        const fs = 22050;
        const s = juntar(seno(1000, -36, 10, fs), seno(1000, -23, 60, fs), seno(1000, -36, 10, fs));
        cerca(sonoridad([s, s], fs).lufs, -23, 0.1);
    });

    test('caso 5: −26/−20/−26 dBFS (20/20,1/20 s) da −23 LUFS', () => {
        const fs = 22050;
        const s = juntar(seno(1000, -26, 20, fs), seno(1000, -20, 20.1, fs), seno(1000, -26, 20, fs));
        cerca(sonoridad([s, s], fs).lufs, -23, 0.1);
    });
});

describe('compuertas y bordes', () => {
    test('el silencio no tiene sonoridad', () => {
        assert.equal(sonoridad(new Float32Array(22050 * 5), 22050), null);
    });

    test('el silencio alrededor no cuenta (compuerta absoluta de −70)', () => {
        const fs = 22050;
        const tono = seno(1000, -23, 10, fs);
        const conSilencio = juntar(new Float32Array(fs * 30), tono, new Float32Array(fs * 30));
        // Treinta segundos de silencio a cada lado no mueven la medida. Solo los
        // bloques de 400 ms que pisan tono y silencio a la vez (−26 a −29 LUFS)
        // pasan la compuerta relativa, como manda la norma: unas décimas
        cerca(sonoridad([conSilencio, conSilencio], fs).lufs, sonoridad([tono, tono], fs).lufs, 0.2);
    });

    test('menos de 400 ms o sin datos: null', () => {
        assert.equal(sonoridad(seno(1000, -23, 0.3, 22050), 22050), null);
        assert.equal(sonoridad(new Float32Array(0), 22050), null);
        assert.equal(sonoridad([], 22050), null);
        assert.equal(sonoridad(seno(1000, -23, 1, 22050), 0), null);
    });

    test('el pico es el de muestra, en dBFS', () => {
        cerca(sonoridad(seno(1000, -6, 2, 48000), 48000).pico, -6, 0.05);
    });
});

describe('ganancia y volumen', () => {
    test('atenúa lo que suena por encima del objetivo', () => {
        cerca(gananciaSonoridad({ lufs: -6 }), 10 ** ((OBJETIVO_LUFS + 6) / 20), 1e-12);
        cerca(gananciaSonoridad({ lufs: -6 }), 0.316, 0.001);
    });

    test('nunca sube: lo flojo suena como es', () => {
        assert.equal(gananciaSonoridad({ lufs: -30 }), 1);
        assert.equal(gananciaSonoridad({ lufs: OBJETIVO_LUFS }), 1);
    });

    test('sin medida, o con una medida rota, ganancia 1', () => {
        for (const m of [undefined, null, {}, { lufs: 'x' }, { lufs: NaN }, { lufs: Infinity }]) assert.equal(gananciaSonoridad(m), 1);
    });

    test('el pico no interviene: sin subir, no se puede pasar de −1 dBTP', () => {
        assert.equal(gananciaSonoridad({ lufs: -20, pico: 0 }), 1);
    });

    test('volumenEfectivo: usuario × ganancia × fundido, entre 0 y 1', () => {
        cerca(volumenEfectivo({ usuario: 0.5, ganancia: 0.5, cruce: 0.5 }), 0.125, 1e-12);
        assert.equal(volumenEfectivo(), 1);
        assert.equal(volumenEfectivo({ usuario: 2 }), 1);
        assert.equal(volumenEfectivo({ usuario: -1 }), 0);
        assert.equal(volumenEfectivo({ ganancia: NaN }), 0);
    });
});

describe('medidaSonoridad', () => {
    test('valida y etiqueta la fuente', () => {
        assert.deepEqual(medidaSonoridad({ lufs: -9.4, pico: -0.2 }, 'servidor'), { lufs: -9.4, pico: -0.2, fuente: 'servidor' });
        assert.deepEqual(medidaSonoridad({ lufs: -9.4 }, 'cliente'), { lufs: -9.4, fuente: 'cliente' });
    });

    test('lo que venga raro no se usa', () => {
        for (const m of [null, {}, { lufs: '-9' }, { lufs: -200 }, { lufs: 50 }, { lufs: NaN }]) assert.equal(medidaSonoridad(m, 'servidor'), null);
        assert.deepEqual(medidaSonoridad({ lufs: -9, pico: 'x' }, 'servidor'), { lufs: -9, fuente: 'servidor' });
    });
});

describe('siguienteSinMedir', () => {
    test('la primera sin medida, con audio y sin agotar sus intentos', () => {
        const bib = [
            { src: 'a', loudness: { lufs: -9 } },
            { src: 'b', unavailable: true },
            { src: 'c' },
            { src: 'd' },
        ];
        assert.equal(siguienteSinMedir(bib).src, 'c');
        assert.equal(siguienteSinMedir(bib, { c: 2 }).src, 'd');
        assert.equal(siguienteSinMedir(bib, { c: 2, d: 5 }), null);
        assert.equal(siguienteSinMedir([], {}), null);
        assert.equal(siguienteSinMedir(undefined, undefined), null);
    });
});
