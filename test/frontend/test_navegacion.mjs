/**
 * Navegación (plan 09, T18).
 *
 * Entre pestañas el contenido cambia al instante; entrar en un detalle es un
 * «push» y volver, un «pop». Si la dirección se decide mal, cambiar de pestaña
 * se pone a deslizar vistas enteras, que es justo lo que iOS no hace.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { direccionDeNavegacion, geometriaPildora } from '../../src/ui/nav.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const CSS = leer('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
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
        assert.match(leer('app.js'), /const pestana = DETALLES\[viewId\] \?\? viewId;/);
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

    test('la cabecera móvil solo tiene fondo con contenido desplazado', () => {
        // En reposo, transparente; con scroll, cristal fino (T21)
        assert.match(CSS, /\.mobile-header-bar\s*\{[^}]*background-color:\s*transparent/);
        assert.match(leer('src/ui/nav.js'), /cabecera\.classList\.toggle\('glass-thin', !e\.isIntersecting\)/);
        assert.match(CSS, /\.mobile-header-bar\[data-compacta\] \.mobile-header-titulo\s*\{[^}]*opacity:\s*1/);
    });
});

describe('cerrar el reproductor', () => {
    const APP = leer('app.js');

    test('elegir una sección con el reproductor abierto lo recoge y ocupa su entrada del historial', () => {
        assert.match(APP, /window\.history\.replaceState\(\{ type: 'view', view: btn\.dataset\.view \}, '', ''\);\s*PlayerModule\.hideFullPlayer\(\);/);
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
