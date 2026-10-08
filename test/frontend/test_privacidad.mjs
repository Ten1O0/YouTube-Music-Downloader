/**
 * La política de privacidad (plan 21, T6): lo que promete tiene que ser verdad
 * en el código, en los dos idiomas, y la página tiene que existir.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { leer } from './fuentes.mjs';
import { CORREO, IDIOMAS, PLAZOS, TEXTOS, elegirIdioma } from '../../frontend/src/pages/privacidad-textos.js';

const BD = leer('backend/database.py');
const constante = (nombre) => Number(BD.match(new RegExp(`^${nombre} = (\\d+)`, 'm'))?.[1]);

describe('lo que dice, el código lo cumple', () => {
    test('los plazos son los del servidor', () => {
        assert.equal(PLAZOS.eventos, constante('DIAS_EVENTOS'));
        assert.equal(PLAZOS.lapidas, constante('DIAS_LAPIDAS'));
        assert.equal(PLAZOS.papelera, constante('DIAS_PAPELERA'));
    });

    test('«Borrar mi cuenta» existe: el botón en Ajustes y su ruta', () => {
        assert.match(leer('frontend/index.html'), /id="ajustesBorrarBtn"/);
        assert.match(leer('backend/server.py'), /@app\.route\('\/api\/account', methods=\['DELETE'\]\)/);
    });

    test('la página se compila y se sirve en /privacidad', () => {
        assert.match(leer('vite.config.js'), /privacidad: resolve\(__dirname, 'frontend\/privacidad\.html'\)/);
        assert.match(leer('backend/server.py'), /@app\.route\('\/privacidad'/);
    });

    test('se enlaza desde Ajustes y desde la página de descarga', () => {
        assert.match(leer('frontend/index.html'), /href="https:\/\/music\.dannarita\.es\/privacidad"/);
        assert.match(leer('frontend/download.html'), /href="\/privacidad"/);
    });
});

describe('los textos', () => {
    test('castellano e inglés, con los mismos apartados y párrafos', () => {
        assert.deepEqual(IDIOMAS, ['es', 'en']);
        const forma = (l) => TEXTOS[l].apartados.map(([, parrafos]) => parrafos.length);
        assert.deepEqual(forma('en'), forma('es'));
        assert.deepEqual(Object.keys(TEXTOS.en).sort(), Object.keys(TEXTOS.es).sort());
    });

    test('dicen quién es el responsable y cómo contactar, y los plazos', () => {
        for (const l of IDIOMAS) {
            const todo = JSON.stringify(TEXTOS[l]);
            assert.ok(todo.includes(CORREO), `${l}: falta el correo`);
            for (const dias of Object.values(PLAZOS)) assert.ok(todo.includes(String(dias)), `${l}: falta el plazo de ${dias} días`);
        }
    });

    test('sin huecos por rellenar', () => {
        // En mayúsculas: «todo» es una palabra del texto
        assert.doesNotMatch(JSON.stringify(TEXTOS), /\{\{|\bTODO\b|\bXXX\b|\[(?:correo|nombre)\]/);
    });

    test('el idioma: el pedido, el guardado o el del navegador; si no, inglés', () => {
        assert.equal(elegirIdioma({ parametro: 'es' }), 'es');
        assert.equal(elegirIdioma({ guardado: 'en', navegador: ['es-ES'] }), 'en');
        assert.equal(elegirIdioma({ navegador: ['es-MX'] }), 'es');
        assert.equal(elegirIdioma({ navegador: ['fr-FR', 'de'] }), 'en');
        assert.equal(elegirIdioma({ parametro: 'zz', guardado: 'fr' }), 'en');
    });
});
