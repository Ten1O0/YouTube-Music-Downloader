/**
 * Ningún texto fijo en castellano en la interfaz (plan 21, T4).
 *
 * Un visitante en inglés veía la app a medio traducir: títulos de botones,
 * avisos y el progreso de las descargas escritos a mano en castellano. Lo que
 * se ve pasa por i18n: en index.html, con data-i18n, data-i18n-title,
 * data-i18n-placeholder o data-i18n-aria; en el código, con i18n.t().
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SRC, ficherosCliente, leer } from './fuentes.mjs';
import es from '../../frontend/src/i18n/translations/es.js';

const HTML = leer('frontend/index.html');
/** Un texto que alguien lee: al menos una palabra de tres letras. */
const ES_TEXTO = (valor) => /[a-záéíóúñ]{3}/i.test(valor);
const relativa = (f) => path.relative(SRC, f).split(path.sep).join('/');

/** Etiquetas de apertura de index.html, con sus atributos y su línea. */
function etiquetas() {
    const salida = [];
    for (const m of HTML.matchAll(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?\/?>/g)) {
        const atributos = Object.fromEntries([...(m[2] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
        salida.push({ etiqueta: m[1], atributos, linea: HTML.slice(0, m.index).split('\n').length });
    }
    return salida;
}

describe('index.html', () => {
    const TRADUCE = { title: 'data-i18n-title', placeholder: 'data-i18n-placeholder', 'aria-label': 'data-i18n-aria' };

    test('cada title, placeholder y aria-label con texto tiene su traducción', () => {
        const sueltos = [];
        for (const { atributos, linea } of etiquetas()) {
            for (const [atributo, traduccion] of Object.entries(TRADUCE)) {
                const valor = atributos[atributo];
                if (valor && ES_TEXTO(valor) && !(traduccion in atributos)) sueltos.push(`línea ${linea}: ${atributo}="${valor}"`);
            }
        }
        assert.deepEqual(sueltos, [], 'añade el data-i18n-* que le toca');
    });

    test('un texto con huecos ({anio}, {n}…) nunca se pinta sin rellenar (plan 23, T5)', () => {
        // Con solo data-i18n, el cambio de idioma lo pinta tal cual: «Tu {anio} en música».
        // Hay que darle los valores: data-i18n-params en el HTML, o traducirCon desde el código
        const codigo = ficherosCliente().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
        const conValores = new Set([...codigo.matchAll(/traducirCon\(\s*(?:\$|document\.getElementById)\(\s*['"]([\w-]+)['"]\s*\)/g)].map((m) => m[1]));
        const sinRellenar = [];
        for (const { atributos, linea } of etiquetas()) {
            const clave = atributos['data-i18n'];
            if (!clave || !/\{\w+\}/.test(es[clave] ?? '')) continue;
            if ('data-i18n-params' in atributos || conValores.has(atributos.id)) continue;
            sinRellenar.push(`línea ${linea}: ${clave}${atributos.id ? ` (#${atributos.id})` : ''}`);
        }
        assert.deepEqual(sinRellenar, [], 'rellénalo con traducirCon(el, clave, { … }) o data-i18n-params');
    });

    test('las claves de los data-i18n existen', () => {
        const desconocidas = [];
        for (const { atributos, linea } of etiquetas()) {
            for (const atributo of ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria']) {
                const clave = atributos[atributo];
                if (clave && !(clave in es)) desconocidas.push(`línea ${linea}: ${atributo}="${clave}"`);
            }
        }
        assert.deepEqual(desconocidas, []);
    });
});

describe('el código', () => {
    const fuentes = ficherosCliente()
        .filter((f) => !relativa(f).startsWith('i18n/translations/'))
        .map((f) => ({ fichero: relativa(f), codigo: fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '') }));

    /** Las líneas de cada fichero que casan con `patron` y llevan texto. */
    function buscar(patron) {
        const hallados = [];
        for (const { fichero, codigo } of fuentes) {
            for (const m of codigo.matchAll(patron)) {
                if (ES_TEXTO(m[1])) hallados.push(`${fichero}:${codigo.slice(0, m.index).split('\n').length} ${m[0].trim().slice(0, 80)}`);
            }
        }
        return hallados;
    }

    test('ningún title ni aria-label fijo en las plantillas', () => {
        assert.deepEqual(buscar(/\b(?:title|aria-label)="([^"$]*)"/g), [], 'usa ${i18n.t(…)}');
    });

    test('ningún .title, .placeholder ni aria-label fijo puesto desde el código', () => {
        assert.deepEqual([
            // Un ternario de textos fijos sí; uno dentro de i18n.t(…), no
            ...buscar(/\.(?:title|placeholder)\s*=\s*(?:[^;\n(]*\?\s*)?['"`]([^'"`$]*)['"`]/g),
            ...buscar(/setAttribute\(\s*['"](?:title|aria-label|placeholder)['"]\s*,\s*['"`]([^'"`$]*)['"`]/g),
        ], []);
    });

    test('showStatus, avisar y updateProgress no reciben textos fijos', () => {
        assert.deepEqual([
            ...buscar(/\b(?:showStatus|avisar)\(\s*['"`]([^'"`]*)['"`]/g),
            ...buscar(/\bupdateProgress\([^,()]+,\s*(?:[^,()]*\?\s*)?['"`]([^'"`]*)['"`]/g),
        ], [], 'usa i18n.t(…)');
    });

    test('las fechas, en el idioma de la interfaz', () => {
        const fijas = fuentes.filter(({ codigo }) => /toLocale(?:Date|Time)?String\(\s*['"]es/.test(codigo)).map(({ fichero }) => fichero);
        assert.deepEqual(fijas, [], 'usa i18n.currentLang');
    });
});
