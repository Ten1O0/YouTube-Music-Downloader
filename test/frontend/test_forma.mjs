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

    test('no quedan radios sueltos: solo la escala, círculos, herencia y sin esquinas', () => {
        // «0» no es un radio inventado: el grano del cristal no repite las
        // esquinas de lo que ya las recorta (plan 28, T5)
        const sueltos = [...CSS.matchAll(/border-radius:\s*([^;]+);/g)]
            .map(m => m[1].replace('!important', '').trim())
            .filter(v => !/^(0|var\(--radius-\w+\)( var\(--radius-\w+\)| 0)*|50%|inherit)$/.test(v));
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
    test('sin corner-shape: una sola esquina, la que también siguen el cristal y las sombras', () => {
        // Con squircle, el borde y el fondo seguían la esquina continua y el
        // backdrop-filter, el anillo y las sombras, la redonda: dos esquinas
        // superpuestas en las ventanas y el mini reproductor (plan 23)
        const reglas = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.ok(!/corner-shape\s*:/.test(reglas), 'vuelve a haber corner-shape');
    });

    test('tiempos, porcentajes y contadores con cifras tabulares', () => {
        assert.match(CSS, /:where\(#playerCurrentTime[^)]*\.full-player-time-row[^)]*\.progress-text[^)]*\)\s*\{\s*font-variant-numeric:\s*tabular-nums/);
    });
});
