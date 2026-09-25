/**
 * El arnés resuelve los `import` de app.js (plan 09, T1).
 *
 * Sin esto, el primer import que se añade a app.js deja sin cargar todos los
 * tests de frontend: vm.runInContext solo entiende scripts. Aquí se fija que
 * la traducción a script respeta alias, dependencias entre módulos y
 * duplicados, que son justo los casos en los que un apaño así se equivoca.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { resolverImports } from './harness.mjs';

function proyecto(ficheros) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-'));
    for (const [nombre, contenido] of Object.entries(ficheros)) {
        const ruta = path.join(dir, nombre);
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        fs.writeFileSync(ruta, contenido);
    }
    return dir;
}

function ejecutar(dir, principal = 'app.js') {
    const fichero = path.join(dir, principal);
    const codigo = resolverImports(fs.readFileSync(fichero, 'utf8'), fichero);
    const ctx = vm.createContext({});
    vm.runInContext(`${codigo}\n;globalThis.__r = resultado;`, ctx);
    return { codigo, resultado: ctx.__r };
}

describe('resolverImports', () => {
    test('sustituye un import por las exportaciones del módulo', () => {
        const dir = proyecto({
            'src/a.js': 'export function doble(x) { return x * 2; }\nexport const BASE = 10;',
            'app.js': "import { doble, BASE } from './src/a.js';\nconst resultado = doble(BASE);",
        });
        assert.equal(ejecutar(dir).resultado, 20);
    });

    test('respeta los alias', () => {
        const dir = proyecto({
            'src/a.js': 'export const valor = 7;',
            'app.js': "import { valor as siete } from './src/a.js';\nconst resultado = siete;",
        });
        assert.equal(ejecutar(dir).resultado, 7);
    });

    test('resuelve módulos que importan a otros, en orden', () => {
        const dir = proyecto({
            'src/base.js': 'export class Contador { constructor() { this.n = 1; } }',
            'src/uso.js': "import { Contador } from './base.js';\nexport function nuevo() { return new Contador().n + 1; }",
            'app.js': "import { nuevo } from './src/uso.js';\nconst resultado = nuevo();",
        });
        assert.equal(ejecutar(dir).resultado, 2);
    });

    test('un módulo importado dos veces se integra una sola vez', () => {
        const dir = proyecto({
            'src/comun.js': 'export let veces = 0;\nveces++;',
            'src/uno.js': "import { veces } from './comun.js';\nexport const a = veces;",
            'app.js': "import { a } from './src/uno.js';\nimport { veces } from './src/comun.js';\nconst resultado = [a, veces];",
        });
        const { codigo, resultado } = ejecutar(dir);
        assert.deepEqual([...resultado], [1, 1]);
        assert.equal(codigo.match(/veces\+\+/g).length, 1, 'el módulo común se duplicó');
    });

    test('las funciones asíncronas también se exportan', async () => {
        const dir = proyecto({
            'src/a.js': 'export async function tarde() { return 3; }',
            'app.js': "import { tarde } from './src/a.js';\nconst resultado = tarde();",
        });
        assert.equal(await ejecutar(dir).resultado, 3);
    });
});
