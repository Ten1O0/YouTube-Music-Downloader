/**
 * Navegación (plan 09, T18).
 *
 * Entre pestañas el contenido cambia al instante; entrar en un detalle es un
 * «push» y volver, un «pop». Si la dirección se decide mal, cambiar de pestaña
 * se pone a deslizar vistas enteras, que es justo lo que iOS no hace.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { direccionDeNavegacion, geometriaPildora } from '../../frontend/src/ui/nav.js';
import { codigoCliente, leer } from './fuentes.mjs';

const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const DETALLES = { playlistDetailView: 'playlistsView' };

describe('dirección de la navegación', () => {
    test('entrar en el detalle desde su pestaña es un push; volver, un pop', () => {
        assert.equal(direccionDeNavegacion('playlistsView', 'playlistDetailView', DETALLES), 'push');
        assert.equal(direccionDeNavegacion('playlistDetailView', 'playlistsView', DETALLES), 'pop');
    });

    test('entre pestañas no hay transición', () => {
        assert.equal(direccionDeNavegacion('homeView', 'libraryView', DETALLES), null);
        assert.equal(direccionDeNavegacion('libraryView', 'playlistsView', DETALLES), null);
    });

    test('saltar del detalle a otra pestaña tampoco desliza', () => {
        assert.equal(direccionDeNavegacion('playlistDetailView', 'libraryView', DETALLES), null);
    });
});

describe('píldora de la pestaña activa', () => {
    test('ocupa el botón menos el margen', () => {
        const boton = { offsetLeft: 100, offsetTop: 0, offsetWidth: 98, offsetHeight: 60 };
        assert.deepEqual(geometriaPildora(boton, 6), { x: 106, y: 6, ancho: 86, alto: 48 });
    });

    test('se desliza con el muelle ágil y el botón activo ya no pinta su propio fondo', () => {
        assert.match(CSS, /\.nav-pildora\s*\{[^}]*transform var\(--spring-snappy-duration\) var\(--spring-snappy\)/);
        assert.match(CSS, /\.sidebar-nav \.nav-btn\.active\s*\{[^}]*background-color:\s*transparent/);
    });

    test('dentro de un detalle sigue marcada la pestaña de su padre', () => {
        assert.match(codigoCliente(), /const pestana = DETALLES\[viewId\] \?\? viewId;/);
    });
});

describe('push con View Transitions', () => {
    test('solo se fotografía el contenido, y solo mientras navega', () => {
        assert.match(CSS, /:root\[data-navegacion\] \.main-content\s*\{\s*view-transition-name:\s*contenido/);
        assert.ok(!/(^|\})\s*\.main-content\s*\{[^}]*view-transition-name/.test(CSS), 'con nombre permanente, cualquier transición lo arrastraría');
    });

    test('lo que flota encima no queda tapado por la vista que entra', () => {
        for (const nombre of ['barra-inferior', 'mini-reproductor', 'avisos']) {
            assert.match(CSS, new RegExp(`view-transition-name:\\s*${nombre}`), `falta ${nombre}`);
        }
    });

    test('la vista de encima es opaca', () => {
        assert.match(CSS, /\[data-navegacion="push"\]::view-transition-new\(contenido\)\s*\{[^}]*background-color/);
        assert.match(CSS, /\[data-navegacion="pop"\]::view-transition-old\(contenido\)\s*\{[^}]*background-color/);
    });
});

describe('título grande y cabecera', () => {
    test('el título se compacta solo donde hay animaciones ligadas al scroll', () => {
        assert.match(CSS, /@supports \(animation-timeline: scroll\(\)\)\s*\{[\s\S]*?\.view-title[\s\S]*?animation-timeline:\s*scroll\(nearest block\)/);
    });

    test('la cabecera móvil flota sin barra y solo gana un degradado con contenido desplazado', () => {
        assert.match(CSS, /\n\.mobile-header-bar\s*\{\s*position:\s*absolute;[^}]*justify-content:\s*flex-end/);
        assert.match(CSS, /\.mobile-header-bar\[data-borde\]::before\s*\{[^}]*opacity:\s*1/);
        assert.match(leer('frontend/src/ui/nav.js'), /else cabecera\.dataset\.borde = 'con-contenido';/);
        assert.match(CSS, /\.mobile-header-bar\[data-compacta\] \.mobile-header-titulo\s*\{[^}]*opacity:\s*1/);
        // El nombre de la app no se repite en cada pantalla: está en Inicio
        assert.doesNotMatch(leer('frontend/index.html'), /class="mobile-logo"/);
    });

    test('los tres botones, juntos en una cápsula; el título, en su globo a la misma altura', () => {
        assert.match(CSS, /\.mobile-header-controls,\s*\.mobile-header-titulo\s*\{[^}]*height:\s*44px;[^}]*border-radius:\s*var\(--radius-full\)/);
        assert.match(CSS, /\.mobile-header-controls > \* \+ \*\s*\{[^}]*border-left/);
    });

    test('el título compacto va a la izquierda y no llega a los botones de la derecha', () => {
        // Centrado, «Mi Biblioteca» se montaba sobre el botón de idioma
        const regla = CSS.match(/\n\.mobile-header-titulo\s*\{\s*position:\s*absolute;[^}]*\}/)?.[0] ?? '';
        assert.ok(regla, 'no se encuentra la regla del título');
        assert.doesNotMatch(regla, /left:\s*50%/);
        assert.match(regla, /max-width:\s*calc\(100% - 2\.5rem - 170px/);
        assert.match(CSS, /\.mobile-header-bar\[data-compacta\] \.mobile-header-titulo\s*\{[^}]*translate:\s*0 -50%/);
    });

    test('abajo, el mismo degradado, por debajo de la barra de pestañas y del reproductor', () => {
        assert.match(CSS, /\.app-layout::after\s*\{[^}]*bottom:\s*0;[^}]*z-index:\s*89;[^}]*linear-gradient\(to top/);
    });
});

describe('la barra de una lista en el móvil (L3)', () => {
    const LISTA = leer('frontend/src/features/playlists/detalle/cabecera.css').replace(/\/\*[\s\S]*?\*\//g, '');

    test('ocupa la fila de la cabecera: el globo con volver y el nombre, y Reproducir', () => {
        const movil = LISTA.slice(LISTA.indexOf('@media (max-width: 767px)'));
        assert.match(movil, /\.lista-fija\s*\{[^}]*top:\s*calc\(10px \+ env\(safe-area-inset-top, 0px\)\)[^}]*height:\s*44px/);
        assert.match(movil, /\.lista-fija-globo\s*\{[^}]*height:\s*44px[^}]*border-radius:\s*var\(--radius-full\)/);
        assert.match(movil, /\.lista-fija-volver\s*\{\s*display:\s*grid/);
        assert.match(LISTA, /^\.lista-fija-volver \{ display: none; \}/m, 'en el ordenador, la barra de siempre');
    });

    test('los iconos de la cabecera dejan su sitio solo mientras se ve la barra de la lista abierta', () => {
        assert.match(LISTA, /body:has\(#playlistDetailView:not\(\.hidden\) \.lista-fija--visible\) \.mobile-header-controls\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/);
        assert.match(leer('frontend/src/features/playlists/detalle/cabecera.js'), /\$\('plBarraFijaVolver'\)\?\.addEventListener\('click', \(\) => \$\('backToPlaylistsBtn'\)\?\.click\(\)\);/);
    });
});

describe('la app mide lo que se ve', () => {
    test('con 100dvh: con 100vh, en Chrome del móvil el final de una lista subía la página entera', () => {
        for (const sel of ['body', '.app-layout']) {
            const regla = CSS.match(new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
            assert.match(regla, /height:\s*100vh;\s*height:\s*100dvh;/, `${sel} sin 100dvh`);
        }
    });
});

describe('cerrar el reproductor', () => {
    const APP = codigoCliente();

    test('elegir una sección con el reproductor abierto lo recoge y ocupa su entrada del historial', () => {
        assert.match(APP, /window\.history\.replaceState\(\{ type: 'view', view: btn\.dataset\.view \}, '', ''\);\s*reproductor\?\.hideFullPlayer\(\);/);
    });

    test('cerrarlo a mano consume su entrada, y ese «atrás» no cierra otra cosa', () => {
        const i = APP.indexOf('    function hideFullPlayer() {');
        assert.match(APP.slice(i, i + 400), /NavigationModule\.olvidarOverlay\('fullPlayer'\)/);
        assert.match(APP, /if \(popsIgnorados > 0\) \{\s*popsIgnorados--;\s*return;/);
    });

    test('se cierra con el dedo, el ratón y el trackpad, sin arrastrar la carátula como imagen', () => {
        assert.match(APP, /fullPlayer\.addEventListener\('pointerdown'/);
        assert.match(APP, /fullPlayer\.addEventListener\('wheel', [\s\S]*?\{ passive: false \}\)/);
        assert.match(APP, /fullPlayer\.addEventListener\('dragstart', e => e\.preventDefault\(\)\)/);
    });

    test('la inercia que llega arriba desde las letras no lo cierra', () => {
        assert.match(APP, /const continua = e\.timeStamp - ultimaRueda < 150;/);
        assert.match(APP, /if \(continua \|\| e\.deltaY >= 0/);
    });
});

describe('forma de la píldora y del mini reproductor', () => {
    test('la píldora no lleva esquinas continuas: con radio completo dejaría de casar con la cápsula', () => {
        const i = CSS.indexOf('@supports (corner-shape: squircle)');
        assert.ok(!CSS.slice(i, CSS.indexOf('corner-shape: squircle;', i)).includes('.nav-pildora'));
    });

    test('en el móvil la barra de progreso no se sale por las esquinas redondeadas', () => {
        assert.match(CSS, /\.player-bar-progress-container\s*\{[^}]*right:\s*var\(--radius-lg\);[^}]*left:\s*var\(--radius-lg\)/);
    });
});
