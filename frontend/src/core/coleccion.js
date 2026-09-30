/**
 * Una colección guardada (la biblioteca, las listas) con su copia en memoria
 * (plan 19, T3).
 *
 * Antes cada lectura iba a IndexedDB y deserializaba la colección entera: la
 * biblioteca se leía en 32 sitios, y cada guardado la leía otra vez para saber
 * qué había cambiado (plan 13). Ahora se lee una vez; después, memoria.
 *
 * - `get()` devuelve una copia: quien la reciba puede cambiarla sin tocar la de
 *   memoria (muchos sitios la modifican antes de guardarla; si tocaran la
 *   original, el diario de la sincronización ya no vería la diferencia).
 * - `set(lista)` escribe en IndexedDB y, **solo si se escribió**, actualiza la
 *   memoria. Devuelve cómo estaba antes, para el diario, sin volver a leer.
 * - Si otro escribe la misma clave (una migración, la recuperación de la APK)
 *   o la cambia otra pestaña, la copia se descarta y se relee.
 */

import { alEscribir, StorageModule } from './storage.js';

const CANAL = 'ytdl-colecciones';

/** Copia de una colección: cada elemento y, si los tiene, sus `songs` (las listas). */
export function copiar(lista) {
    return (lista ?? []).map((x) => {
        if (!x || typeof x !== 'object') return x;
        const c = { ...x };
        if (Array.isArray(x.songs)) c.songs = x.songs.map((s) => (s && typeof s === 'object' ? { ...s } : s));
        return c;
    });
}

/**
 * @param {string} clave  la de StorageModule
 * @param {{ normalizar?: (lista) => lista, almacen?, canal? }} [o]  almacen y canal, para las pruebas
 */
export function crearColeccion(clave, { normalizar = (x) => x, almacen = StorageModule, canal } = {}) {
    let memoria = null;   // la copia privada; nunca sale sin copiar
    let leyendo = null;   // una sola lectura aunque la pidan varios a la vez
    let propia = null;    // lo último que escribió esta colección
    let version = 0;      // descarta una lectura en curso si mientras tanto se escribe

    const difusion = canal !== undefined ? canal
        : (typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel(CANAL) : null);
    difusion?.addEventListener?.('message', (e) => { if (e.data === clave) invalidar(); });
    (almacen.alEscribir ?? alEscribir)(clave, (valor) => { if (valor !== propia) invalidar(); });

    function invalidar() {
        memoria = null;
        leyendo = null;
        version++;
    }

    async function leer() {
        if (memoria) return memoria;
        if (!leyendo) {
            const v = version;
            leyendo = (async () => {
                let datos = [];
                try { datos = (await almacen.get(clave)) || []; } catch { datos = []; }
                const lista = normalizar(Array.isArray(datos) ? datos : []);
                if (v === version) memoria = lista;
                return lista;
            })().finally(() => { if (v === version) leyendo = null; });
        }
        return leyendo;
    }

    return {
        async get() {
            return copiar(await leer());
        },
        /** Escribe y devuelve la colección tal como estaba antes (para el diario). */
        async set(lista) {
            const antes = await leer();
            const nueva = copiar(lista);
            propia = lista;
            await almacen.set(clave, lista); // si falla, la memoria no cambia
            version++;
            memoria = nueva;
            leyendo = null;
            difusion?.postMessage?.(clave);
            return antes;
        },
        invalidar,
    };
}

/**
 * Una tarea que se agrupa: se ejecuta unos segundos después de la última
 * petición, y en el acto al pasar a segundo plano o cerrar (la copia de
 * seguridad nativa, que antes se escribía entera en cada toque).
 */
export function agrupada(fn, ms = 3000) {
    let temporizador = null;
    let pendiente = null;
    const ejecutar = () => {
        clearTimeout(temporizador);
        temporizador = null;
        if (pendiente === null) return;
        const valor = pendiente;
        pendiente = null;
        try { fn(valor); } catch (e) { console.warn('[Agrupada]', e); }
    };
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ejecutar(); });
        globalThis.addEventListener?.('pagehide', ejecutar);
    }
    const pedir = (valor) => {
        pendiente = valor;
        clearTimeout(temporizador);
        temporizador = setTimeout(ejecutar, ms);
    };
    pedir.ya = ejecutar;
    return pedir;
}
