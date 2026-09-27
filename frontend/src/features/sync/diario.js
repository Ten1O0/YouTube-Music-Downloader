/**
 * El diario de cambios locales (plan 13, T5): lo que cambia en este
 * dispositivo y aún no ha llegado a la cuenta.
 *
 * No hay un enganche por cada sitio que toca la biblioteca o las listas (son
 * muchos): los dos únicos puntos por donde pasa todo, saveLibrary y
 * savePlaylists, comparan el antes y el después y apuntan aquí la diferencia.
 * Al aplicar lo que llega de la cuenta, se hace «en silencio» para no volver a
 * mandarlo.
 *
 * Cada cambio lleva la cuenta a la que pertenece, como los favoritos del plan
 * 01: en un dispositivo compartido, lo hecho sobre la biblioteca de una cuenta
 * no se sube a otra.
 */

import { StorageModule } from '../../core/storage.js';
import { diferenciasBiblioteca, diferenciasListas } from './fusion.js';

export const CLAVE_PENDIENTE = 'sync_pendiente';

let silencio = 0;
let dueno = async () => null;
const oyentes = new Set();
let cola = Promise.resolve();

/** Quién es el dueño de los cambios que se hagan ahora (lo fija sync.js). */
export function configurarDueno(fn) {
    dueno = fn;
}

/** Avisa de cada cambio apuntado (sync.js programa el envío). */
export function alApuntar(fn) {
    oyentes.add(fn);
}

/** Ejecuta `fn` sin apuntar nada: para aplicar lo que llega de la cuenta. */
export async function enSilencio(fn) {
    silencio++;
    try { return await fn(); } finally { silencio--; }
}

export const enSilencioAhora = () => silencio > 0;

export const claveDe = (c) => (c.tipo === 'ajustes' ? 'ajustes' : `${c.tipo}:${c.datos.videoId ?? c.datos.id}`);

export async function leerPendientes() {
    try { return (await StorageModule.get(CLAVE_PENDIENTE)) || []; } catch { return []; }
}

export async function guardarPendientes(lista) {
    await StorageModule.set(CLAVE_PENDIENTE, lista);
}

/**
 * Apunta cambios. De cada canción, lista o ajustes solo cuenta el último:
 * poner y luego borrar es borrar. En orden, uno detrás de otro.
 */
export function apuntar(cambios) {
    if (silencio || !cambios?.length) return Promise.resolve();
    cola = cola.then(async () => {
        const owner = await dueno();
        const nuevas = new Set(cambios.map((c) => `${owner}|${claveDe(c)}`));
        const lista = (await leerPendientes()).filter((c) => !nuevas.has(`${c.owner}|${claveDe(c)}`));
        // cid: para quitar de la cola exactamente lo enviado, aunque se apunte más mientras tanto
        const cid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        await guardarPendientes([...lista, ...cambios.map((c) => ({ ...c, owner, cid: cid() }))]);
        for (const fn of oyentes) fn();
    }).catch((e) => console.error('[Sincronización] No se pudo apuntar el cambio:', e));
    return cola;
}

/** Lo llaman saveLibrary y savePlaylists con lo que había y lo que queda. */
export function anotarBiblioteca(antes, despues) {
    if (silencio) return;
    apuntar(diferenciasBiblioteca(antes, despues));
}

export function anotarListas(antes, despues) {
    if (silencio) return;
    apuntar(diferenciasListas(antes, despues));
}

/** Espera a que se hayan guardado los cambios apuntados hasta ahora. */
export const apuntados = () => cola;
