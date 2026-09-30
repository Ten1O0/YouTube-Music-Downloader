/**
 * Las listas propias en el almacenamiento, con copia de seguridad en la APK
 * para poder recuperarlas si se pierden los datos de la app.
 *
 * Viven en memoria (plan 19, T3): se leen una vez y se sirven copias; guardar
 * escribe en IndexedDB y actualiza la memoria.
 */

import { isNative } from '../../config/env.js';
import { agrupada, crearColeccion } from '../../core/coleccion.js';
import { anotarListas } from '../sync/diario.js';

export const PLAYLISTS_KEY = 'ytdl_playlists';

const coleccion = crearColeccion(PLAYLISTS_KEY);

// La copia de seguridad nativa, agrupada: unos segundos después del último
// cambio y siempre al pasar a segundo plano (antes, entera en cada toque)
const copiaNativa = agrupada((playlists) => {
    if (!isNative() || !globalThis.Capacitor?.Plugins?.Filesystem) return;
    globalThis.Capacitor.Plugins.Filesystem.writeFile({
        path: 'playlists_backup_v1.json',
        data: JSON.stringify(playlists),
        directory: 'DATA',
        encoding: 'utf8'
    }).catch((e) => console.debug('[Playlist] write backup failed:', e));
});

export async function getPlaylists() {
    try {
        return await coleccion.get();
    } catch { return []; }
}

export async function savePlaylists(playlists) {
    // Lo que cambia se apunta para la cuenta (plan 13): antes (de memoria) y después
    const antes = await coleccion.set(playlists);
    anotarListas(antes, playlists);
    copiaNativa(playlists);
}
