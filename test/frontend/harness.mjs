/**
 * Arnés de carga para app.js — sin dependencias externas.
 *
 * app.js no exporta nada: es un fichero de 7.000 líneas con IIFEs y acceso al
 * DOM en el nivel superior. Para poder testear sus funciones puras se carga en
 * un contexto `vm` con un navegador simulado mínimo, y se le añade un epílogo
 * que publica las funciones que queremos probar.
 *
 * Esto es un apaño consciente: cuando app.js se parta en módulos ES (plan 08),
 * este arnés desaparece y los tests importarán directamente.
 *
 * Sólo usa APIs integradas de Node (>=18): vm, fs, node:test, node:assert.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.resolve(__dirname, '../../app.js');

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
 * Carga app.js y devuelve sus funciones globales más el contexto,
 * para poder inspeccionar y manipular el entorno simulado desde los tests.
 */
export function loadApp({ isNative = false } = {}) {
    const source = fs.readFileSync(APP_JS, 'utf8');

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

    // Epílogo: publica las funciones del ámbito del script, que de otro modo
    // no serían accesibles desde fuera (const/function de nivel superior).
    const NOMBRES = [
        'sanitizeFilename', 'formatDuration', 'extractVideoId',
        'isValidInput', 'isUrl', 'isPlaylistUrl',
        'arrayBufferToBase64', 'base64ToBlob',
        'storageItemKey', 'mergeStoredArrays', 'generateSongId',
        'isSongDuplicate', 'resolveStreamSrc',
        'buildMediaSessionArtwork', 'validateArtworkUrlForNative',
        'getIsNative', 'getApiBase',
        'TRANSLATIONS', 'SUPPORTED_LANGS', 'FALLBACK_LANG', 'detectBrowserLang',
        'LanguageManager', 'extFromResponse', 'AUDIO_EXTENSIONS_CLIENT',
        'resolveProgressText', 'AUDIO_FORMAT_KEY',
        'StorageModule', 'AudioUrlCache', 'FavoritesModule',
        'IDB_SRC_PREFIX', 'YOUTUBE_URL_PATTERN',
        'HISTORY_STORAGE_KEY', 'FAVORITES_STORAGE_KEY', 'MIGRATION_FLAG_KEY',
        'migrateStorage', 'repairLegacyBlobEntries', 'deleteStoredAudio',
    ];
    const epilogo = `
;globalThis.__T = {};
${NOMBRES.map(n => `try { globalThis.__T[${JSON.stringify(n)}] = ${n}; } catch (e) {}`).join('\n')}
`;

    vm.runInContext(source + epilogo, context, { filename: 'app.js' });

    return {
        api: context.__T,
        context,
        objectUrls,
        localStorage,
        document: doc,
    };
}

/** Carga app.js una sola vez y la reutiliza (los tests puros no mutan estado). */
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
