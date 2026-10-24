/**
 * Barras del sistema y comportamiento de app (plan 09, T20).
 */

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_BASE, colorBarra, initBarraEstado } from '../../frontend/src/ui/system-bars.js';
import { codigoCliente, leer } from './fuentes.mjs';

const PALETA = ['#DFCDAC', '#6F8F6A', '#141A14'];

afterEach(() => { delete globalThis.Capacitor; });

function reproductor(abierto) {
    const clases = new Set(abierto ? [] : ['fp-hidden']);
    return { clases, classList: { contains: c => clases.has(c) } };
}

function apk() {
    const llamadas = [];
    globalThis.Capacitor = {
        isNative: true,
        Plugins: {
            StatusBar: {
                setStyle: o => { llamadas.push(`estilo:${o.style}`); return Promise.resolve(); },
                setBackgroundColor: o => { llamadas.push(o.color); return Promise.resolve(); },
            },
        },
    };
    return llamadas;
}

describe('color de la barra de estado', () => {
    test('con el reproductor abierto, el color base de la carátula', () => {
        assert.equal(colorBarra(true, PALETA), '#141A14');
    });

    test('cerrado, o con un color raro, el de la app', () => {
        assert.equal(colorBarra(false, PALETA), COLOR_BASE);
        assert.equal(colorBarra(true, ['a', 'b', 'rgb(0,0,0)']), COLOR_BASE);
        assert.equal(colorBarra(true, null), COLOR_BASE);
    });
});

describe('en la APK', () => {
    test('texto claro, color de la app y, al abrir el reproductor, el de la carátula', () => {
        const llamadas = apk();
        const fp = reproductor(false);
        const barra = initBarraEstado({ reproductor: fp, paleta: () => PALETA });
        fp.clases.delete('fp-hidden');
        barra.refrescar();
        barra.refrescar();
        fp.clases.add('fp-hidden');
        barra.refrescar();
        assert.deepEqual(llamadas, ['estilo:DARK', COLOR_BASE, '#141A14', COLOR_BASE], 'sin repetir el mismo color');
    });

    test('en la web no hace nada', () => {
        assert.doesNotThrow(() => initBarraEstado({ reproductor: reproductor(true), paleta: () => PALETA }).refrescar());
    });
});

describe('comportamiento de app', () => {
    const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    test('la barra de navegación de Android va en el tema, del color de la app', () => {
        assert.match(leer('mobile/android/app/src/main/res/values/styles.xml'), /<item name="android:navigationBarColor">#0A0C0A<\/item>/);
        assert.match(leer('mobile/package.json'), /"@capacitor\/status-bar": "\^5/);
    });

    test('los controles no se seleccionan; los campos de texto, sí', () => {
        assert.match(CSS, /:where\(button,[^)]*\.library-item[^)]*\)\s*\{[^}]*user-select:\s*none/);
        assert.match(CSS, /:where\(input, textarea[^)]*\)\s*\{[^}]*user-select:\s*text/);
    });

    test('en la APK y en la app instalada, sin menú en las imágenes ni tirón de la página', () => {
        assert.match(CSS, /html\.is-native img\s*\{[^}]*-webkit-touch-callout:\s*none/);
        assert.match(CSS, /html\.is-native body\s*\{[^}]*overscroll-behavior:\s*none/);
        assert.match(CSS, /@media \(display-mode: standalone\)/);
        assert.match(codigoCliente(), /document\.documentElement\.classList\.add\('is-native'\)/);
    });
});

describe('zonas seguras (cámara y barra de estado)', () => {
    const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    test('la página se dibuja bajo la barra de estado, así que tiene que dejarle sitio', () => {
        assert.match(leer('frontend/index.html'), /viewport-fit=cover/);
    });

    test('la cabecera móvil, la isla y el reproductor empiezan por debajo de la cámara', () => {
        assert.match(CSS, /\.mobile-header-bar\s*\{[^}]*padding:\s*calc\(10px \+ env\(safe-area-inset-top, 0px\)\)/);
        // El globo del título, centrado con la cápsula también bajo la cámara
        assert.match(CSS, /\.mobile-header-titulo\s*\{[^}]*top:\s*calc\(32px \+ env\(safe-area-inset-top, 0px\)\)/);
        assert.match(CSS, /\.main-content\s*\{\s*padding-top:\s*calc\(2\.55rem \+ 33px \+ env\(safe-area-inset-top, 0px\)\)/);
        assert.match(CSS, /\.dl-island\s*\{[^}]*top:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 8px\)/);
        assert.match(CSS, /padding-top:\s*calc\(0\.85rem \+ env\(safe-area-inset-top\)\)/);
    });

    test('los títulos de la isla se recortan con puntos suspensivos, no por la cámara', () => {
        assert.match(CSS, /\.dl-island-titulo\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
    });

    test('abajo, la barra de pestañas respeta el indicador de inicio', () => {
        assert.match(CSS, /\.bottom-nav\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom\) \+ 10px\)/);
    });
});
