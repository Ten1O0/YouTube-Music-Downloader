/**
 * Aviso de nueva versión de la APK y avisos flotantes.
 *
 * La APK lleva la web dentro y no se actualiza al desplegar: sin este aviso,
 * quien solo usa la app no sabría nunca que hay una versión nueva.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hayActualizacion, novedadesEn, ESPERA_TRAS_DESCARTAR_MS } from '../../src/ui/app-update.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const REMOTA = { versionCode: 6, versionName: '1.3.0', novedades: { es: ['Una', 'Dos'], en: ['One'] } };
const AHORA = 1_800_000_000_000;

describe('¿hay que avisar?', () => {
    test('solo si la del servidor es más nueva que la instalada', () => {
        assert.equal(hayActualizacion({ instalada: 5, remota: REMOTA, ahora: AHORA }), true);
        assert.equal(hayActualizacion({ instalada: 6, remota: REMOTA, ahora: AHORA }), false);
        assert.equal(hayActualizacion({ instalada: 7, remota: REMOTA, ahora: AHORA }), false);
    });

    test('la versión instalada llega como texto desde Android', () => {
        assert.equal(hayActualizacion({ instalada: '5', remota: REMOTA, ahora: AHORA }), true);
    });

    test('«Ahora no» aparca esa versión unos días, no para siempre', () => {
        const descartada = { versionCode: 6, fecha: AHORA - 1000 };
        assert.equal(hayActualizacion({ instalada: 5, remota: REMOTA, descartada, ahora: AHORA }), false);
        assert.equal(hayActualizacion({ instalada: 5, remota: REMOTA, descartada, ahora: AHORA + ESPERA_TRAS_DESCARTAR_MS }), true);
    });

    test('aparcar una versión no silencia la siguiente', () => {
        const descartada = { versionCode: 5, fecha: AHORA };
        assert.equal(hayActualizacion({ instalada: 4, remota: REMOTA, descartada, ahora: AHORA }), true);
    });

    test('una respuesta rara del servidor no avisa', () => {
        for (const remota of [null, {}, { versionCode: 'x' }]) {
            assert.equal(hayActualizacion({ instalada: 5, remota, ahora: AHORA }), false);
        }
    });

    test('novedades en el idioma de la interfaz, o en castellano', () => {
        assert.deepEqual(novedadesEn(REMOTA, 'en'), ['One']);
        assert.deepEqual(novedadesEn(REMOTA, 'zh'), ['Una', 'Dos']);
        assert.deepEqual(novedadesEn({}, 'es'), []);
    });
});

describe('versión publicada', () => {
    const publicada = JSON.parse(leer('public/app-version.json'));

    test('coincide con la de Gradle: si no, la APK recién publicada se avisaría a sí misma o no avisaría nunca', () => {
        const gradle = leer('mobile/android/app/build.gradle');
        assert.equal(publicada.versionCode, Number(/versionCode (\d+)/.exec(gradle)[1]));
        assert.equal(publicada.versionName, /versionName "([^"]+)"/.exec(gradle)[1]);
        assert.match(leer('download.html'), new RegExp(`Versión ${publicada.versionName.replaceAll('.', '\\.')} `));
    });

    test('trae novedades en los seis idiomas', () => {
        for (const lang of ['es', 'en', 'fr', 'de', 'pt', 'zh']) {
            assert.ok(publicada.novedades[lang]?.length >= 1, `sin novedades en ${lang}`);
        }
    });
});

describe('integración', () => {
    const APP = leer('app.js');
    const HTML = leer('index.html');

    test('solo en la APK y sin conexión no pregunta', () => {
        assert.match(APP, /if \(!IS_NATIVE \|\| !plugin\?\.getInfo \|\| navigator\.onLine === false\) return;/);
    });

    test('la hoja del aviso existe y se traduce', () => {
        assert.match(HTML, /<div id="appUpdateModal" class="auth-modal hidden">/);
        assert.match(APP, /update_download:/);
    });

    test('añadir a la cola se avisa desde cualquier vista', () => {
        const i = APP.indexOf('function addToNextQueue(song)');
        assert.match(APP.slice(i, i + 300), /avisar\(i18n\.t\('queue_next'\)\)/);
    });

    test('ningún modal queda dentro de otro (el de permisos estuvo dentro del de la APK y no se veía)', () => {
        const pila = [];
        const anidados = [];
        for (const m of HTML.matchAll(/<div\b([^>]*)>|<\/div>/g)) {
            if (m[0] === '</div>') { pila.pop(); continue; }
            const id = /\bid="([^"]+)"/.exec(m[1])?.[1] ?? null;
            const esModal = /class="auth-modal[\s"]/.test(m[1]);
            if (esModal && pila.some(p => p.modal)) anidados.push(id);
            pila.push({ id, modal: esModal });
        }
        assert.deepEqual(anidados, []);
        assert.equal(pila.length, 0, 'hay un <div> sin cerrar');
    });
});

describe('idioma de los textos generados desde JavaScript', () => {
    test('hay un solo gestor de idioma, y es el que se inicializa', () => {
        const APP = leer('app.js');
        assert.equal((APP.match(/new LanguageManager\(\)/g) || []).length, 1, 'un segundo gestor deja los avisos en castellano');
        assert.match(APP, /await i18n\.init\(\);/);
    });
});

describe('importar audios del móvil', () => {
    const APP = leer('app.js');
    const i = APP.indexOf('function setupNativeImporter()');
    const importador = APP.slice(i, APP.indexOf('\nfunction setupDownloadModal', i));

    test('el progreso va en la isla o el banner, visible desde cualquier vista', () => {
        assert.match(importador, /queueManager\.add\(tarea, \{/);
        assert.match(importador, /queueManager\.update\(tarea, Math\.round\(\(processedCount \/ files\.length\) \* 100\)/);
        assert.match(importador, /queueManager\.complete\(tarea, \{ textoHecho: i18n\.t\('hud_imported'/);
        assert.ok(!/showStatus\(i18n\.t\('import_progress'/.test(importador), 'vuelve el progreso escondido en Inicio');
    });

    test('cancelar una importación no llama al servidor: la para en local', () => {
        assert.match(importador, /alCancelar: \(\) => \{ cancelada = true; \}/);
        assert.match(APP, /if \(item\.alCancelar\) \{\s*item\.alCancelar\(\);/);
    });

    test('la isla dice «Importando» y «6 importadas», no «Descargando» ni «Descargada»', () => {
        const hud = leer('src/ui/downloads-hud.js');
        assert.match(hud, /unica\?\.info\?\.verbo/);
        assert.match(hud, /item\?\.info\?\.textoHecho \|\| t\('hud_done'\)/);
    });
});

describe('enlaces externos en la APK', () => {
    test('se abren en el navegador del sistema, no dentro de la app', () => {
        assert.match(leer('app.js'), /navegador\.open\(\{ url: enlace\.href \}\)/);
        assert.ok(!/allowNavigation:[^\n]*buymeacoffee/.test(leer('mobile/capacitor.config.ts')),
            'con buymeacoffee en allowNavigation, el café sustituye a la app y el atrás no vuelve');
    });

    test('los títulos de Biblioteca y Playlists se traducen', () => {
        const HTML = leer('index.html');
        assert.match(HTML, /<h2 class="view-title" data-i18n="library_title">/);
        assert.match(HTML, /<h2 class="view-title" data-i18n="playlists_title">/);
    });
});
