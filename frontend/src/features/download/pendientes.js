/**
 * Descargas que sobreviven a cerrar la app (plan 14, T2).
 *
 * La cola de descargas vivía solo en memoria: si se cerraba la app a mitad de
 * un lote, el servidor terminaba el trabajo pero el cliente ya no sabía qué
 * recoger, y se descargaba para nada. Ahora cada descarga se apunta al empezar
 * y se quita al quedar guardada; al abrir la app se recoge lo que quedó.
 */

import { StorageModule } from '../../core/storage.js';

export const CLAVE_PENDIENTES = 'descargas_pendientes';

/** Más que lo que el servidor guarda lo terminado (24 h): pasado esto, ya no está. */
export const CADUCIDAD_MS = 25 * 60 * 60 * 1000;
/** Intentos de recoger una descarga que el servidor tiene pero no se pudo guardar. */
export const MAX_INTENTOS = 3;

/**
 * Qué hacer con una descarga pendiente, según lo que diga el servidor. Pura.
 * @param {object|null} progreso  respuesta de /api/progress/<id>, o null si no está (404, error)
 * @param {{ creada: number, intentos?: number }} entrada
 * @returns {'recoger'|'seguir'|'descartar'}
 */
export function decidirPendiente(progreso, entrada, ahora = Date.now()) {
    if (!entrada || ahora - Number(entrada.creada) > CADUCIDAD_MS) return 'descartar';
    if ((entrada.intentos ?? 0) >= MAX_INTENTOS) return 'descartar';
    switch (progreso?.status) {
        case 'complete': return 'recoger';
        case 'starting':
        case 'downloading': return 'seguir';
        default: return 'descartar'; // error, cancelada, o el servidor ya no la tiene
    }
}

let cola = Promise.resolve();
/** Las escrituras, de una en una: varias descargas en paralelo apuntan a la vez. */
function enOrden(fn) {
    cola = cola.then(fn, fn);
    return cola;
}

export async function leerPendientes() {
    try { return (await StorageModule.get(CLAVE_PENDIENTES)) || []; } catch { return []; }
}

/** Apunta una descarga recién empezada. `info` es lo necesario para terminarla después. */
export function apuntarPendiente({ downloadId, tipo = 'cancion', url = '', info = {}, total = 1 }) {
    return enOrden(async () => {
        const lista = (await leerPendientes()).filter((p) => p.downloadId !== downloadId);
        lista.push({ downloadId, tipo, url, info, total, creada: Date.now(), intentos: 0 });
        await StorageModule.set(CLAVE_PENDIENTES, lista);
    }).catch((e) => console.warn('[Pendientes] No se pudo apuntar:', e));
}

export function quitarPendiente(downloadId) {
    return enOrden(async () => {
        await StorageModule.set(CLAVE_PENDIENTES, (await leerPendientes()).filter((p) => p.downloadId !== downloadId));
    }).catch((e) => console.warn('[Pendientes] No se pudo quitar:', e));
}

/** Un intento más de recogerla (si falla guardarla, se reintenta en el próximo arranque). */
export function sumarIntento(downloadId) {
    return enOrden(async () => {
        await StorageModule.set(CLAVE_PENDIENTES, (await leerPendientes())
            .map((p) => (p.downloadId === downloadId ? { ...p, intentos: (p.intentos ?? 0) + 1 } : p)));
    }).catch(() => {});
}
