/**
 * Detalles que rompen la ilusión (plan 09, T6).
 *
 * Cada uno es una línea, pero cada uno, por sí solo, hace que la app parezca
 * descuidada: un botón que dice un formato que no es, una etiqueta de
 * depuración a la vista, banderas que no cargan sin conexión.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';
import { FLAGS, flagImg } from '../../frontend/src/ui/flags.js';
import { codigoCliente, leer } from './fuentes.mjs';

const { api } = app();

describe('D15 · el botón dice el formato elegido', () => {
    test('download_btn lleva {format} en los seis idiomas', () => {
        for (const lang of api.SUPPORTED_LANGS) {
            assert.match(api.TRANSLATIONS[lang].download_btn, /\{format\}/, `${lang}: el botón no nombra el formato elegido`);
        }
    });

    test('el subtítulo no promete ningún formato', () => {
        for (const lang of api.SUPPORTED_LANGS) {
            assert.doesNotMatch(api.TRANSLATIONS[lang].subtitle, /MP3|M4A/i, `${lang}: el subtítulo nombra un formato`);
        }
    });

    test('la traducción sustituye el formato', () => {
        const i18n = new api.LanguageManager();
        i18n.currentLang = 'es';
        assert.equal(i18n.t('download_btn', { format: 'M4A' }), 'Descargar M4A');
        i18n.currentLang = 'de';
        assert.equal(i18n.t('download_btn', { format: 'MP3' }), 'MP3 herunterladen');
    });

    test('los textos con data-i18n admiten parámetros', () => {
        assert.match(codigoCliente(), /el\.dataset\.i18nParams/);
    });
});

describe('D16 · sin etiqueta de depuración', () => {
    test('no se crea ni se actualiza', () => {
        assert.ok(!codigoCliente().includes('debug-env-label'));
    });
});

describe('D17 · banderas, iconos y nombre', () => {
    test('hay una bandera propia para cada idioma de la app', () => {
        for (const lang of api.SUPPORTED_LANGS) {
            assert.ok(FLAGS[lang]?.startsWith('data:image/svg+xml,'), `${lang} sin bandera`);
            const svg = decodeURIComponent(FLAGS[lang].slice('data:image/svg+xml,'.length));
            assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 18"/);
            assert.match(svg, /<\/svg>$/);
        }
    });

    test('flagImg describe la bandera y sobrevive a un idioma raro', () => {
        assert.match(flagImg('es'), /alt="ES"/);
        assert.equal(flagImg('xx'), 'XX');
    });

    test('nada pide banderas a flagcdn.com', () => {
        for (const [f, texto] of [['frontend/index.html', leer('frontend/index.html')], ['el cliente', codigoCliente()]]) {
            assert.ok(!texto.includes('https://flagcdn.com'), `${f} sigue pidiendo banderas a un tercero`);
        }
        assert.match(leer('frontend/index.html'), /<img class="lang-flag" data-flag="es"/);
    });

    test('sin emojis haciendo de icono', () => {
        assert.ok(!/☕/.test(leer('frontend/index.html')), 'el café sigue siendo un emoji');
    });

    test('la app se llama Music Downloader en lo que ve el usuario', () => {
        const visibles = {
            'frontend/index.html': leer('frontend/index.html'),
            'frontend/download.html': leer('frontend/download.html'),
            'public/manifest.json': leer('frontend/public/manifest.json'),
            'mobile/capacitor.config.ts': leer('mobile/capacitor.config.ts'),
            'mobile/android/app/src/main/res/values/strings.xml': leer('mobile/android/app/src/main/res/values/strings.xml'),
        };
        for (const [f, texto] of Object.entries(visibles)) {
            assert.doesNotMatch(texto, /YouTube (Music )?Downloader|YT Music/, `${f} usa el nombre antiguo`);
        }
        assert.match(visibles['public/manifest.json'], /"name": "Music Downloader"/);
    });
});

describe('D13 · letras sin sincronizar legibles', () => {
    test('no se pintan como líneas ya pasadas', () => {
        const fuente = codigoCliente();
        assert.ok(!fuente.includes('class="lyrics-line past"'));
        assert.ok(fuente.includes('class="lyrics-line plain"'));
        // Desde la T12 la legibilidad va por opacidad, como el resto de líneas
        assert.match(leer('frontend/src/styles.css'), /\.lyrics-line\.plain\s*\{[^}]*opacity:\s*0\.75/);
    });
});

describe('contador de canciones', () => {
    test('singular y plural en los seis idiomas', () => {
        for (const lang of api.SUPPORTED_LANGS) {
            for (const clave of ['song_count_one', 'song_count_other']) {
                assert.match(api.TRANSLATIONS[lang][clave] ?? '', /\{n\}/, `${lang}: falta ${clave}`);
            }
        }
        assert.equal(api.TRANSLATIONS.es.song_count_one, '{n} canción');
        assert.equal(api.TRANSLATIONS.es.song_count_other, '{n} canciones');
    });

    test('no vuelve «canciónes»', () => {
        const fuente = codigoCliente();
        assert.ok(!fuente.includes("canción${"), 'el plural se formaba añadiendo «es» a «canción»');
        assert.ok(!/\$\{(?:pl\.songs|lib)\.length\} canciones/.test(fuente), 'contador sin traducir');
    });
});

describe('«Invítame a un café» en el móvil', () => {
    const HTML = leer('frontend/index.html');

    test('va en la cabecera, junto al idioma y Android, y se traduce', () => {
        const i = HTML.indexOf('class="mobile-header-controls"');
        const cabecera = HTML.slice(i, HTML.indexOf('<!-- Sidebar lateral', i));
        assert.match(cabecera, /<a class="header-coffee-btn"[^>]*href="https:\/\/buymeacoffee\.com\/dannarita"[^>]*rel="noopener"[^>]*data-i18n-title="buy_coffee"/);
        assert.match(cabecera, /<span class="sr-only" data-i18n="buy_coffee">/);
    });

    test('ya no hay un botón flotante que la cabecera tape', () => {
        assert.ok(!HTML.includes('buy-coffee-btn'));
        assert.ok(!leer('frontend/src/styles.css').includes('buy-coffee-btn'));
    });
});

describe('buscadores en el teclado del móvil', () => {
    const HTML = leer('frontend/index.html');
    const CSS = leer('frontend/src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

    /**
     * Algunos teclados de Android componen la palabra para sugerir y, en un
     * campo web, pierden la cuenta: había que pulsar borrar tantas veces como
     * letras antes de que se borrara nada. type="search" hace que Chromium no
     * pida autocorrección al teclado, y autocomplete="off", que no sugiera.
     */
    test('los dos buscadores piden al teclado que no componga ni sugiera', () => {
        for (const id of ['youtubeUrl', 'plSearchInput']) {
            const etiqueta = new RegExp(`<input type="search" id="${id}"[^>]*>`).exec(HTML)?.[0];
            assert.ok(etiqueta, `${id} no es type="search"`);
            for (const atributo of ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"', 'enterkeyhint="search"']) {
                assert.ok(etiqueta.includes(atributo), `${id} sin ${atributo}`);
            }
        }
    });

    test('sin la X ni el aspecto propios del navegador', () => {
        assert.match(CSS, /\.url-input::-webkit-search-cancel-button[^{]*\{[^}]*display:\s*none/);
    });

    test('mientras se escribe en el móvil, la barra de pestañas no flota sobre el teclado', () => {
        assert.match(CSS, /body:has\([^{]*input\[type="search"\][^{]*:focus\) :is\(\.bottom-nav, \.player-bar\)\s*\{[^}]*visibility:\s*hidden/);
    });

    test('las etiquetas de la barra inferior se traducen', () => {
        const i = HTML.indexOf('<nav class="bottom-nav');
        const nav = HTML.slice(i, HTML.indexOf('</nav>', i));
        for (const clave of ['nav_home', 'nav_library', 'nav_playlists']) assert.match(nav, new RegExp(`data-i18n="${clave}"`));
    });
});

describe('teclado en la APK', () => {
    /**
     * Con captureInput, Capacitor cambiaba la conexión real de Chromium con el
     * teclado por una simulada con su propia copia del texto. Teclados como el
     * de vivo borraban primero de esa copia invisible: había que pulsar borrar
     * tantas veces como letras escritas antes de que se borrara nada. En la
     * web no pasaba, porque la web no usa esa opción.
     */
    test('la APK deja que Chromium hable directamente con el teclado', () => {
        const config = leer('mobile/capacitor.config.ts').replace(/\/\/.*$/gm, '');
        assert.ok(!/captureInput\s*:\s*true/.test(config), 'captureInput vuelve a estar activado');
    });
});
