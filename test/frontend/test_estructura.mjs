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

    test('ningún nombre exportado nuevo se repite entre módulos (plan 16)', () => {
        // El arnés de estos tests (harness.mjs) reexporta todos los módulos
        // juntos, y un nombre que exportan dos se descarta sin avisar: el test
        // que lo usa falla con un «no es una función» que no dice por qué.
        // Estos ya estaban repetidos y ningún test del arnés los usa; si se
        // renombra uno, se quita de aquí
        const YA_REPETIDOS = {
            avisar: ['ui/haptics.js', 'ui/toast.js'],
            claveDe: ['core/miniaturas.js', 'features/sync/diario.js'],
            leerPendientes: ['features/download/pendientes.js', 'features/sync/diario.js'],
            MAX_BYTES: ['features/import/parse.js', 'features/library/importar-audio.js', 'features/player/loudness-backfill.js'],
            normalizarTitulo: ['features/sync/identidad.js', 'features/sync/validar.js'],
        };
        const dondeSale = new Map();
        for (const f of ficherosCliente()) {
            const ast = espree.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2024, sourceType: 'module' });
            for (const nodo of ast.body) {
                if (nodo.type !== 'ExportNamedDeclaration') continue;
                const nombres = [
                    ...(nodo.declaration?.declarations?.map((d) => d.id.name) ?? []),
                    ...(nodo.declaration?.id ? [nodo.declaration.id.name] : []),
                    ...nodo.specifiers.map((s) => s.exported.name),
                ];
                for (const nombre of nombres) dondeSale.set(nombre, [...(dondeSale.get(nombre) ?? []), relativa(f)]);
            }
        }
        const repetidos = Object.fromEntries([...dondeSale].filter(([, donde]) => donde.length > 1).map(([n, donde]) => [n, donde.sort()]));
        assert.deepEqual(repetidos, YA_REPETIDOS, 'un nombre exportado desde dos módulos: renombra el nuevo');
    });
});

/**
 * Lo que se descarga y se analiza antes de ver nada (plan 19, T16), compilado
 * como en producción: la entrada, lo que importa sin `import()` y su CSS. Lo
 * que se carga al usarlo (T11) no cuenta. Un módulo nuevo que se importe desde
 * el arranque en lugar de cargarse aparte, o una dependencia pesada, lo
 * dispara. Si crece con motivo, se sube el límite a conciencia.
 */
describe('presupuesto de tamaño del arranque (plan 19, T16)', () => {
    const MAX_JS_KB = 290;
    const MAX_CSS_KB = 140;

    test(`JS inicial ≤ ${MAX_JS_KB} KB y CSS inicial ≤ ${MAX_CSS_KB} KB`, async () => {
        const { build } = await import('vite');
        const salida = await build({
            configFile: false,
            logLevel: 'silent',
            root: path.join(RAIZ, 'frontend'),
            build: {
                write: false,
                assetsInlineLimit: (fichero) => (fichero.endsWith('.woff2') ? false : undefined),
                rollupOptions: { input: path.join(RAIZ, 'frontend', 'index.html') },
            },
        });
        const piezas = new Map(salida.output.map((p) => [p.fileName, p]));
        const entrada = salida.output.find((p) => p.type === 'chunk' && p.isEntry);
        const iniciales = new Set();
        (function recorrer(nombre) {
            if (iniciales.has(nombre)) return;
            iniciales.add(nombre);
            for (const dep of piezas.get(nombre).imports) recorrer(dep);
        })(entrada.fileName);

        const kb = (bytes) => Math.round(bytes / 1024);
        const js = [...iniciales].reduce((n, f) => n + Buffer.byteLength(piezas.get(f).code), 0);
        const hojas = new Set([...iniciales].flatMap((f) => [...(piezas.get(f).viteMetadata?.importedCss ?? [])]));
        const css = [...hojas].reduce((n, f) => n + Buffer.byteLength(piezas.get(f).source), 0);
        assert.ok(kb(js) <= MAX_JS_KB, `JS inicial: ${kb(js)} KB (${[...iniciales].join(', ')})`);
        assert.ok(kb(css) <= MAX_CSS_KB, `CSS inicial: ${kb(css)} KB`);
    });
});
