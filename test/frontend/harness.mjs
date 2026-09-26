/**
 * Arnés de carga del cliente en un navegador simulado.
 *
 * Para los tests que necesitan la app entera y con estado propio: favoritos,
 * historial, sincronización, idioma. Cada loadApp() arranca un mundo nuevo
 * (localStorage, fetch, Capacitor) y ejecuta en él el cliente completo, desde
 * frontend/src/main.js, en un contexto `vm`.
 *
 * El cliente son módulos ES con ciclos entre ellos (reproductor, biblioteca y
 * listas se llaman entre sí), y vm solo entiende scripts. Así que se empaqueta
 * una vez con Vite, igual que en producción, en un script que devuelve las
 * exportaciones de todos los módulos. Los tests de funciones puras no pasan
 * por aquí: importan su módulo directamente.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'vite';
import { SRC, ficherosCliente } from './fuentes.mjs';

const ENTRADA = 'virtual:arnes';

/**
 * Empaqueta main.js y reexporta todo lo que exporta cada módulo. Un nombre
 * exportado por dos módulos queda fuera (Rollup no sabe cuál elegir), pero
 * ninguno de los que usan los tests está repetido.
 */
async function empaquetar() {
    const modulos = ficherosCliente().filter((f) => fs.readFileSync(f, 'utf8').includes('export '));
    const entrada = [`import ${JSON.stringify(path.join(SRC, 'main.js'))};`,
        ...modulos.map((f) => `export * from ${JSON.stringify(f)};`)].join('\n');
    const salida = await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [{
            name: 'arnes',
            enforce: 'pre',
            resolveId: (id) => (id.endsWith(ENTRADA) ? '\0arnes' : null),
            load: (id) => (id === '\0arnes' ? entrada : null),
        }],
        build: {
            write: false,
            minify: false,
            lib: { entry: ENTRADA, formats: ['iife'], name: '__T', fileName: 'arnes' },
            rollupOptions: { onwarn: () => {} },
        },
    });
    return salida[0].output[0].code;
}

const CODIGO = await empaquetar();

/** Elemento DOM permisivo: acepta cualquier operación sin romper. */
function fakeElement(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(),
        style: {},
        dataset: {},
        children: [],
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        disabled: false,
        src: '',
        href: '',
        title: '',
        className: '',
        classList: {
            _set: new Set(),
            add(...c) { c.forEach(x => this._set.add(x)); },
            remove(...c) { c.forEach(x => this._set.delete(x)); },
            toggle(c, force) {
                const on = force ?? !this._set.has(c);
                if (on) this._set.add(c); else this._set.delete(c);
                return on;
            },
            contains(c) { return this._set.has(c); },
        },
        addEventListener() { },
        removeEventListener() { },
        dispatchEvent() { return true; },
        appendChild(c) { this.children.push(c); return c; },
        removeChild() { },
        remove() { },
        click() { },
        focus() { },
        blur() { },
        closest() { return fakeElement(); },
        querySelector() { return fakeElement(); },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20 }; },
        scrollIntoView() { },
        setAttribute() { },
        getAttribute() { return null; },
        insertAdjacentHTML() { },
        get offsetHeight() { return 20; },
    };
    return el;
}

/** localStorage en memoria. */
function fakeLocalStorage() {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        key: (i) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
        _dump: () => Object.fromEntries(store),
    };
}

/**
 * Arranca el cliente en un navegador simulado nuevo y devuelve sus
 * exportaciones más el contexto, para inspeccionar y manipular el entorno
 * desde los tests.
 */
export function loadApp({ isNative = false } = {}) {

    const objectUrls = { created: [], revoked: [] };
    const localStorage = fakeLocalStorage();

    const doc = {
        // 'loading' impide que se disparen los DOMContentLoaded al cargar
        readyState: 'loading',
        body: fakeElement('body'),
        documentElement: fakeElement('html'),
        getElementById: () => fakeElement(),
        querySelector: () => fakeElement(),
        querySelectorAll: () => [],
        createElement: (tag) => fakeElement(tag),
        addEventListener: () => { },
        removeEventListener: () => { },
        dispatchEvent: () => true,
        cookie: '',
    };

    const sandbox = {
        console: { log() { }, warn() { }, error() { }, info() { }, debug() { } },
        document: doc,
        navigator: {
            userAgent: isNative ? 'Capacitor/Android' : 'node-test-runner',
            storage: { persist: async () => true, persisted: async () => true },
            mediaSession: {},
            serviceWorker: { register: async () => ({}), getRegistrations: async () => [] },
        },
        location: { protocol: 'https:', href: 'https://music.dannarita.es/', hostname: 'music.dannarita.es' },
        localStorage,
        sessionStorage: fakeLocalStorage(),
        indexedDB: { open: () => ({ addEventListener() { } }) },
        fetch: async () => ({ ok: true, status: 200, json: async () => ({}), blob: async () => new Blob([]) }),
        setTimeout, clearTimeout, setInterval, clearInterval,
        queueMicrotask, Promise, Date, Math, JSON, RegExp, Error, Map, Set, Array, Object, String, Number, Boolean,
        Blob, TextEncoder, TextDecoder, URLSearchParams,
        // atob del navegador lanza InvalidCharacterError con base64 inválido;
        // Buffer.from() es permisivo y lo ignoraría, ocultando bugs reales.
        atob: (s) => {
            const limpio = String(s).replace(/\s/g, '');
            if (limpio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(limpio)) {
                throw new Error('InvalidCharacterError: base64 no válido');
            }
            return Buffer.from(limpio, 'base64').toString('binary');
        },
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
        FileReader: class { readAsDataURL() { this.result = 'data:,'; this.onloadend?.(); } },
        Audio: class { constructor() { this.paused = true; } play() { return Promise.resolve(); } load() { } addEventListener() { } },
        Image: class { },
        Event: class { constructor(t) { this.type = t; } },
        CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
        alert: () => { },
        confirm: () => true,
        addEventListener: () => { },
        removeEventListener: () => { },
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        performance: { now: () => Date.now() },
        // Los modales se observan para llevar la pila y el foco (plan 09, T17)
        MutationObserver: class { observe() { } disconnect() { } },
    };

    // URL con los helpers de object URLs instrumentados
    sandbox.URL = class extends URL {
        static createObjectURL(blob) {
            const url = `blob:node/${objectUrls.created.length}`;
            objectUrls.created.push(url);
            return url;
        }
        static revokeObjectURL(url) { objectUrls.revoked.push(url); }
    };

    if (isNative) {
        sandbox.Capacitor = {
            isNative: true,
            platform: 'android',
            Plugins: {},
            convertFileSrc: (uri) => `capacitor://localhost/_file_${uri}`,
        };
    }

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;

    const context = vm.createContext(sandbox);

    vm.runInContext(CODIGO, context, { filename: 'cliente.js' });

    return {
        api: context.__T,
        context,
        objectUrls,
        localStorage,
        document: doc,
    };
}

/** Carga el cliente una sola vez y lo reutiliza (para tests que no mutan estado). */
let cache = null;
export function app() {
    cache ??= loadApp();
    return cache;
}

/**
 * Traslada un valor del contexto `vm` al realm de los tests.
 *
 * Los objetos creados dentro del sandbox tienen sus propios Array.prototype y
 * Object.prototype, así que `assert.deepStrictEqual` los rechaza aunque su
 * contenido sea idéntico. Un ida y vuelta por JSON los normaliza.
 */
export const plain = (valor) => JSON.parse(JSON.stringify(valor));
