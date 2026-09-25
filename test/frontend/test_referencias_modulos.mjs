/**
 * Funciones de un módulo llamadas desde fuera sin su prefijo.
 *
 * Una refactorización sacó ayudantes de dentro de PlaylistModule y
 * PlayerModule al nivel superior, pero sus llamadas siguieron siendo
 * `getPlaylists()`, `deletePlaylist()`… sin `PlaylistModule.` delante. Dentro
 * del módulo esas funciones existen; fuera, no. Resultado: las playlists
 * creadas por el usuario no se abrían, no se podían borrar ni quitarles
 * canciones, y cada «añadir a la cola» lanzaba un error. `node --check` no lo
 * ve porque la sintaxis es correcta: el fallo solo aparece al ejecutar.
 *
 * El análisis es deliberadamente sencillo y se apoya en el estilo del
 * fichero: cada módulo es `const XModule = (() => {` en la columna 0 y se
 * cierra con `})();` en la columna 0, y sus funciones van indentadas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FUENTE = fs.readFileSync(path.join(RAIZ, 'app.js'), 'utf8');

/** Quita comentarios de línea y cadenas sencillas, para no contar texto. */
function soloCodigo(linea) {
    return linea
        .replace(/\/\/.*$/, '')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** Rangos de líneas [inicio, fin] de cada módulo IIFE y sus funciones internas. */
export function modulos(fuente) {
    const lineas = fuente.split('\n');
    const res = [];
    for (let i = 0; i < lineas.length; i++) {
        const m = /^const (\w+) = \((?:async )?\(\) => \{/.exec(lineas[i]);
        if (!m) continue;
        let fin = i + 1;
        while (fin < lineas.length && !/^\}\)\(\);/.test(lineas[fin])) fin++;
        const internas = new Set();
        for (let j = i + 1; j < fin; j++) {
            const f = /^ {4}(?:async )?function (\w+)/.exec(lineas[j]);
            if (f) internas.add(f[1]);
        }
        res.push({ nombre: m[1], inicio: i, fin, internas });
    }
    return res;
}

/** Llamadas `nombre(` fuera de los módulos a funciones que solo existen dentro. */
export function llamadasHuerfanas(fuente) {
    const lineas = fuente.split('\n');
    const mods = modulos(fuente);
    const dentro = new Set();
    for (const m of mods) for (let i = m.inicio; i <= m.fin; i++) dentro.add(i);

    // Lo que sí existe fuera: funciones y variables declaradas a cualquier nivel
    const fuera = new Set();
    lineas.forEach((l, i) => {
        if (dentro.has(i)) return;
        for (const d of l.matchAll(/(?:function\s+|(?:const|let|var|class)\s+)(\w+)/g)) fuera.add(d[1]);
        for (const d of l.matchAll(/import\s*\{([^}]*)\}/g)) {
            d[1].split(',').forEach(p => fuera.add(p.trim().split(/\s+as\s+/).pop()));
        }
    });

    const internas = new Map();
    for (const m of mods) for (const n of m.internas) if (!fuera.has(n)) internas.set(n, m.nombre);

    const rotas = [];
    lineas.forEach((l, i) => {
        if (dentro.has(i)) return;
        const codigo = soloCodigo(l);
        for (const c of codigo.matchAll(/(^|[^.\w$])(\w+)\s*\(/g)) {
            const nombre = c[2];
            if (!internas.has(nombre)) continue;
            // Definición de método en un objeto literal, no una llamada
            if (new RegExp(`^\\s*(?:async\\s+)?${nombre}\\s*\\([^)]*\\)\\s*\\{`).test(codigo)) continue;
            rotas.push({ linea: i + 1, nombre, modulo: internas.get(nombre) });
        }
    });
    return rotas;
}

describe('llamadas a funciones internas de un módulo', () => {
    test('fuera de un módulo, sus funciones se llaman con su prefijo', () => {
        const rotas = llamadasHuerfanas(FUENTE);
        const detalle = rotas.map(r => `  app.js:${r.linea}  ${r.nombre}() → ${r.modulo}.${r.nombre}()`).join('\n');
        assert.equal(rotas.length, 0, `Llamadas que fallan al ejecutarse:\n${detalle}`);
    });

    test('el análisis encuentra los módulos principales', () => {
        const nombres = modulos(FUENTE).map(m => m.nombre);
        for (const n of ['PlayerModule', 'PlaylistModule', 'LibraryModule', 'NavigationModule']) {
            assert.ok(nombres.includes(n), `no reconoce ${n}: el test no estaría mirando nada`);
        }
    });

    test('detecta el defecto tal y como apareció', () => {
        const ejemplo = [
            'async function resolvePlaylistDetails(id) {',
            '    const playlists = await getPlaylists();',
            '    return playlists.find(p => p.id === id);',
            '}',
            'const PlaylistModule = (() => {',
            '    async function getPlaylists() { return []; }',
            '    return { getPlaylists };',
            '})();',
        ].join('\n');
        assert.deepEqual(llamadasHuerfanas(ejemplo), [{ linea: 2, nombre: 'getPlaylists', modulo: 'PlaylistModule' }]);
    });
});

describe('guardar la descarga en la APK', () => {
    test('el nombre del fichero se define antes de usarse', () => {
        const i = FUENTE.indexOf('async function saveToNativeCapacitor(');
        const cuerpo = FUENTE.slice(i, FUENTE.indexOf('\n}\n', i));
        const define = cuerpo.indexOf('const fileName = ');
        assert.ok(define > 0, 'fileName no se define: guardar en la APK lanza un ReferenceError');
        assert.ok(define < cuerpo.indexOf('${fileName}'), 'fileName se usa antes de definirse');
        assert.match(cuerpo, /extFromResponse\(response\)/, 'la extensión debe salir de lo que devolvió el servidor');
    });
});
