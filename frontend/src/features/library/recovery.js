/**
 * Recuperación de la biblioteca en la APK: rehacerla a partir de la copia de
 * seguridad y de los ficheros de Documentos/YTMusic si se pierde.
 */

import { isNative } from '../../config/env.js';
import { permisoDeAudio } from '../../native/filesystem.js';
import { AUDIO_EXTENSIONS_CLIENT } from '../../core/songs.js';
import { claveDe, guardarMiniaturaNativa, miniaturaDeYoutube } from '../../core/miniaturas.js';
import { videoIdDeMetadatos } from './importar-audio.js';
import { StorageModule } from '../../core/storage.js';
import { LibraryModule } from './library.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { i18n } from '../../i18n/language-manager.js';
import { showStatus } from '../../ui/status.js';

async function recoverLostLibraryFromVault(fs) {
    const lib = await LibraryModule.getLibrary();
    if (lib.length > 0) return;

    try {
        const result = await fs.readFile({ path: 'library_backup_v1.json', directory: 'DATA', encoding: 'utf8' });
        if (result.data) {
            const parsed = JSON.parse(result.data);
            if (parsed && parsed.length > 0) {
                await StorageModule.set('ytdl_library', parsed);
                console.log(`[Recovery] Restauradas ${parsed.length} canciones de la biblioteca nativa.`);
                await LibraryModule.render();
            }
        }
    } catch (e) { /* No backup found */ }
}

async function recoverLostPlaylistsFromVault(fs) {
    const playlists = await PlaylistModule.getPlaylists();
    if (playlists.length > 0) return;

    try {
        const result = await fs.readFile({ path: 'playlists_backup_v1.json', directory: 'DATA', encoding: 'utf8' });
        if (result.data) {
            const parsed = JSON.parse(result.data);
            if (parsed && parsed.length > 0) {
                await StorageModule.set('ytdl_playlists', parsed);
                console.log(`[Recovery] Restauradas ${parsed.length} playlists de la bóveda nativa.`);
                await PlaylistModule.renderGrid();
            }
        }
    } catch (e) { /* No backup found */ }
}

async function runNativeGarbageCollector(fs) {
    try {
        const fullLib = await LibraryModule.getLibrary();
        const validNames = new Set(fullLib.map(s => s.localPath).filter(Boolean));

        const dir = await fs.readdir({ path: '', directory: 'DATA' });
        if (dir?.files) {
            for (let f of dir.files) {
                const fileName = f.name || f;
                const esAudioPropio = fileName.startsWith('ytmusic_')
                    && AUDIO_EXTENSIONS_CLIENT.some(ext => fileName.endsWith(ext));
                if (esAudioPropio) {
                    if (!validNames.has(fileName)) {
                        await fs.deleteFile({ path: fileName, directory: 'DATA' });
                        console.log(`[Recovery] Eliminado archivo huérfano para liberar RAM: ${fileName}`);
                    }
                }
            }
        }
    } catch (e) { console.warn('[Recovery] Garbage Collector falló:', e); }
}

async function fetchPartialTagBlob(playableUrl, fileName) {
    try {
        const response = await fetch(playableUrl);
        const reader = response.body.getReader();
        const chunks = [];
        let totalSize = 0;
        const MAX_TAG_BYTES = 1.5 * 1024 * 1024; // 1.5MB

        while (totalSize < MAX_TAG_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalSize += value.length;
        }
        reader.cancel(); // Stop reading
        return new Blob(chunks);
    } catch (fetchErr) {
        console.warn(`[Scan] Could not fetch file header for tags: ${fileName}`, fetchErr);
        return null;
    }
}

async function parseMetadataFromBlob(tagBlob, fileName) {
    return new Promise((resolve) => {
        if (!tagBlob || typeof jsmediatags === 'undefined') return resolve(null);
        jsmediatags.read(tagBlob, {
            onSuccess: (tag) => {
                let coverBase64 = '';
                if (tag.tags?.picture) {
                    const { data, format } = tag.tags.picture;
                    let base64String = "";
                    const chunkSize = 8192;
                    for (let i = 0; i < data.length; i += chunkSize) {
                        base64String += String.fromCodePoint.apply(null, data.slice(i, i + chunkSize));
                    }
                    coverBase64 = `data:${format};base64,${globalThis.btoa(base64String)}`;
                }
                resolve({
                    title: tag.tags.title || null,
                    artist: tag.tags.artist || null,
                    picture: coverBase64,
                    // Lo que descargó la app lleva su enlace de YouTube (plan 20)
                    videoId: videoIdDeMetadatos(tag.tags),
                });
            },
            onError: (err) => {
                console.warn(`[Scan] jsmediatags error for ${fileName}:`, err);
                resolve(null);
            }
        });
    });
}

async function scanSingleFile(fs, baseDir, fileName, playableUrl, existingPaths, scannedSongs) {
    const fullLocalPath = `${baseDir}/${fileName}`;
    try {
        const tagBlob = await fetchPartialTagBlob(playableUrl, fileName);
        const metadata = await parseMetadataFromBlob(tagBlob, fileName);
        const videoId = metadata?.videoId || null;

        // La carátula del fichero, como fichero aparte (plan 19, T2): antes iba en
        // base64 dentro de la canción, y las de yt-dlp pesan cientos de KB
        let miniatura = { thumbnail: miniaturaDeYoutube(videoId) };
        if (metadata?.picture) {
            try {
                miniatura = await guardarMiniaturaNativa(claveDe({ videoId, src: fullLocalPath }), metadata.picture) || miniatura;
            } catch (e) { console.warn('[Scan] Carátula:', e); }
        }

        scannedSongs.push({
            src: playableUrl,
            localPath: fullLocalPath,
            title: metadata?.title || fileName.replace('.m4a', '').replace('.mp3', ''),
            channel: metadata?.artist || 'Local',
            ...miniatura,
            videoId: videoId || `local_${Math.random().toString(36).substring(2, 9)}`,
            addedAt: new Date().toISOString()
        });
        existingPaths.add(fullLocalPath);
    } catch (e) {
        console.error(`[Scan] Error reading file: ${fileName} in ${baseDir}`, e);
    }
}

/** Hasta qué profundidad se miran las subcarpetas (Música/Artista/Álbum). */
const PROFUNDIDAD_MAXIMA = 3;

async function scanPublicDirectory(fs, baseDir, existingPaths, existingBaseNames, silent, scannedSongs, profundidad = 0) {
    try {
        try {
            await fs.stat({ path: baseDir, directory: 'DOCUMENTS' });
        } catch (statErr) {
            console.log(`[Scan] Skipping ${baseDir} (not found or inaccessible).`);
            return;
        }

        const dir = await fs.readdir({ path: baseDir, directory: 'DOCUMENTS' });
        if (!dir?.files || dir.files.length === 0) return;

        for (const fileInfo of dir.files) {
            const fileName = fileInfo.name || fileInfo;
            // También las subcarpetas (plan 24): antes solo se miraba el primer
            // nivel, y lo guardado en Música/Artista no aparecía
            if (fileInfo.type === 'directory') {
                if (profundidad < PROFUNDIDAD_MAXIMA && !fileName.startsWith('.')) {
                    await scanPublicDirectory(fs, `${baseDir}/${fileName}`, existingPaths, existingBaseNames, silent, scannedSongs, profundidad + 1);
                }
                continue;
            }
            if (!AUDIO_EXTENSIONS_CLIENT.some(ext => fileName.toLowerCase().endsWith(ext))) continue;

            if (existingPaths.has(`${baseDir}/${fileName}`)) continue;

            if (existingBaseNames.has(fileName.toLowerCase())) {
                console.log(`[Scan] Skipping ${fileName} — already in library (basename match).`);
                continue;
            }

            if (!silent) toggleLibraryLoader(true, `Analizando: ${fileName}...`);

            const fullLocalPath = `${baseDir}/${fileName}`;
            const fileUri = await fs.getUri({
                path: fullLocalPath,
                directory: 'DOCUMENTS'
            });
            const playableUrl = globalThis.Capacitor.convertFileSrc(fileUri.uri);

            await scanSingleFile(fs, baseDir, fileName, playableUrl, existingPaths, scannedSongs);
        }
    } catch (dirErr) {
        console.error(`[Scan] Error scanning directory ${baseDir}:`, dirErr);
    }
}

// ========================================
// Hook: post-download → add to library
// ========================================
// ========================================
// Native PWA Capacitor Fixes: Auto-Recover & Garbage Collector
// ========================================
export async function runNativeRecovery() {
    if (!isNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) return;

    const fs = globalThis.Capacitor.Plugins.Filesystem;

    // Show sync button for native users
    const syncBtn = document.getElementById('syncLibraryBtn');
    if (syncBtn) syncBtn.classList.remove('hidden');

    // 1. Recover Library if lost using vault helper
    await recoverLostLibraryFromVault(fs);

    // 2. Recover Playlists if lost using vault helper
    await recoverLostPlaylistsFromVault(fs);

    // 3. Garbage Collector: Limpiar archivos .m4a huérfanos sin metadatos
    await runNativeGarbageCollector(fs);
}

// Phase 4: Metadata & UI Helpers
export function toggleLibraryLoader(show, text) {
    const loader = document.getElementById('libraryLoader');
    const loaderText = document.getElementById('loaderText');
    if (!loader) return;

    if (show) {
        if (text) loaderText.textContent = text;
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

export async function scanPublicFolder(silent = false) {
    if (!isNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) return;

    const fs = globalThis.Capacitor.Plugins.Filesystem;
    // Relativas a Documentos: Descargas y Música están en la raíz, al lado. Antes
    // se buscaban dentro de Documentos (Documents/Download…), que no existen (plan 24)
    const searchPaths = ['YTMusic', '../Download', '../Music'];
    const syncBtn = document.getElementById('syncLibraryBtn');

    try {
        if (!silent) {
            toggleLibraryLoader(true, 'Escaneando carpetas de música...');
            if (syncBtn) syncBtn.classList.add('syncing');
        }

        // Request Permissions
        const perm = await fs.requestPermissions();
        // Y el de leer el audio (Android 11+): sin él, solo se ven los ficheros
        // que creó esta instalación, y tras reinstalar faltaban canciones. En
        // silencio solo se mira; al pulsar «Sincronizar», se pide
        const conAudio = await permisoDeAudio({ pedir: !silent });
        if (perm.publicStorage !== 'granted' || (!conAudio && !silent)) {
            if (!silent) {
                toggleLibraryLoader(false);
                showStatus(i18n.t('storage_denied'), 'error');
            }
            return;
        }

        const currentLib = await LibraryModule.getLibrary();
        const existingPaths = new Set(currentLib.map(s => s.localPath).filter(Boolean));

        const existingBaseNames = new Set();
        for (const s of currentLib) {
            if (s.localPath) {
                let base = s.localPath.split('/').pop();
                base = base.replace(/^imported_[a-z0-9]+_/i, '');
                existingBaseNames.add(base.toLowerCase());
            }
        }
        let newCount = 0;
        const scannedSongs = [];

        for (const baseDir of searchPaths) {
            await scanPublicDirectory(fs, baseDir, existingPaths, existingBaseNames, silent, scannedSongs);
        }

        if (scannedSongs.length > 0) {
            newCount = await LibraryModule.addSongs(scannedSongs);
        }

        if (!silent) toggleLibraryLoader(false);

        if (newCount > 0) {
            if (!silent) showStatus(i18n.t('sync_added', { count: newCount }), 'success');
        } else if (!silent) {
            showStatus(i18n.t('lib_up_to_date'), 'success');
        }

    } catch (err) {
        console.error('Unified scan error:', err);
        if (!silent) {
            toggleLibraryLoader(false);
            showStatus(i18n.t('storage_scan_error'), 'error');
        }
    } finally {
        if (syncBtn) syncBtn.classList.remove('syncing');
    }
}

export function setupNativeSync() {
    const syncBtn = document.getElementById('syncLibraryBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => scanPublicFolder(false));
    }
}
