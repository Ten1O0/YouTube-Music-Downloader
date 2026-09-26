/**
 * Identidad de una canción de la biblioteca: su id y cuándo dos son la misma.
 */

/**
 * Extensiones de audio que la aplicación produce y reconoce.
 * Se usa en el recolector de basura nativo, en el escáner de carpetas y al
 * derivar la extensión de una descarga: los tres deben coincidir, o los mp3
 * huérfanos se acumularían para siempre en el móvil.
 */
export const AUDIO_EXTENSIONS_CLIENT = ['.m4a', '.mp3'];

/**
 * Identificador para una canción sin videoId.
 * `crypto.randomUUID` solo existe en contexto seguro (HTTPS/localhost),
 * así que hay un respaldo para no romper en HTTP plano.
 */
export function generateSongId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `song_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isSongDuplicate(song, lib, newlyAddedKeys) {
    const key = song.videoId || song.src;

    // Check if duplicate in existing lib
    const isDuplicateInLib = lib.some(s => {
        if (s.videoId && song.videoId && s.videoId === song.videoId) return true;
        if (s.title === song.title && s.channel === song.channel) return true;
        return false;
    });

    if (isDuplicateInLib) return true;

    // Check if duplicate in current batch
    if (key && newlyAddedKeys.has(key)) {
        return true;
    }

    const isDuplicateInNew = lib.some(s => s.title === song.title && s.channel === song.channel);
    return isDuplicateInNew;
}
