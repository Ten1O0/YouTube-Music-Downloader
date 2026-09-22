/**
 * Internacionalización y formato de audio en el cliente (plan 05).
 *
 * El test más valioso a largo plazo es el de paridad de claves: añadir una
 * clave y olvidarse de cinco idiomas es el fallo típico, y en la interfaz se
 * ve como un hueco en blanco que nadie sabe de dónde sale.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, loadApp } from './harness.mjs';

const { api } = app();
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ========================================
// Paridad entre idiomas
// ========================================

describe('TRANSLATIONS', () => {
    const idiomas = ['es', 'en', 'fr', 'de', 'pt', 'zh'];

    test('existen los seis idiomas', () => {
        for (const l of idiomas) {
            assert.ok(api.TRANSLATIONS[l], `falta el idioma ${l}`);
        }
    });

    test('todos tienen exactamente el mismo conjunto de claves', () => {
        const referencia = Object.keys(api.TRANSLATIONS.es).sort();

        for (const l of idiomas.filter(x => x !== 'es')) {
            const suyas = Object.keys(api.TRANSLATIONS[l]).sort();
            const faltan = referencia.filter(k => !suyas.includes(k));
            const sobran = suyas.filter(k => !referencia.includes(k));

            assert.deepEqual(faltan, [], `${l}: le faltan claves`);
            assert.deepEqual(sobran, [], `${l}: tiene claves que no están en es`);
        }
    });

    test('ninguna traducción está vacía', () => {
        for (const l of idiomas) {
            for (const [clave, valor] of Object.entries(api.TRANSLATIONS[l])) {
                assert.ok(String(valor).trim().length > 0, `${l}.${clave} está vacía`);
            }
        }
    });

    test('las claves con parámetros los llevan en todos los idiomas', () => {
        // Si una traducción pierde el {count}, el número desaparece del aviso
        const conParametros = Object.entries(api.TRANSLATIONS.es)
            .filter(([, v]) => /\{\w+\}/.test(v));

        assert.ok(conParametros.length > 5, 'se esperaban claves con parámetros');

        for (const [clave, valorEs] of conParametros) {
            const esperados = [...valorEs.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

            for (const l of ['en', 'fr', 'de', 'pt', 'zh']) {
                const valor = api.TRANSLATIONS[l][clave];
                const suyos = [...String(valor).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
                assert.deepEqual(suyos, esperados, `${l}.${clave}: parámetros distintos`);
            }
        }
    });
});

// ========================================
// Detección de idioma del navegador
// ========================================

describe('detectBrowserLang', () => {
    function conIdiomas(...langs) {
        const entorno = loadApp();
        entorno.context.navigator.languages = langs;
        return entorno.api.detectBrowserLang();
    }

    test('reconoce un idioma soportado', () => {
        assert.equal(conIdiomas('en-US'), 'en');
        assert.equal(conIdiomas('fr-FR'), 'fr');
        assert.equal(conIdiomas('zh-CN'), 'zh');
        assert.equal(conIdiomas('pt-BR'), 'pt');
    });

    test('ignora la región', () => {
        assert.equal(conIdiomas('de-AT'), 'de');
        assert.equal(conIdiomas('ES-mx'), 'es');
    });

    test('recorre la lista hasta encontrar uno soportado', () => {
        assert.equal(conIdiomas('ja-JP', 'ko-KR', 'fr-CA'), 'fr');
    });

    test('cae al castellano si no hay ninguno soportado', () => {
        assert.equal(conIdiomas('ja-JP', 'ko-KR'), 'es');
        assert.equal(conIdiomas(), 'es');
    });

    test('no rompe con una lista vacía', () => {
        const entorno = loadApp();
        entorno.context.navigator.languages = [];
        entorno.context.navigator.language = '';
        assert.equal(entorno.api.detectBrowserLang(), 'es');
    });
});

// ========================================
// Extensión derivada de la respuesta (T3)
// ========================================

describe('extFromResponse', () => {
    const respuestaCon = (cd) => ({ headers: { get: () => cd } });

    test('lee la extensión de Content-Disposition', () => {
        assert.equal(api.extFromResponse(respuestaCon('attachment; filename="Cancion.mp3"')), '.mp3');
        assert.equal(api.extFromResponse(respuestaCon('attachment; filename="Cancion.m4a"')), '.m4a');
    });

    test('acepta el formato codificado UTF-8', () => {
        assert.equal(
            api.extFromResponse(respuestaCon("attachment; filename*=UTF-8''Can%C3%A7%C3%B3.mp3")),
            '.mp3'
        );
    });

    test('cae al respaldo si la cabecera no está', () => {
        assert.equal(api.extFromResponse(respuestaCon('')), '.m4a');
        assert.equal(api.extFromResponse(null), '.m4a');
    });

    test('cae al respaldo ante una extensión desconocida', () => {
        assert.equal(api.extFromResponse(respuestaCon('attachment; filename="x.exe"')), '.m4a');
        assert.equal(api.extFromResponse(respuestaCon('attachment; filename="sin-extension"')), '.m4a');
    });

    test('respeta el respaldo que se le indique', () => {
        assert.equal(api.extFromResponse(respuestaCon(''), '.mp3'), '.mp3');
    });

    test('es insensible a mayúsculas', () => {
        assert.equal(api.extFromResponse(respuestaCon('attachment; filename="X.MP3"')), '.mp3');
    });
});

describe('AUDIO_EXTENSIONS_CLIENT', () => {
    test('cubre los dos formatos que la aplicación produce', () => {
        assert.ok(api.AUDIO_EXTENSIONS_CLIENT.includes('.m4a'));
        assert.ok(api.AUDIO_EXTENSIONS_CLIENT.includes('.mp3'));
    });

    test('el recolector de basura y el escáner usan la misma constante', () => {
        // Si divergen, los mp3 huérfanos se acumulan para siempre en el móvil
        const fuente = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');
        const sueltos = fuente.match(/endsWith\('\.m4a'\)/g) || [];
        assert.equal(sueltos.length, 0, 'queda una comprobación cableada a .m4a');
    });
});

// ========================================
// Respaldo de los mensajes del servidor (T6)
// ========================================

describe('resolveProgressText', () => {
    test('usa el mensaje literal cuando no hay código', () => {
        assert.equal(api.resolveProgressText({ message: 'Descargando...' }), 'Descargando...');
    });

    test('traduce cuando el servidor manda un código', () => {
        const texto = api.resolveProgressText({ code: 'zipping', message: 'ignorado' });
        assert.equal(texto, api.TRANSLATIONS.es.srv_zipping);
    });

    test('interpola los parámetros del código', () => {
        const texto = api.resolveProgressText({ code: 'complete_n', params: { count: 7 } });
        assert.ok(texto.includes('7'), `sin interpolar: ${texto}`);
    });

    test('cae al mensaje si el código no tiene traducción', () => {
        const texto = api.resolveProgressText({ code: 'inventado_xyz', message: 'respaldo' });
        assert.equal(texto, 'respaldo');
    });

    test('no rompe con datos vacíos', () => {
        assert.equal(api.resolveProgressText({}), '');
        assert.equal(api.resolveProgressText(null), '');
    });
});

// ========================================
// Ningún literal en castellano en los avisos
// ========================================

describe('textos de la interfaz', () => {
    const fuente = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');

    test('no quedan showStatus con texto incrustado', () => {
        const literales = [...fuente.matchAll(/showStatus\((['`])([^'`]{3,})/g)]
            .map(m => m[2])
            .filter(s => !s.startsWith('${i18n'));

        assert.deepEqual(literales, [], 'avisos sin traducir');
    });

    test('no quedan ternarios de idioma cableados', () => {
        assert.equal((fuente.match(/currentLang === '\w+' \?/g) || []).length, 0);
    });

    test('las claves de formato existen', () => {
        for (const k of ['format_label', 'format_m4a', 'format_mp3', 'format_mp3_notice']) {
            assert.ok(api.TRANSLATIONS.es[k], `falta ${k}`);
        }
    });

    test('las claves de los mensajes del servidor existen', () => {
        for (const k of ['srv_starting', 'srv_zipping', 'srv_cancelled', 'srv_converting']) {
            assert.ok(api.TRANSLATIONS.es[k], `falta ${k}`);
        }
    });
});
