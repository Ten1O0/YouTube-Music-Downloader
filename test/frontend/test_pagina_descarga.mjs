/**
 * Página de descarga (/download).
 *
 * La anterior tenía un estilo ajeno a la app y afirmaba cosas falsas («todo el
 * código es público en GitHub», con el repositorio privado; «solo pide
 * internet y almacenamiento»). Estas pruebas fijan que hable el mismo idioma
 * visual que la app y que no prometa nada que no sea cierto.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IDIOMAS, TEXTOS, elegirIdioma, tamanoLegible } from '../../frontend/src/pages/download-textos.js';
import { leer } from './fuentes.mjs';

const HTML = leer('frontend/download.html');
const CSS = leer('frontend/src/pages/download.css');

describe('textos', () => {
    test('ningún idioma se deja una clave', () => {
        const claves = Object.keys(TEXTOS.es);
        for (const idioma of IDIOMAS) {
            const faltan = claves.filter(c => !TEXTOS[idioma]?.[c]);
            assert.deepEqual(faltan, [], `${idioma}: faltan ${faltan.join(', ')}`);
        }
    });

    test('todo lo que la página marca para traducir existe', () => {
        const usadas = [...HTML.matchAll(/data-t="([^"]+)"/g)].map(m => m[1]);
        assert.ok(usadas.length > 30);
        for (const clave of usadas) assert.ok(TEXTOS.es[clave], `data-t="${clave}" sin texto`);
    });

    test('idioma: el pedido, el guardado, el del navegador o castellano', () => {
        assert.equal(elegirIdioma({ parametro: 'fr', navegador: ['en-US'] }), 'fr');
        assert.equal(elegirIdioma({ guardado: 'de', navegador: ['en-US'] }), 'de');
        assert.equal(elegirIdioma({ navegador: ['it-IT', 'pt-BR'] }), 'pt');
        assert.equal(elegirIdioma({ navegador: ['ja'] }), 'es');
    });

    test('tamaño legible de la APK', () => {
        assert.equal(tamanoLegible(10 * 1024 * 1024 + 524288, 'es'), '10,5 MB');
        assert.equal(tamanoLegible(0), '');
    });
});

describe('solo afirmaciones ciertas', () => {
    const todo = HTML + JSON.stringify(TEXTOS);

    test('no dice que el código sea público (el repositorio es privado)', () => {
        assert.ok(!/GitHub|código abierto|open source|código es público/i.test(todo));
    });

    test('lista los permisos que de verdad usa la APK', () => {
        for (const clave of ['p_internet_t', 'p_audio_t', 'p_notif_t', 'p_fondo_t', 'p_vibra_t']) {
            assert.match(HTML, new RegExp(`data-t="${clave}"`));
        }
    });

    test('publica la huella del certificado con el que se firman todas las versiones', () => {
        assert.match(HTML, /B7:6C:5F:3D:4E:D7:F5:25:07:5C:DD:BD:67:21:D7:3E:6B:93:BB:9D:63:05:23:BB:43:CF:00:9E:40:04:87:D1/);
    });

    test('ni la marca de YouTube ni emojis haciendo de iconos', () => {
        assert.ok(!/YouTube/.test(todo));
        assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(HTML));
    });
});

describe('mismo lenguaje visual que la app', () => {
    const APP = leer('frontend/src/styles.css');

    test('los tokens replicados valen lo mismo que en styles.css', () => {
        for (const token of ['--bg-void', '--text-primary', '--text-secondary', '--accent-gold', '--accent-sage',
            '--border-subtle', '--radius-sm', '--radius-lg', '--spring-snappy', '--glass-thin-filter']) {
            const valor = t => new RegExp(`${token}:\\s*([^;]+);`).exec(t)?.[1].trim();
            assert.equal(valor(CSS), valor(APP), `${token} se ha desincronizado`);
        }
    });

    test('respeta «Reducir movimiento» y «Reducir transparencia»', () => {
        assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
        assert.match(CSS, /@media \(prefers-reduced-transparency: reduce\)/);
    });

    test('el modal de la app enlaza con esta página', () => {
        assert.match(leer('frontend/index.html'), /<a class="modal-apk-mas" href="https:\/\/music\.dannarita\.es\/download"/);
        // En la APK el botón de Android no se muestra: sus enlaces apuntarían a la propia app
        assert.match(leer('frontend/src/styles.css'), /html\.is-native \.android-app-btn-el\s*\{\s*display:\s*none !important/);
    });
});
