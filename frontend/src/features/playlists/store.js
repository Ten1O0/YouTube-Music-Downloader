/**
 * Las listas propias en el almacenamiento, con copia de seguridad en la APK
 * para poder recuperarlas si se pierden los datos de la app.
 */

import { isNative } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';

export const PLAYLISTS_KEY = 'ytdl_playlists';

export async function getPlaylists() {
    try {
        return await StorageModule.get(PLAYLISTS_KEY) || [];
    } catch { return []; }
}

export async function savePlaylists(playlists) {
    await StorageModule.set(PLAYLISTS_KEY, playlists);

    // AUTO-BACKUP NATIVO
    if (isNative() && globalThis.Capacitor?.Plugins?.Filesystem) {
        try {
            globalThis.Capacitor.Plugins.Filesystem.writeFile({
                path: 'playlists_backup_v1.json',
                data: JSON.stringify(playlists),
                directory: 'DATA',
                encoding: 'utf8'
            }).catch(() => { });
        } catch (e) { console.debug('[Playlist] write backup failed:', e); }
    }
}
