/**
 * Cristal esmerilado (plan 09, T21).
 *
 * El desenfoque es lo más caro que pinta la app. Por eso vive en un solo
 * sitio —tres clases y sus tokens— y el resto de superficies son opacas: así
 * no vuelve a aparecer un blur suelto donde no pasa nada por detrás.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codigoCliente, leer } from './fuentes.mjs';

const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = leer('frontend/index.html');

function reglas(css) {
    const res = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) res.push({ selector: m[1].trim(), cuerpo: m[2] });
    return res;
}

describe('el desenfoque solo vive en el cristal', () => {
    test('backdrop-filter solo en .glass-*, con sus tokens, o en el fondo oscurecido de los modales', () => {
        const sueltas = [];
        for (const r of reglas(CSS)) {
            for (const m of r.cuerpo.matchAll(/(?<![\w-])backdrop-filter:\s*([^;]+);/g)) {
                const valor = m[1].trim();
                if (/^none( !important)?$/.test(valor)) continue;
                const esCristal = /\.glass-(thin|regular|thick)/.test(r.selector) || /var\(--glass-\w+-filter\)/.test(valor);
                const esFondoModal = /-backdrop\b/.test(r.selector) && valor === 'blur(8px)';
                if (!esCristal && !esFondoModal) sueltas.push(`${r.selector.split('\n').pop().trim()} → ${valor}`);
            }
        }
        assert.deepEqual(sueltas, [], 'desenfoque fuera del material');
    });

    test('los tres grosores con los valores de §2.6', () => {
        assert.match(CSS, /--glass-thin-bg:\s*rgba\(16, 20, 16, 0\.22\)/);
        assert.match(CSS, /--glass-regular-filter:\s*blur\(18px\) saturate\(190%\) brightness\(1\.05\)/);
        assert.match(CSS, /--glass-thick-bg:\s*rgba\(16, 20, 16, 0\.5\)/);
        assert.match(CSS, /--glass-grain-opacity:\s*0\.035/);
    });

    test('borde especular recortado con máscara y grano por debajo del contenido', () => {
        assert.match(CSS, /:is\(\.glass-thin, \.glass-regular, \.glass-thick\)::before\s*\{[^}]*mask-composite:\s*exclude/);
        assert.match(CSS, /:is\(\.glass-thin, \.glass-regular, \.glass-thick\)::after\s*\{[^}]*z-index:\s*-1[^}]*mix-blend-mode:\s*soft-light/);
    });
});

describe('cada superficie con su grosor (anexo B)', () => {
    test('lo que hay que leer entero es grueso: los 13 modales y el menú', () => {
        const contenidos = HTML.match(/class="auth-modal-content[^"]*"/g) || [];
        assert.ok(contenidos.length >= 12);
        assert.ok(contenidos.every(c => c.includes('glass-thick')), 'hay un modal sin cristal grueso');
        assert.match(HTML, /class="pq-panel glass-thick"/);
        assert.match(HTML, /class="custom-options glass-thick"/);
        assert.match(leer('frontend/src/ui/downloads-hud.js'), /'dl-banner glass-thick'/);
    });

    test('lo que flota es normal: mini reproductor y pestañas', () => {
        for (const re of [/class="player-bar glass-regular/, /class="bottom-nav glass-regular"/]) {
            assert.match(HTML, re);
        }
    });

    test('la isla no es de cristal: es negra, como la de verdad', () => {
        assert.ok(!/dl-island[^'"]*glass-/.test(leer('frontend/src/ui/downloads-hud.js')));
    });
});

describe('barra de pestañas flotante', () => {
    test('cápsula sobre el borde seguro, con el mini reproductor encima', () => {
        // 58 px de alto con radio completo: 29
        assert.match(CSS, /\.bottom-nav\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom\) \+ 10px\)[^}]*height:\s*58px[^}]*border-radius:\s*var\(--radius-full\)/);
        assert.match(CSS, /\.player-bar\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom\) \+ 76px\)/);
    });
});

describe('degradación', () => {
    test('con «Reducir transparencia», el cristal es opaco y sin grano', () => {
        const i = CSS.indexOf('@media (prefers-reduced-transparency: reduce)');
        const bloque = CSS.slice(i, CSS.indexOf('\n}\n', i));
        assert.match(bloque, /\.glass-thick[\s\S]*?background-color:\s*#151A15 !important/);
        assert.match(bloque, /::after\s*\{\s*display:\s*none/);
    });

    test('en equipos modestos, cristal ligero', () => {
        assert.match(CSS, /html\[data-glass="lite"\]\s*\{[^}]*--glass-grain-opacity:\s*0/);
        assert.match(codigoCliente(), /navigator\.deviceMemory \?\? 8\) <= 4 \|\| \(navigator\.hardwareConcurrency \?\? 8\) <= 4/);
    });
});
