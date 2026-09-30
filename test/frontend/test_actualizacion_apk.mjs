/**
 * Aviso de nueva versión de la APK y avisos flotantes.
 *
 * La APK lleva la web dentro y no se actualiza al desplegar: sin este aviso,
 * quien solo usa la app no sabría nunca que hay una versión nueva.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hayActualizacion, novedadesDesde, novedadesEn, ESPERA_TRAS_DESCARTAR_MS } from '../../frontend/src/ui/app-update.js';
import { codigoCliente, leer } from './fuentes.mjs';

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

describe('novedades acumuladas', () => {
    const v = (versionCode, versionName, es) => ({ versionCode, versionName, fecha: '2026-09-27', novedades: { es, en: [`${versionName} en`] } });
    const REMOTA_H = { versionCode: 9, versionName: '1.4.0', novedades: { es: ['Última'] }, historial: [v(8, '1.3.0', ['Tres']), v(9, '1.4.0', ['Cuatro']), v(5, '1.2.0', ['Dos'])] };

    test('todas las versiones que faltan, de la más nueva a la más antigua', () => {
        assert.deepEqual(novedadesDesde(REMOTA_H, 5, 'es').map(x => [x.versionName, x.notas]), [['1.4.0', ['Cuatro']], ['1.3.0', ['Tres']]]);
        assert.deepEqual(novedadesDesde(REMOTA_H, '8', 'es').map(x => x.versionName), ['1.4.0']);
        assert.deepEqual(novedadesDesde(REMOTA_H, 1, 'es').map(x => x.versionName), ['1.4.0', '1.3.0', '1.2.0']);
    });

    test('en el idioma de la interfaz', () => {
        assert.deepEqual(novedadesDesde(REMOTA_H, 8, 'en')[0].notas, ['1.4.0 en']);
    });

    test('sin historial (un servidor anterior), solo lo de la última', () => {
        assert.deepEqual(novedadesDesde(REMOTA, 1, 'es'), [{ versionCode: 6, versionName: '1.3.0', fecha: '', notas: ['Una', 'Dos'] }]);
        assert.deepEqual(novedadesDesde({}, 1, 'es'), []);
    });

    test('sin saber la instalada, se enseña todo el historial', () => {
        assert.equal(novedadesDesde(REMOTA_H, undefined, 'es').length, 3);
    });
});

describe('versión publicada', () => {
    const fichero = JSON.parse(leer('frontend/public/app-version.json'));
    // El fichero guarda el historial; la última versión es la primera
    const publicada = fichero.historial[0];

    test('el historial va de la más nueva a la más antigua, sin versiones repetidas', () => {
        const codigos = fichero.historial.map(v => v.versionCode);
        assert.deepEqual(codigos, [...codigos].sort((a, b) => b - a));
        assert.equal(new Set(codigos).size, codigos.length);
    });

    test('coincide con la de Gradle: si no, la APK recién publicada se avisaría a sí misma o no avisaría nunca', () => {
        const gradle = leer('mobile/android/app/build.gradle');
        assert.equal(publicada.versionCode, Number(/versionCode (\d+)/.exec(gradle)[1]));
        assert.equal(publicada.versionName, /versionName "([^"]+)"/.exec(gradle)[1]);
        // La página de descarga no la escribe a mano: la pide al servidor, del mismo fichero
        assert.match(leer('frontend/src/pages/download.js'), /fetch\('\/api\/app\/version'/);
    });

    test('cada versión trae novedades en los seis idiomas, y breves', () => {
        for (const version of fichero.historial) {
            for (const lang of ['es', 'en', 'fr', 'de', 'pt', 'zh']) {
                assert.ok(version.novedades[lang]?.length >= 1, `${version.versionName} sin novedades en ${lang}`);
                for (const nota of version.novedades[lang]) assert.ok(nota.length <= 110, `${version.versionName} (${lang}) larga: ${nota}`);
            }
        }
    });
});

describe('integración', () => {
    const APP = codigoCliente();
    const HTML = leer('frontend/index.html');

    test('solo en la APK y sin conexión no pregunta', () => {
        assert.match(APP, /if \(!isNative\(\) \|\| !plugin\?\.getInfo \|\| navigator\.onLine === false\) return;/);
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
        const APP = codigoCliente();
        assert.equal((APP.match(/new LanguageManager\(\)/g) || []).length, 1, 'un segundo gestor deja los avisos en castellano');
        // Esperado, solo o junto a otras lecturas del arranque (plan 19, T12)
        assert.match(APP, /await i18n\.init\(\);|await Promise\.all\(\[[^\]]*\bi18n\.init\(\),[^\]]*\]\);/);
    });
});

describe('importar audios (en la APK y, desde el plan 20, también en la web)', () => {
    const APP = codigoCliente();
    const i = APP.indexOf('async function importarFicheros(');
    const importador = APP.slice(i, APP.indexOf('\nfunction initArrastrar', i));

    test('el progreso va en la isla o el banner, visible desde cualquier vista', () => {
        assert.match(importador, /queueManager\.add\(tarea, \{/);
        assert.match(importador, /queueManager\.update\(tarea, Math\.round\(\(hechos \/ total\) \* 100\)/);
        assert.match(importador, /queueManager\.complete\(tarea, \{ textoHecho: i18n\.t\('hud_imported'/);
        assert.ok(!/showStatus\(i18n\.t\('import_progress'/.test(importador), 'vuelve el progreso escondido en Inicio');
    });

    test('cancelar una importación no llama al servidor: la para en local', () => {
        assert.match(importador, /alCancelar: \(\) => \{ cancelada = true; \}/);
        assert.match(APP, /if \(item\.alCancelar\) \{\s*item\.alCancelar\(\);/);
    });

    test('la isla dice «Importando» y «6 importadas», no «Descargando» ni «Descargada»', () => {
        const hud = leer('frontend/src/ui/downloads-hud.js');
        assert.match(hud, /unica\?\.info\?\.verbo/);
        assert.match(hud, /item\?\.info\?\.textoHecho \|\| t\('hud_done'\)/);
    });
});

describe('enlaces externos en la APK', () => {
    test('se abren en el navegador del sistema, no dentro de la app', () => {
        assert.match(codigoCliente(), /navegador\.open\(\{ url: enlace\.href \}\)/);
        assert.ok(!/allowNavigation:[^\n]*buymeacoffee/.test(leer('mobile/capacitor.config.ts')),
            'con buymeacoffee en allowNavigation, el café sustituye a la app y el atrás no vuelve');
    });

    test('los títulos de Biblioteca y Playlists se traducen', () => {
        const HTML = leer('frontend/index.html');
        assert.match(HTML, /<h2 class="view-title" data-i18n="library_title">/);
        assert.match(HTML, /<h2 class="view-title" data-i18n="playlists_title">/);
    });
});
