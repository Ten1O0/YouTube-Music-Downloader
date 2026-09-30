/**
 * Miniaturas fuera de la canción (plan 19, T2).
 *
 * La APK guardaba cada miniatura en base64 dentro de la canción (~25-30 KB):
 * con 300 canciones, la biblioteca pesaba megas, se leía y se guardaba entera
 * en cada cambio, y la lista de la biblioteca llevaba 18 MB de HTML. Ahora es un
 * fichero (`DATA/miniaturas/<clave>.<ext>`) y la canción guarda su dirección,
 * como ya hace con el audio. Es la misma imagen: nada cambia a la vista, y sigue
 * funcionando sin conexión.
 *
 * En la web las miniaturas ya eran enlaces: no cambia.
 */

import { isNative } from '../config/env.js';

export const CARPETA = 'miniaturas';
export const BANDERA = 'ytdl_miniaturas_v1';
const RE_VIDEO_ID = /^[\w-]{11}$/;

/** ¿Es una miniatura en base64 dentro de la canción? */
export const esIncrustada = (t) => typeof t === 'string' && t.startsWith('data:image/');

/** La miniatura de YouTube de un vídeo, o '' si el id no es de YouTube. */
export const miniaturaDeYoutube = (videoId) => (RE_VIDEO_ID.test(videoId ?? '') ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '');

/** La extensión del fichero según el tipo del base64. */
export function extensionDe(dataUrl) {
    const tipo = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(dataUrl ?? '')?.[1]?.toLowerCase();
    return { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }[tipo] ?? 'jpg';
}

/** Un nombre de fichero seguro y estable para una miniatura. */
export function claveDe(song, extra = '') {
    const base = RE_VIDEO_ID.test(song?.videoId ?? '') ? song.videoId : `s${hash(String(song?.src ?? song?.title ?? ''))}`;
    return `${base}${extra ? `_${String(extra).replace(/[^\w-]/g, '')}` : ''}`;
}

function hash(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

/** La miniatura de un favorito: siempre el enlace de YouTube (viaja a la cuenta; nunca un base64 ni un fichero de este móvil). */
export function miniaturaDeFavorito(miniatura, videoId) {
    if (typeof miniatura === 'string' && miniatura.startsWith('https://') && miniatura.length <= 500) return miniatura;
    return miniaturaDeYoutube(videoId);
}

const fs = () => globalThis.Capacitor?.Plugins?.Filesystem ?? null;

/**
 * Guarda una miniatura (base64) como fichero de la APK. Devuelve
 * { thumbnail, localThumbnailPath }, o null fuera de la APK. Comprueba que el
 * fichero existe y no está vacío antes de dar la dirección.
 */
export async function guardarMiniaturaNativa(clave, dataUrl) {
    const Filesystem = fs();
    if (!isNative() || !Filesystem || !esIncrustada(dataUrl)) return null;
    const path = `${CARPETA}/${clave}.${extensionDe(dataUrl)}`;
    try { await Filesystem.mkdir({ path: CARPETA, directory: 'DATA', recursive: true }); } catch { /* ya existe */ }
    await Filesystem.writeFile({ path, data: dataUrl.slice(dataUrl.indexOf(',') + 1), directory: 'DATA' });
    const info = await Filesystem.stat({ path, directory: 'DATA' });
    if (!(Number(info?.size) > 0)) throw new Error(`miniatura vacía: ${path}`);
    const { uri } = await Filesystem.getUri({ path, directory: 'DATA' });
    return { thumbnail: globalThis.Capacitor.convertFileSrc(uri), localThumbnailPath: path };
}

/** Borra el fichero de una miniatura guardada por la app (no hace nada con enlaces). */
export async function borrarMiniaturaNativa(song) {
    const Filesystem = fs();
    const path = song?.localThumbnailPath;
    if (!Filesystem || typeof path !== 'string' || !path.startsWith(`${CARPETA}/`)) return;
    try { await Filesystem.deleteFile({ path, directory: 'DATA' }); } catch { /* ya no estaba */ }
}

/**
 * Migración única: los base64 de la biblioteca y de las listas pasan a fichero;
 * los de los favoritos, al enlace de YouTube. Un base64 se sustituye **solo**
 * si su fichero se escribió y existe; si alguno falla, se queda como estaba y
 * la migración se repite en el próximo arranque (sin la bandera). Volver a
 * ejecutarla no cambia nada.
 *
 * En dos fases: primero se escriben los ficheros (lo lento, segundos con
 * cientos de canciones) y después se vuelve a leer cada colección y se
 * sustituye de golpe. Así no se pisa lo que haya cambiado mientras tanto (una
 * descarga que termina, un favorito, la sincronización).
 *
 * @param {{ get, set }} almacen  StorageModule o un doble en las pruebas
 * @param {(clave, dataUrl) => Promise<{thumbnail, localThumbnailPath}|null>} guardar
 * @returns {Promise<{ hechas: number, fallos: number }>}
 */
export async function migrarMiniaturas(almacen, guardar = guardarMiniaturaNativa) {
    if (await almacen.get(BANDERA)) return { hechas: 0, fallos: 0 };

    // 1. Los ficheros, uno por canción: las copias de una canción en las listas
    //    comparten el suyo, pero dos canciones distintas nunca (borrar una no
    //    puede dejar a la otra sin miniatura, aunque la imagen fuera la misma)
    const pendientes = new Map(); // clave → base64
    const apuntar = (song) => {
        if (esIncrustada(song?.thumbnail) && !pendientes.has(claveDe(song))) pendientes.set(claveDe(song), song.thumbnail);
    };
    ((await almacen.get('ytdl_library')) || []).forEach(apuntar);
    ((await almacen.get('ytdl_playlists')) || []).forEach((pl) => (pl?.songs ?? []).forEach(apuntar));
    const hechos = new Map(); // clave → { thumbnail, localThumbnailPath }
    let fallos = 0;
    for (const [clave, datos] of pendientes) {
        try {
            const r = await guardar(clave, datos);
            if (r) hechos.set(clave, r); else fallos++;
        } catch (e) {
            console.warn('[Miniaturas]', e);
            fallos++;
        }
    }

    // 2. Sustituir, sobre lo que haya ahora
    const pasar = (song) => (esIncrustada(song?.thumbnail) && hechos.has(claveDe(song)) ? { ...song, ...hechos.get(claveDe(song)) } : song);
    if (hechos.size) {
        const biblioteca = (await almacen.get('ytdl_library')) || [];
        await almacen.set('ytdl_library', biblioteca.map(pasar));
        const listas = (await almacen.get('ytdl_playlists')) || [];
        await almacen.set('ytdl_playlists', listas.map((pl) => (Array.isArray(pl?.songs) ? { ...pl, songs: pl.songs.map(pasar) } : pl)));
    }
    const favoritos = (await almacen.get('favorites')) || [];
    if (favoritos.some((f) => esIncrustada(f?.thumbnail))) {
        await almacen.set('favorites', favoritos.map((f) => (esIncrustada(f?.thumbnail)
            ? { ...f, thumbnail: miniaturaDeFavorito(null, f.videoId ?? f.id) } : f)));
    }
    if (!fallos) await almacen.set(BANDERA, new Date().toISOString());
    return { hechas: hechos.size, fallos };
}

/** Al arrancar la APK: la migración, sin bloquear el primer pintado. En la web no hace nada. */
export async function migrarMiniaturasAlArrancar(almacen) {
    if (!isNative() || !fs()) return { hechas: 0, fallos: 0 };
    return migrarMiniaturas(almacen);
}
