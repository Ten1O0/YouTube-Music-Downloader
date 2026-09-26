/**
 * Forma y tipografía (plan 09, T22).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codigoCliente, leer } from './fuentes.mjs';

const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('escala de radios', () => {
    test('seis valores, de 6 a completo', () => {
        for (const [t, v] of [['xs', '6px'], ['sm', '10px'], ['md', '14px'], ['lg', '20px'], ['xl', '28px'], ['full', '999px']]) {
            assert.match(CSS, new RegExp(`--radius-${t}:\\s*${v}`));
        }
    });

    test('no quedan radios sueltos: solo la escala, círculos y herencia', () => {
        const sueltos = [...CSS.matchAll(/border-radius:\s*([^;]+);/g)]
            .map(m => m[1].replace('!important', '').trim())
            .filter(v => !/^(var\(--radius-\w+\)( var\(--radius-\w+\)| 0)*|50%|inherit)$/.test(v));
        // La única excepción: la bandera de 12 px del selector de idioma
        assert.deepEqual(sueltos, ['2px']);
    });

    test('las pistas de progreso y volumen son píldoras', () => {
        for (const sel of ['.progress-bar', '.player-volume-slider-wrapper', '.full-player-progress-wrapper']) {
            const i = CSS.indexOf(`\n${sel} {`);
            assert.ok(i > 0, `no encuentro ${sel}`);
            assert.match(CSS.slice(i, CSS.indexOf('}', i)), /border-radius:\s*var\(--radius-full\)/, sel);
        }
    });

    test('concéntricos: la carátula del mini reproductor en el móvil es 20 − 14 = 6', () => {
        assert.match(CSS, /\.player-bar\s*\{[^}]*height:\s*64px;[^}]*border-radius:\s*var\(--radius-lg\)/);
    });

    test('los radios en línea también usan la escala', () => {
        for (const [f, texto] of [['index.html', leer('frontend/index.html')], ['el cliente', codigoCliente()]]) {
            assert.ok(!/border-radius:\s*\d+px/.test(texto), `${f} tiene radios sueltos`);
        }
    });
});

describe('esquinas continuas y cifras', () => {
    test('corner-shape solo como mejora progresiva', () => {
        assert.match(CSS, /@supports \(corner-shape: squircle\)\s*\{[^@]*corner-shape:\s*squircle/);
        assert.ok(!/(^|\})\s*[^@{}]*\{[^}]*corner-shape:\s*squircle/.test(CSS.replace(/@supports \(corner-shape: squircle\)\s*\{[\s\S]*?\n\}\n/, '')),
            'corner-shape fuera del @supports');
    });

    test('tiempos, porcentajes y contadores con cifras tabulares', () => {
        assert.match(CSS, /:where\(#playerCurrentTime[^)]*\.full-player-time-row[^)]*\.progress-text[^)]*\)\s*\{\s*font-variant-numeric:\s*tabular-nums/);
    });
});
