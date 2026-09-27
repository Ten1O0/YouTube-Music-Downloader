/**
 * La estructura del cliente tras el plan 08.
 *
 * app.js tenía 8.600 líneas en un solo ámbito: cualquier cosa podía usar
 * cualquier otra y no se veía quién dependía de quién. Estas reglas evitan que
 * la organización en módulos vuelva a degradarse poco a poco.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RAIZ, SRC, ficherosCliente } from './fuentes.mjs';

const espree = createRequire(import.meta.url)('espree');

const relativa = (f) => path.relative(SRC, f).split(path.sep).join('/');
const importsDe = (f) => [...fs.readFileSync(f, 'utf8').matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)]
    .map((m) => relativa(path.resolve(path.dirname(f), m[1])));

describe('estructura del cliente', () => {
    test('app.js ya no existe y el arranque está en main.js', () => {
        assert.ok(!fs.existsSync(path.join(RAIZ, 'app.js')));
        assert.ok(!fs.existsSync(path.join(SRC, 'legacy')));
        assert.ok(fs.existsSync(path.join(SRC, 'main.js')));
    });

    test('la base no depende de las funciones de la app', () => {
        // config, core, i18n, ui y native están por debajo de features/: si una
        // pieza de base importa una función, el grafo vuelve a enredarse entero
        const BASE = ['config/', 'core/', 'i18n/', 'ui/', 'native/'];
        const malos = [];
        for (const f of ficherosCliente()) {
            const r = relativa(f);
            if (!BASE.some((b) => r.startsWith(b))) continue;
            for (const dep of importsDe(f)) if (dep.startsWith('features/')) malos.push(`${r} → ${dep}`);
        }
        assert.deepEqual(malos, []);
    });

    test('ningún módulo vuelve a ser un monolito', () => {
        const grandes = ficherosCliente()
            .map((f) => [relativa(f), fs.readFileSync(f, 'utf8').split('\n').length])
            .filter(([, n]) => n > 600);
        assert.deepEqual(grandes, [], 'partir antes de que crezca más');
    });

    test('una sola forma de saber dónde se ejecuta y a qué servidor llamar', () => {
        for (const f of ficherosCliente()) {
            const codigo = fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
            assert.ok(!/\b(API_URL|API_BASE|IS_NATIVE|getIsNative|getApiBase)\b/.test(codigo), `${relativa(f)} usa una detección antigua`);
        }
    });

    test('sin comprobar si existe un módulo importado', () => {
        // Con import, el módulo existe siempre: la comprobación solo ensucia
        const MODULOS = 'NavigationModule|PlayerModule|LibraryModule|PlaylistModule|FavoritesModule|LyricsModule|StorageModule|showStatus|auth|i18n';
        const patron = new RegExp(`typeof (${MODULOS}) [!=]== '(undefined|function)'`);
        for (const f of ficherosCliente()) {
            assert.ok(!patron.test(fs.readFileSync(f, 'utf8')), `${relativa(f)} comprueba un import`);
        }
    });

    test('ningún HTML con datos se construye sin html`…` (plan 10, T1)', () => {
        const sueltas = [];
        for (const f of ficherosCliente()) {
            const codigo = fs.readFileSync(f, 'utf8');
            const ast = espree.parse(codigo, { ecmaVersion: 2024, sourceType: 'module', loc: true, comment: true });
            const permitidas = new Set(ast.comments
                .filter((c) => c.value.includes('eslint-disable-next-line no-restricted-syntax'))
                .map((c) => c.loc.end.line + 1));
            (function recorrer(nodo, padre) {
                if (!nodo || typeof nodo.type !== 'string') return;
                if (nodo.type === 'TemplateLiteral' && padre?.type !== 'TaggedTemplateExpression'
                    && nodo.expressions.length && nodo.quasis.some((q) => /<[a-zA-Z/!]/.test(q.value.raw))
                    && !permitidas.has(nodo.loc.start.line)) {
                    sueltas.push(`${relativa(f)}:${nodo.loc.start.line}`);
                }
                for (const [clave, hijo] of Object.entries(nodo)) {
                    if (clave === 'loc') continue;
                    if (Array.isArray(hijo)) hijo.forEach((h) => recorrer(h, nodo));
                    else if (hijo && typeof hijo.type === 'string') recorrer(hijo, nodo);
                }
            })(ast, null);
        }
        assert.deepEqual(sueltas, []);
    });
});
