/**
 * Caché de URLs de objeto para el audio guardado en IndexedDB, con un tope que
 * revoca las más antiguas para no retener memoria (plan 01, T6).
 */

/**
 * Caché de object URLs para el audio guardado en IndexedDB.
 *
 * Un object URL mantiene vivo su blob hasta que se revoca, así que sin techo
 * reproducir 40 canciones retiene cientos de MB. El límite de 5 deja resueltas
 * la canción actual y sus vecinas en la cola, que es lo único que necesita
 * el reproductor.
 */
export const AudioUrlCache = (() => {
    const urls = new Map(); // songId -> objectURL
    const MAX_ENTRIES = 5;

    function put(songId, blob) {
        const existing = urls.get(songId);
        if (existing) return existing;

        if (urls.size >= MAX_ENTRIES) {
            const oldest = urls.keys().next().value;
            globalThis.URL.revokeObjectURL(urls.get(oldest));
            urls.delete(oldest);
        }

        const url = globalThis.URL.createObjectURL(blob);
        urls.set(songId, url);
        return url;
    }

    function get(songId) {
        return urls.get(songId);
    }

    function drop(songId) {
        const url = urls.get(songId);
        if (!url) return;
        globalThis.URL.revokeObjectURL(url);
        urls.delete(songId);
    }

    function clear() {
        for (const url of urls.values()) globalThis.URL.revokeObjectURL(url);
        urls.clear();
    }

    globalThis.addEventListener('beforeunload', clear);

    return { put, get, drop, clear };
})();
