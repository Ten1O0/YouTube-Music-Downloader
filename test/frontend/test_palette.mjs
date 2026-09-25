/**
 * Colores de la carátula (plan 09, T11).
 *
 * El fondo del reproductor depende de esto. Si la base no queda oscura, el
 * texto blanco deja de leerse; si el resultado cambia entre dos llamadas, el
 * fondo parpadea al reabrir el reproductor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, luminance, darkenTo, toHex, FALLBACK } from '../../src/ui/palette.js';

/** Imagen RGBA de `n` píxeles repartidos entre varios colores. */
function imagen(colores, n = 576) {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
        const [r, g, b, a = 255] = colores[i % colores.length];
        px.set([r, g, b, a], i * 4);
    }
    return px;
}

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('extractPalette', () => {
    test('encuentra los colores que hay en la imagen', () => {
        const dorado = [230, 196, 136], verde = [111, 143, 106], negro = [20, 20, 20];
        const [c1, c2] = extractPalette(imagen([dorado, dorado, verde, negro])).map(hex);
        assert.ok(distancia(c1, dorado) < 10, `luz principal ${c1} lejos del dorado`);
        assert.ok(distancia(c2, verde) < 10, `luz secundaria ${c2} lejos del verde`);
    });

    test('la base queda lo bastante oscura para leer encima', () => {
        const claros = imagen([[250, 250, 240], [240, 200, 180], [200, 220, 250]]);
        const base = hex(extractPalette(claros)[2]);
        assert.ok(luminance(base) <= 0.081, `base con luminancia ${luminance(base)}`);
    });

    test('mismas entradas, mismos colores', () => {
        const px = imagen([[200, 30, 40], [30, 60, 200], [240, 240, 100], [10, 10, 10]]);
        assert.deepEqual(extractPalette(px), extractPalette(px));
    });

    test('una imagen transparente usa los colores de la casa', () => {
        assert.deepEqual(extractPalette(imagen([[255, 0, 0, 0]])), FALLBACK);
    });

    test('una imagen de un solo color no rompe nada', () => {
        const p = extractPalette(imagen([[120, 80, 200]]));
        assert.equal(p.length, 3);
        p.forEach(c => assert.match(c, /^#[0-9a-f]{6}$/));
    });
});

describe('utilidades de color', () => {
    test('darkenTo no toca lo que ya es oscuro', () => {
        assert.deepEqual(darkenTo([10, 10, 10]), [10, 10, 10]);
    });

    test('darkenTo conserva el tono', () => {
        const [r, g, b] = darkenTo([240, 120, 60]);
        assert.ok(r > g && g > b, 'cambió el tono al oscurecer');
    });

    test('toHex recorta fuera de rango', () => {
        assert.equal(toHex([300, -5, 127.6]), '#ff0080');
    });
});
