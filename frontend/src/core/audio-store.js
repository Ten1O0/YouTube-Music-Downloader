/**
 * Dónde vive el audio de cada canción y cómo convertirlo en algo reproducible:
 * idb:// en el navegador, ficheros del dispositivo en la APK.
 */

import { apiBase, isNative } from '../config/env.js';
import { AudioUrlCache } from './audio-url-cache.js';
import { CARPETA } from './miniaturas.js';
import { StorageModule } from './storage.js';

/**
 * Marca como no disponibles las canciones cuyo `src` es un object URL muerto.
 *
 * Su audio es irrecuperable: el blob nunca llegó a guardarse en ningún sitio.
 * No se borran porque conservan videoId, título y miniatura, así que se pueden
 * volver a descargar.
 */
export async function repairLegacyBlobEntries() {
    const REPAIR_FLAG_KEY = 'ytdl_blob_repair_v1';

    try {
        if (await StorageModule.get(REPAIR_FLAG_KEY)) return;

        const lib = await StorageModule.get('ytdl_library') || [];
        let repaired = 0;

        for (const song of lib) {
            if (typeof song.src === 'string' && song.src.startsWith('blob:') && !song.unavailable) {
                song.unavailable = true;
                song.unavailableReason = 'blob-expired';
                repaired++;
            }
        }

        if (repaired > 0) {
            await StorageModule.set('ytdl_library', lib);
            console.warn(`[Repair] ${repaired} canciones marcadas como no disponibles (audio perdido).`);
        }

        await StorageModule.set(REPAIR_FLAG_KEY, new Date().toISOString());
    } catch (e) {
        console.error('[Repair] Error revisando la biblioteca:', e);
    }
}

/** Prefijo de los `src` cuyo audio vive en IndexedDB (web). */
export const IDB_SRC_PREFIX = 'idb://';

/**
 * Resuelve la URL reproducible de una canción.
 *
 * `song.src` es la clave de identidad persistida (la usan el DOM, las playlists,
 * la cola y el borrado), así que NUNCA se guarda en ella una URL volátil.
 * La URL reproducible se calcula aquí, en el momento de reproducir:
 *
 *   1. Nativo con fichero local  -> Capacitor.convertFileSrc()
 *   2. Web con blob en IndexedDB -> object URL desde AudioUrlCache
 *   3. Resto (http, legado)      -> tal cual
 *
 * Devuelve null si el audio no es recuperable, para que el reproductor avise
 * en vez de asignar una URL muerta y fallar en silencio.
 */
export async function resolveStreamSrc(song) {
    // 1. Nativo: fichero en el sistema de archivos del dispositivo
    if (isNative() && globalThis.Capacitor?.Plugins?.Filesystem && song.localPath) {
        try {
            const isImported = song.localPath.startsWith('imported_');
            const directory = isImported ? 'DATA' : 'DOCUMENTS';
            const fileUri = await globalThis.Capacitor.Plugins.Filesystem.getUri({
                path: song.localPath,
                directory: directory
            });
            const nativeSrc = globalThis.Capacitor.convertFileSrc(fileUri.uri);
            console.log(`[Player] Using native local stream (${directory}): ${nativeSrc}`);
            return nativeSrc;
        } catch (err) {
            console.warn('[Player] Error resolving localPath, trying streaming fallback:', err);
            return song.videoId ? `${apiBase()}/api/stream/${song.videoId}` : song.src;
        }
    }

    // 2. Web: blob persistido en IndexedDB
    if (typeof song.src === 'string' && song.src.startsWith(IDB_SRC_PREFIX)) {
        const songId = song.src.slice(IDB_SRC_PREFIX.length);

        const cached = AudioUrlCache.get(songId);
        if (cached) return cached;

        try {
            const blob = await StorageModule.getBlob(songId);
            if (blob) return AudioUrlCache.put(songId, blob);
        } catch (err) {
            console.warn('[Player] Error leyendo el audio de IndexedDB:', err);
        }

        // El navegador desalojó el blob: se intenta el streaming del servidor
        if (song.videoId) return `${apiBase()}/api/stream/${song.videoId}`;

        console.error('[Player] Audio no recuperable para:', song.title);
        return null;
    }

    // 3. Cualquier otra cosa: URL http, ruta legada, etc.
    return song.src;
}

export async function resolveNativeThumbnail(song) {
    let finalThumb = song.thumbnail || '';
    let runtimeThumbnailNative = null;
    if (isNative() && globalThis.Capacitor?.Plugins?.Filesystem && song.localThumbnailPath) {
        try {
            // Las miniaturas en fichero (plan 19, T2) viven en DATA/miniaturas/,
            // sea cual sea el origen del audio. getUri no comprueba que exista:
            // con la carpeta equivocada daba una dirección muerta y el icono de la app
            const isImported = song.localPath?.startsWith('imported_');
            const directory = song.localThumbnailPath.startsWith(`${CARPETA}/`) || isImported ? 'DATA' : 'DOCUMENTS';
            const fileUri = await globalThis.Capacitor.Plugins.Filesystem.getUri({
                path: song.localThumbnailPath,
                directory: directory
            });
            finalThumb = globalThis.Capacitor.convertFileSrc(fileUri.uri);
            if (fileUri?.uri) {
                runtimeThumbnailNative = fileUri.uri;
            }
        } catch (err) { console.warn('Local thumbnail resolve err:', err); }
    }
    return { finalThumb, runtimeThumbnailNative };
}

/**
 * Libera el audio de una canción guardada en IndexedDB (src `idb://<id>`).
 * No hace nada si el src es de otro tipo (nativo, http, legado).
 */
export async function deleteStoredAudio(src) {
    if (typeof src !== 'string' || !src.startsWith(IDB_SRC_PREFIX)) return;

    const songId = src.slice(IDB_SRC_PREFIX.length);
    try {
        await StorageModule.deleteBlob(songId);
        AudioUrlCache.drop(songId);
        console.log(`[Storage] Audio liberado de IndexedDB: ${songId}`);
    } catch (err) {
        console.error('[Storage] Error borrando el audio de IndexedDB:', err);
    }
}

export async function cleanupNativeDuplicateSongFile(song) {
    if (globalThis.Capacitor?.isNative && globalThis.Capacitor?.Plugins?.Filesystem && song.localPath) {
        try {
            await globalThis.Capacitor.Plugins.Filesystem.deleteFile({
                path: song.localPath,
                directory: 'DATA'
            });
            console.log("Archivo duplicado borrado de la memoria interna:", song.title);
        } catch (err) {
            console.error("Error borrando archivo duplicado capacitor:", err);
        }
        return;
    }

    // Web: el duplicado ya tiene su blob en IndexedDB, hay que soltarlo
    await deleteStoredAudio(song?.src);
}
