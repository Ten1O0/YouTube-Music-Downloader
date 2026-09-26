/**
 * Estrategias de caché del Service Worker (plan 07, T5 y T6).
 *
 * El SW no se puede cargar entero fuera de un navegador (necesita `self`,
 * `caches` y los eventos de ciclo de vida), así que se prueba su **lógica de
 * decisión**, extraída a `elegirEstrategia()` justo para esto.
 *
 * Lo que estos tests fijan es la causa de que la gente viera código viejo tras
 * un despliegue: el HTML era cache-first y no llegaba hasta que alguien subía
 * CACHE_NAME a mano.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { leer, RAIZ } from './fuentes.mjs';

const FUENTE_SW = leer('frontend/public/sw.js');

/** Fuente sin comentarios, para no confundir una mención con un uso real. */
const CODIGO_SW = FUENTE_SW
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Carga sw.js en un contexto con los mínimos que necesita para evaluarse. */
function cargarSW() {
    const escuchadores = {};
    const sandbox = {
        self: {
            addEventListener: (tipo, fn) => { escuchadores[tipo] = fn; },
            skipWaiting: () => { },
            clients: { claim: async () => { } },
        },
        caches: {
            open: async () => ({ add: async () => { }, put: async () => { } }),
            keys: async () => [],
            delete: async () => true,
            match: async () => undefined,
        },
        fetch: async () => ({ status: 200, clone: () => ({}) }),
        Response: class { static error() { return { error: true }; } },
        URL,
        console: { warn() { }, log() { } },
        Promise, JSON, RegExp, Object, Array, Map, Set, String, Number,
    };
    sandbox.globalThis = sandbox;

    const contexto = vm.createContext(sandbox);
    vm.runInContext(FUENTE_SW, contexto, { filename: 'sw.js' });

    return { ...sandbox.__swInternals, escuchadores };
}

const sw = cargarSW();

/** Petición simulada. */
const peticion = (url, { method = 'GET', destination = '' } = {}) => ({
    url, method, destination,
});

const estrategiaDe = (url, opciones) =>
    sw.elegirEstrategia(peticion(url, opciones), new URL(url));

// ========================================
// Lo que nunca se cachea
// ========================================

describe('recursos que no se cachean', () => {
    test('las llamadas a la API pasan de largo', () => {
        assert.equal(estrategiaDe('https://music.dannarita.es/api/health'), 'ninguna');
        assert.equal(estrategiaDe('https://music.dannarita.es/api/progress/abc'), 'ninguna');
        assert.equal(estrategiaDe('https://music.dannarita.es/api/progress/stream/abc'), 'ninguna');
    });

    test('la página de descarga de la APK pasa de largo', () => {
        assert.equal(estrategiaDe('https://music.dannarita.es/download'), 'ninguna');
    });

    test('las miniaturas de YouTube no se cachean', () => {
        // Cambian solas y llenaban el almacenamiento sin aportar nada
        assert.equal(estrategiaDe('https://i.ytimg.com/vi/abc/mqdefault.jpg'), 'ninguna');
        assert.equal(estrategiaDe('https://img.youtube.com/vi/abc/0.jpg'), 'ninguna');
    });

    test('las banderas y los scripts de Google no se cachean', () => {
        assert.equal(estrategiaDe('https://flagcdn.com/24x18/es.png'), 'ninguna');
        assert.equal(estrategiaDe('https://accounts.google.com/gsi/client'), 'ninguna');
    });

    test('solo se atienden peticiones GET', () => {
        assert.equal(estrategiaDe('https://music.dannarita.es/', { method: 'POST' }), 'ninguna');
        assert.equal(estrategiaDe('https://music.dannarita.es/', { method: 'HEAD' }), 'ninguna');
    });
});

// ========================================
// HTML: red primero
// ========================================

describe('documentos HTML', () => {
    test('usan red primero, no caché primero', () => {
        // Este es EL cambio del plan: con cache-first, un despliegue no llegaba
        // al usuario hasta que alguien subía CACHE_NAME a mano.
        assert.equal(
            estrategiaDe('https://music.dannarita.es/', { destination: 'document' }),
            'red-primero'
        );
        assert.equal(
            estrategiaDe('https://music.dannarita.es/index.html', { destination: 'document' }),
            'red-primero'
        );
    });
});

// ========================================
// Assets con hash: caché primero
// ========================================

describe('assets con hash', () => {
    test('usan caché primero porque son inmutables', () => {
        assert.equal(estrategiaDe('https://music.dannarita.es/assets/main-CyxADYqD.js'), 'cache-primero');
        assert.equal(estrategiaDe('https://music.dannarita.es/assets/main-CEcLbPQA.css'), 'cache-primero');
    });

    test('un fichero sin hash fuera de /assets/ no es inmutable', () => {
        assert.equal(estrategiaDe('https://music.dannarita.es/app.js'), 'cache-y-revalida');
        assert.equal(estrategiaDe('https://music.dannarita.es/styles.css'), 'cache-y-revalida');
    });
});

// ========================================
// Fuentes: caché aparte
// ========================================

describe('fuentes', () => {
    test('van a su propia caché', () => {
        assert.equal(estrategiaDe('https://fonts.googleapis.com/css2?family=Inter'), 'fuentes');
        assert.equal(estrategiaDe('https://fonts.gstatic.com/s/inter/v1/x.woff2'), 'fuentes');
    });

    test('su caché es distinta de la principal', () => {
        assert.notEqual(sw.FONT_CACHE, sw.CACHE_NAME);
    });
});

// ========================================
// Versión de caché (T6)
// ========================================

describe('versión de la caché', () => {
    test('el nombre se construye con un marcador sustituible', () => {
        assert.ok(FUENTE_SW.includes('__SW_VERSION__'),
            'falta el marcador que sustituye el plugin de Vite');
        assert.ok(FUENTE_SW.includes('const CACHE_NAME = `ytdl-${SW_VERSION}`'));
    });

    test('sin sustituir sigue siendo un nombre válido', () => {
        assert.ok(sw.CACHE_NAME.startsWith('ytdl-'));
        assert.ok(sw.CACHE_NAME.length > 5);
    });

    test('vite.config.js hace la sustitución en el build', () => {
        const vite = fs.readFileSync(path.join(RAIZ, 'vite.config.js'), 'utf8');
        assert.ok(vite.includes('__SW_VERSION__'), 'el plugin no sustituye el marcador');
        assert.ok(vite.includes('closeBundle'),
            'debe ejecutarse en closeBundle: Vite copia public/ al final');
    });

    // Los scripts de deploy llevan credenciales y rutas del servidor, así que
    // están en .gitignore: en CI no existen. Se comprueban los que haya, que en
    // la práctica es "siempre" en la máquina desde la que se despliega, que es
    // justo donde importa acertar.
    const scriptsDeploy = ['deploy.sh', 'deploy.bat']
        .filter((f) => fs.existsSync(path.join(RAIZ, f)));

    test('los scripts de deploy suben dist/sw.js, no public/sw.js', { skip: scriptsDeploy.length === 0 && 'no hay scripts de deploy en esta copia (están en .gitignore)' }, () => {
        // public/sw.js lleva el marcador sin sustituir: subirlo dejaría la
        // caché sin invalidarse nunca entre despliegues.
        for (const fichero of scriptsDeploy) {
            const contenido = fs.readFileSync(path.join(RAIZ, fichero), 'utf8');
            assert.ok(contenido.includes('dist/sw.js') || contenido.includes('dist\\sw.js'),
                `${fichero} no prioriza dist/sw.js`);
        }
    });
});

// ========================================
// Instalación tolerante a fallos (D3)
// ========================================

describe('instalación', () => {
    test('no usa cache.addAll, que es atómico', () => {
        // addAll falla entera si un solo recurso falla, y había uno de un CDN.
        // Se mira el código sin comentarios: el porqué sí menciona addAll.
        assert.ok(!CODIGO_SW.includes('addAll('), 'sigue usando cache.addAll');
        assert.ok(CODIGO_SW.includes('allSettled'), 'no tolera fallos individuales');
    });

    test('la lista estática no incluye recursos de terceros', () => {
        for (const recurso of sw.STATIC_ASSETS) {
            assert.ok(!recurso.startsWith('http'),
                `${recurso} es externo y no debe estar en la instalación`);
        }
    });

    test('registra los escuchadores del ciclo de vida', () => {
        for (const evento of ['install', 'activate', 'fetch']) {
            assert.ok(sw.escuchadores[evento], `falta el escuchador de ${evento}`);
        }
    });
});
