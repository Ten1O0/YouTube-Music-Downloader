/**
 * Reglas de estilo del movimiento (plan 09).
 *
 * El movimiento es lo que antes se estropea sin que nadie lo note: vuelve un
 * `transition: all`, alguien pone un `translateY` al pasar el ratón o un
 * `backdrop-filter` suelto. Estos tests leen styles.css y lo atrapan en el CI.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { codigoCliente, leer } from './fuentes.mjs';

const CSS = leer('frontend/src/styles.css');
const SIN_COMENTARIOS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Reglas { selector, cuerpo } de primer nivel y dentro de @media. */
function reglas(css) {
    const res = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) res.push({ selector: m[1].trim(), cuerpo: m[2] });
    return res;
}

describe('T4 · transiciones explícitas', () => {
    test('ninguna transición anima «all»', () => {
        const encontradas = [...SIN_COMENTARIOS.matchAll(/transition:\s*all\b[^;]*;/g)].map(m => m[0]);
        assert.deepEqual(encontradas, [], 'animar «all» incluye tamaños y posiciones');
    });

    test('no quedan los tokens antiguos de «all»', () => {
        const fuentes = [['styles.css', leer('frontend/src/styles.css')], ['index.html', leer('frontend/index.html')], ['el cliente', codigoCliente()]];
        for (const [f, texto] of fuentes) {
            assert.ok(!/--transition-(smooth|fast)\b/.test(texto), `${f} usa --transition-smooth o --transition-fast`);
        }
    });

    test('app.js no escribe transiciones de «all» en línea', () => {
        assert.ok(!/transition:\s*all\b/.test(codigoCliente()));
    });

    test('--transition-ui no incluye propiedades de layout', () => {
        const token = CSS.match(/--transition-ui:([^;]*);/)?.[1] ?? '';
        assert.ok(token, 'falta el token --transition-ui');
        for (const prop of ['width', 'height', 'top', 'left', 'margin', 'padding', 'max-height']) {
            assert.ok(!new RegExp(`(^|[\\s,])${prop}\\s`).test(token), `--transition-ui anima ${prop}`);
        }
        assert.match(token, /transform var\(--spring-snappy-duration\) var\(--spring-snappy\)/);
    });
});

describe('T4 · pulsación', () => {
    test('nada se eleva al pasar el ratón', () => {
        const culpables = reglas(SIN_COMENTARIOS)
            .filter(r => r.selector.includes(':hover') && /transform:\s*translateY/.test(r.cuerpo))
            .map(r => r.selector);
        assert.deepEqual(culpables, []);
    });

    test('app.js no eleva nada al pasar el ratón', () => {
        assert.ok(!/style\.transform\s*=\s*'translateY\(-/.test(codigoCliente()));
    });

    test('lo pulsable se hunde con su escala', () => {
        const activa = reglas(SIN_COMENTARIOS).find(r => r.selector.includes(':active:not(:disabled)'));
        assert.ok(activa, 'falta la regla de pulsación');
        assert.match(activa.cuerpo, /transform:\s*scale\(var\(--press\)\)/);
        for (const clase of ['.download-btn', '.nav-btn', '.library-item', '.fp-play-btn', '.player-ctrl-btn']) {
            assert.ok(activa.selector.includes(clase), `${clase} no se hunde al pulsarlo`);
        }
    });

    test('las tres escalas existen', () => {
        for (const escala of ['0.9', '0.96', '0.98']) {
            assert.ok(SIN_COMENTARIOS.includes(`--press: ${escala};`), `falta la escala ${escala}`);
        }
    });
});

describe('T5 · accesibilidad del movimiento', () => {
    /** Cuerpo de un bloque @media (con llaves anidadas). */
    function bloqueMedia(consulta) {
        const i = CSS.indexOf(`@media (${consulta})`);
        if (i < 0) return '';
        let nivel = 0, j = CSS.indexOf('{', i);
        for (let k = j; k < CSS.length; k++) {
            if (CSS[k] === '{') nivel++;
            else if (CSS[k] === '}' && --nivel === 0) return CSS.slice(j, k);
        }
        return '';
    }

    test('«Reducir movimiento» deja los muelles en 1 ms', () => {
        const bloque = bloqueMedia('prefers-reduced-motion: reduce');
        assert.ok(bloque, 'falta el bloque prefers-reduced-motion');
        for (const muelle of ['smooth', 'snappy', 'bouncy']) {
            assert.match(bloque, new RegExp(`--spring-${muelle}-duration:\\s*1ms`), `el muelle ${muelle} se sigue moviendo`);
        }
    });

    test('«Reducir movimiento» cambia hundir por oscurecer', () => {
        const bloque = bloqueMedia('prefers-reduced-motion: reduce');
        assert.match(bloque, /:active:not\(:disabled\)\s*\{[^}]*transform:\s*none[^}]*opacity:\s*0\.7/);
    });

    test('«Reducir transparencia» quita el desenfoque', () => {
        const bloque = bloqueMedia('prefers-reduced-transparency: reduce');
        assert.ok(bloque, 'falta el bloque prefers-reduced-transparency');
        assert.match(bloque, /backdrop-filter:\s*none\s*!important/);
    });

    test('toda animación usada tiene sus fotogramas clave', () => {
        // .btn-loader usaba «spinner» sin que existiera: el indicador no giraba.
        const definidas = new Set([...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]));
        const usadas = new Set([
            ...[...SIN_COMENTARIOS.matchAll(/animation:\s*([\w-]+)/g)].map(m => m[1]),
            ...[...SIN_COMENTARIOS.matchAll(/animation-name:\s*([\w-]+)/g)].map(m => m[1]),
        ]);
        usadas.delete('none');
        const faltan = [...usadas].filter(n => !definidas.has(n));
        assert.deepEqual(faltan, [], `animaciones sin @keyframes: ${faltan.join(', ')}`);
    });

    test('el indicador de la biblioteca tiene estilo', () => {
        assert.match(SIN_COMENTARIOS, /\.spinner\s*\{[^}]*animation:\s*spinner/);
    });
});

describe('T9 · reproducir y pausar', () => {
    test('los dos glifos comparten celda y se cruzan', () => {
        assert.match(SIN_COMENTARIOS, /:is\(#playerPlay, #fullPlayerPlay\) > :is\(\.play-icon, \.pause-icon\)\s*\{[^}]*grid-area:\s*1 \/ 1/);
        assert.match(SIN_COMENTARIOS, /\.is-playing > \.play-icon,[^{]*:not\(\.is-playing\) > \.pause-icon\s*\{[^}]*opacity:\s*0;[^}]*scale:\s*0\.6/);
    });

    test('el HTML ya no oculta la pausa en línea', () => {
        assert.ok(!/class="pause-icon"[^>]*style="display:none"/.test(leer('frontend/index.html')));
    });

    test('la carátula escala y su sombra la acompaña', () => {
        assert.match(SIN_COMENTARIOS, /\.full-player-artwork\s*\{[^}]*transform:\s*scale\(var\(--art-scale, 1\)\)/);
        assert.match(SIN_COMENTARIOS, /--art-shadow/);
    });

    test('se escucha al propio <audio>, no a los botones', () => {
        const app = codigoCliente();
        assert.match(app, /addOptionalEventListener\(audio, 'play', \(\) => \{[^}]*respirar\(true\)/);
        assert.match(app, /addOptionalEventListener\(audio, 'pause', \(\) => \{[^}]*respirar\(false\)/);
        assert.match(app, /const ESCALA_PAUSA = 0\.82;/);
    });
});

describe('T10 · barras que engordan al agarrarlas', () => {
    test('la pista crece solo con transform, sin mover el layout', () => {
        assert.match(SIN_COMENTARIOS, /\.grip-track\.is-scrubbing\s*\{\s*transform:\s*scaleY\(2\.4\);\s*\}/);
        assert.match(SIN_COMENTARIOS, /\.grip-track\s*\{[^}]*transition:\s*transform var\(--spring-snappy-duration\) var\(--spring-snappy\)/);
    });

    test('las tres barras que se arrastran lo hacen', () => {
        assert.match(codigoCliente(), /for \(const barra of \[fullPlayerSeek, playerVolume, fullPlayerVolume\]\)/);
    });

    test('se suelta en cualquier punto de la ventana', () => {
        assert.match(codigoCliente(), /globalThis\.addEventListener\('pointerup', soltar\)/);
    });

    test('los tiempos se iluminan mientras se arrastra', () => {
        assert.match(SIN_COMENTARIOS, /\.full-player-seek-container:has\(\.is-scrubbing\) \.full-player-time-row\s*\{[^}]*color:\s*var\(--text-primary\)/);
    });
});

describe('T11 · fondo con el color de la carátula', () => {
    test('ya no se desenfoca la imagen a 80 px', () => {
        assert.ok(!/blur\(80px\)/.test(SIN_COMENTARIOS), 'vuelve el desenfoque más caro de la app');
        assert.ok(!/backgroundImage/.test(codigoCliente().match(/function updatePlayerUI[\s\S]*?\n}/)?.[0] ?? ''),
            'updatePlayerUI vuelve a poner la carátula como imagen de fondo');
    });

    test('los tres colores son @property y se funden entre canciones', () => {
        for (const v of ['--art-c1', '--art-c2', '--art-c3']) {
            assert.match(CSS, new RegExp(`@property ${v} \\{ syntax: '<color>'`), `${v} sin registrar: no se fundiría`);
        }
        assert.match(SIN_COMENTARIOS, /\.full-player-bg\s*\{[^}]*transition:\s*--art-c1 600ms ease/);
    });

    test('una respuesta antigua no pinta encima de la canción nueva', () => {
        assert.match(codigoCliente(), /if \(turno !== turnoFondo\) return;/);
    });
});

describe('T12 · letras con profundidad', () => {
    const letras = () => {
        const app = codigoCliente();
        const i = app.indexOf('const LyricsModule');
        return app.slice(i, app.indexOf('\n})();', i));
    };

    test('el desplazamiento es un muelle sobre la caja, no scrollIntoView', () => {
        assert.ok(!/scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/.test(letras()),
            'scrollIntoView también mueve el contenedor del reproductor');
        assert.match(letras(), /const ANCLA_LETRAS = 0\.35;/);
    });

    test('la pausa del seguimiento la decide la intención del usuario, no los eventos de scroll', () => {
        // Con eventos de scroll, el propio auto-desplazamiento se tomaba por el
        // usuario y pausaba el seguimiento 5 s tras cada línea.
        const codigo = letras();
        assert.ok(!/lyricsSection\.addEventListener\('scroll'/.test(codigo));
        assert.match(codigo, /addEventListener\('wheel', mandaElUsuario/);
        assert.match(codigo, /addEventListener\('touchmove', mandaElUsuario/);
    });

    test('la profundidad depende de la distancia a la línea activa', () => {
        for (const [d, op] of [['1', '0.45'], ['2', '0.32']]) {
            assert.match(SIN_COMENTARIOS, new RegExp(`\\.lyrics-line\\[data-d="${d}"\\] \\{ opacity: ${op}; filter: blur`));
        }
        assert.match(SIN_COMENTARIOS, /\.full-player-lyrics-view \.lyrics-line\.active\s*\{[^}]*opacity:\s*1;[^}]*filter:\s*none/);
    });

    test('sin brillo en la activa ni transición de «all»', () => {
        const bloque = SIN_COMENTARIOS.slice(SIN_COMENTARIOS.indexOf('.full-player-lyrics-view .lyrics-line {'));
        assert.ok(!/\.full-player-lyrics-view \.lyrics-line\.active\s*\{[^}]*text-shadow/.test(bloque));
    });

    test('alineadas a la izquierda también en el móvil', () => {
        assert.ok(!/\.lyrics-line\s*\{[^}]*text-align:\s*center/.test(SIN_COMENTARIOS));
    });

    test('ya no queda la franja de 72 px', () => {
        assert.ok(!/\.lyrics-section\s*\{[^}]*height:\s*72px/.test(SIN_COMENTARIOS));
    });
});

describe('T16 · reordenar', () => {
    const APP = codigoCliente();

    test('Sortable aparta las filas con el muelle ágil, no con una curva que acelera', () => {
        // Desde el plan 24 vive en la vista de la lista (playlists/detalle/vista.js)
        const i = APP.indexOf('new Sortable(lista, {');
        const opciones = APP.slice(APP.lastIndexOf('springTiming(', i), APP.indexOf('onEnd', i));
        assert.match(opciones, /springTiming\('snappy'\)/);
        assert.match(opciones, /animation: muelle\.durationMs/);
        assert.match(opciones, /easing: muelle\.easing/);
        assert.ok(!APP.includes("cubic-bezier(0.11, 0, 0.5, 0)"), 'vuelve la curva que acelera al llegar');
    });

    test('nada anula la transición en línea con la que Sortable anima las filas', () => {
        const anulan = reglas(SIN_COMENTARIOS).filter(r => /transition:\s*none\s*!important/.test(r.cuerpo));
        for (const r of anulan) {
            assert.doesNotMatch(r.selector, /edit-mode|sortable-ghost|sortable-chosen/,
                `${r.selector.trim()} deja las filas saltando en vez de apartarse`);
        }
        assert.ok(anulan.some(r => /\.sortable-fallback/.test(r.selector)), 'el clon que sigue al dedo sí debe ir sin transición');
    });

    test('la fila cogida se levanta y su hueco queda como fantasma', () => {
        assert.match(SIN_COMENTARIOS, /\.library-item\.sortable-chosen,\s*\.sortable-fallback\s*\{[^}]*scale:\s*1\.03/);
        assert.match(SIN_COMENTARIOS, /\.sortable-ghost\s*\{[^}]*opacity:\s*0\.35/);
    });

    test('el asa es del arrastre, aunque la fila deje el scroll al navegador', () => {
        assert.match(SIN_COMENTARIOS, /\.library-item\.edit-mode \.pl-drag-handle\s*\{[^}]*touch-action:\s*none/);
    });
});

describe('reproductor en ventanas bajas', () => {
    test('en escritorio la carátula cede sitio para que los controles quepan', () => {
        assert.match(SIN_COMENTARIOS, /\.full-player-artwork\s*\{[^}]*max-width:\s*clamp\(220px, calc\(100dvh - 500px\), 420px\) !important/);
    });

    test('y su sombra respira también ahí (T9)', () => {
        assert.ok(!/\.full-player-artwork\s*\{[^}]*box-shadow:\s*0 24px 64px rgba\(0, 0, 0, 0\.8\)/.test(SIN_COMENTARIOS),
            'una sombra fija con !important anula la respiración');
    });
});
