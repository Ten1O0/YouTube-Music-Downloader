/**
 * Almacenamiento persistente del cliente (IndexedDB con localStorage de
 * respaldo) y la migración de los datos antiguos.
 */

import { completarMetadatos } from './titles.js';


// Qué hacer cuando el navegador se queda sin espacio para el audio. Lo decide
// main.js: el almacenamiento no sabe de avisos ni de idiomas.
let avisarSinEspacio = () => {};
export function alQuedarseSinEspacio(fn) { avisarSinEspacio = fn; }

// Quién quiere saber que se ha escrito una clave (plan 19, T3): las copias en
// memoria de la biblioteca y de las listas se descartan si escribe otro
// (una migración, la recuperación de la APK…)
const oyentes = new Map(); // clave → Set(fn)
export function alEscribir(clave, fn) {
    if (!oyentes.has(clave)) oyentes.set(clave, new Set());
    oyentes.get(clave).add(fn);
    return () => oyentes.get(clave)?.delete(fn);
}
function avisarEscritura(clave, valor) {
    for (const fn of oyentes.get(clave) ?? []) {
        try { fn(valor); } catch (e) { console.warn('[Storage] Oyente de escritura:', e); }
    }
}

// ========================================
// StorageModule — Unified IndexedDB Handler
// ========================================
export const StorageModule = (() => {
    const DB_NAME = 'YTMusicDB';
    const STORE_NAME = 'kv_store';
    const BLOB_STORE = 'audio_blobs';
    // Registro de escuchas (plan 11, T5): una fila por escucha, para «Tu año en música»
    const LISTENS_STORE = 'escuchas';
    const DB_VERSION = 3;

    let dbPromise = null;

    function initDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Ambos stores se crean solo si faltan: nunca se borran datos existentes
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
                if (!db.objectStoreNames.contains(BLOB_STORE)) {
                    db.createObjectStore(BLOB_STORE);
                }
                if (!db.objectStoreNames.contains(LISTENS_STORE)) {
                    const escuchas = db.createObjectStore(LISTENS_STORE, { keyPath: 'id', autoIncrement: true });
                    escuchas.createIndex('t', 't');
                }
            };

            // Otra pestaña con la versión anterior abierta impide subir de versión:
            // se avisa en vez de quedarse esperando para siempre
            request.onblocked = () => {
                console.warn('[Storage] Otra pestaña de la app está abierta con una versión anterior');
                globalThis.dispatchEvent?.(new CustomEvent('almacenamiento-bloqueado'));
            };

            request.onsuccess = (e) => {
                const db = e.target.result;
                // Y a la inversa: si una pestaña nueva necesita subir de versión,
                // esta cierra su conexión para no bloquearla
                db.onversionchange = () => { db.close(); dbPromise = null; };
                resolve(db);
            };
            request.onerror = (e) => reject(e.target.error);
        });
        return dbPromise;
    }

    /**
     * Ejecuta una operación sobre un store y resuelve cuando la transacción
     * ha confirmado (no solo cuando la petición ha tenido éxito), para que una
     * escritura de blob no se dé por buena antes de estar en disco.
     */
    async function runTx(storeName, mode, fn) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            let result;
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = fn(store);
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    const get = (key) => runTx(STORE_NAME, 'readonly', (s) => s.get(key));
    const set = async (key, value) => {
        const r = await runTx(STORE_NAME, 'readwrite', (s) => s.put(value, key));
        avisarEscritura(key, value);
        return r;
    };
    const remove = async (key) => {
        const r = await runTx(STORE_NAME, 'readwrite', (s) => s.delete(key));
        avisarEscritura(key, undefined);
        return r;
    };

    const getBlob = (id) => runTx(BLOB_STORE, 'readonly', (s) => s.get(id));
    const deleteBlob = (id) => runTx(BLOB_STORE, 'readwrite', (s) => s.delete(id));

    /** Guarda un blob de audio. Devuelve true/false en vez de lanzar. */
    async function putBlob(id, blob) {
        try {
            await runTx(BLOB_STORE, 'readwrite', (s) => s.put(blob, id));
            return true;
        } catch (err) {
            if (err?.name === 'QuotaExceededError') {
                console.error('[Storage] Cuota de almacenamiento agotada:', err);
                avisarSinEspacio();
            } else {
                console.error('[Storage] Error guardando el audio:', err);
            }
            return false;
        }
    }

    /** Pide almacenamiento persistente para que el navegador no desaloje la biblioteca. */
    async function requestPersistence() {
        try {
            if (!navigator.storage?.persist) return;
            if (await navigator.storage.persisted()) return;
            await navigator.storage.persist();
        } catch (e) {
            console.debug('[Storage] persist() no disponible:', e);
        }
    }

    /** Registro de escuchas: añadir devuelve el id, para poder actualizar sus segundos. */
    const anotarEscucha = (entrada) => runTx(LISTENS_STORE, 'readwrite', (s) => s.add(entrada));
    async function actualizarEscucha(id, cambios) {
        const actual = await runTx(LISTENS_STORE, 'readonly', (s) => s.get(id));
        if (actual) await runTx(LISTENS_STORE, 'readwrite', (s) => s.put({ ...actual, ...cambios }));
    }
    const leerEscuchas = () => runTx(LISTENS_STORE, 'readonly', (s) => s.getAll());

    return { get, set, remove, getBlob, putBlob, deleteBlob, requestPersistence, anotarEscucha, actualizarEscucha, leerEscuchas };
})();

export const MIGRATION_FLAG_KEY = 'ytdl_migrated_v1';

/** Clave de identidad de un elemento guardado (canción, favorito, playlist). */
export function storageItemKey(item) {
    return item?.id || item?.videoId || item?.src || null;
}

/**
 * Fusiona dos arrays por clave conservando SIEMPRE lo que ya está en IndexedDB.
 * Sustituye a la comparación por longitud, que podía resucitar elementos borrados.
 */
export function mergeStoredArrays(existing, incoming) {
    const byKey = new Map();
    const unkeyed = [];

    for (const item of existing) {
        const k = storageItemKey(item);
        if (k) byKey.set(k, item);
        else unkeyed.push(item);
    }
    for (const item of incoming) {
        const k = storageItemKey(item);
        if (!k) continue; // sin clave no se puede deduplicar: se descarta lo entrante
        if (!byKey.has(k)) byKey.set(k, item);
    }

    return [...byKey.values(), ...unkeyed];
}

export async function migrateStorage() {
    // La migración es un evento único, no algo de cada arranque.
    try {
        if (await StorageModule.get(MIGRATION_FLAG_KEY)) return;
    } catch (e) {
        console.debug('[Migration] No se pudo leer el flag de migración:', e);
    }

    const keys = ['ytdl_library', 'ytdl_playlists', 'favorites', 'downloadHistory'];
    for (const key of keys) {
        try {
            const localVal = localStorage.getItem(key);
            if (!localVal) continue;

            const parsed = JSON.parse(localVal);
            const existing = await StorageModule.get(key);

            let merged;
            if (!existing) {
                merged = parsed;
            } else if (Array.isArray(existing) && Array.isArray(parsed)) {
                merged = mergeStoredArrays(existing, parsed);
            } else {
                merged = existing; // tipos no fusionables: gana lo que ya hay en IndexedDB
            }

            await StorageModule.set(key, merged);
            // Solo se borra de localStorage cuando la escritura ha confirmado
            localStorage.removeItem(key);
        } catch (e) {
            console.error(`[Migration] Error migrando ${key}:`, e);
        }
    }

    try {
        await StorageModule.set(MIGRATION_FLAG_KEY, new Date().toISOString());
    } catch (e) {
        console.debug('[Migration] No se pudo marcar la migración como completada:', e);
    }
}

export const TITLES_FLAG_KEY = 'ytdl_titles_v1';

/**
 * Artista y canción para lo que ya estaba en la biblioteca (plan 11, T3).
 *
 * Una sola vez (bandera ytdl_titles_v1). Recorre la biblioteca y las copias de
 * cada canción dentro de las listas, en memoria, y guarda una vez por clave: con
 * cientos de canciones, guardar una a una sería lento. Lo editado a mano no se
 * toca, y volver a ejecutarla no cambia nada.
 */
export async function migrarTitulos() {
    try {
        if (await StorageModule.get(TITLES_FLAG_KEY)) return;

        const biblioteca = await StorageModule.get('ytdl_library');
        if (Array.isArray(biblioteca) && biblioteca.length) {
            await StorageModule.set('ytdl_library', biblioteca.map(completarMetadatos));
        }

        const listas = await StorageModule.get('ytdl_playlists');
        if (Array.isArray(listas) && listas.length) {
            await StorageModule.set('ytdl_playlists', listas.map((pl) => (
                Array.isArray(pl?.songs) ? { ...pl, songs: pl.songs.map(completarMetadatos) } : pl)));
        }

        await StorageModule.set(TITLES_FLAG_KEY, new Date().toISOString());
    } catch (e) {
        // Sin migrar, todo se sigue viendo con el título de YouTube: se reintenta en el próximo arranque
        console.error('[Titles] No se pudo completar artista y canción:', e);
    }
}
