/**
 * Biblioteca de canciones descargadas.
 */

import { apiBase, isNative } from '../../config/env.js';
import { cleanupNativeDuplicateSongFile, deleteStoredAudio, IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { isSongDuplicate } from '../../core/songs.js';
import { StorageModule } from '../../core/storage.js';
import { downloadFromUrl } from '../download/download.js';
import { FavoritesModule } from '../favorites/store.js';
import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { toggleLibraryLoader } from './recovery.js';
import { animateListChange, collapseAndRemove, measure } from '../../ui/motion/list.js';
import { showStatus } from '../../ui/status.js';

/**
 * Unifies the rendering of a song item across Library, Playlist and Search views.
 * Ensures consistent swipe-to-queue support and safe data encoding.
 */
export function renderLibraryItem(song, index, options = {}) {
    // Sin guarda: FavoritesModule es un const de este mismo ámbito, así que
    // `globalThis.FavoritesModule` era SIEMPRE undefined y el corazón nunca se
    // pintaba activo al renderizar la biblioteca.
    const isFav = FavoritesModule.isFavorite(song.videoId);
    const context = options.context || 'library'; // 'library', 'playlist', 'search'
    const songDataSafe = encodeURIComponent(JSON.stringify(song));

    // Actions are context-dependent
    let actionsHtml = '';
    if (context === 'library') {
        actionsHtml = `
            <button class="library-item-btn favorite-btn lib-fav-btn ${isFav ? 'active' : ''}" data-id="${song.videoId}" data-index="${index}" title="Favorito">
                <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <button class="library-item-btn lib-add-playlist-btn" data-index="${index}" title="Añadir a playlist">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>
            <button class="library-item-btn lib-del-btn" data-src="${song.src}" title="Eliminar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
            </button>`;
    } else if (context === 'playlist') {
        const videoId = song.videoId || song.id || '';
        const heartFill = isFav ? 'currentColor' : 'none';
        actionsHtml = `
            <button class="library-item-btn favorite-btn ${isFav ? 'active' : ''}" data-id="${videoId}" title="Favoritos">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <button class="library-item-btn pl-remove-btn" data-src="${song.src}" title="Quitar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <div class="pl-drag-handle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
            </div>`;
    }

    // Entradas cuyo audio se perdió (object URL muerto de versiones anteriores):
    // se muestran atenuadas y con la acción que las arregla, en vez de fallar al pulsarlas.
    if (song.unavailable) {
        return `
        <div class="library-item library-item-unavailable" data-src="${song.src}" data-index="${index}" data-song="${songDataSafe}">
            <div class="library-item-content">
                <img class="library-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                <div class="library-item-info">
                    <div class="library-item-title">${song.title || 'Sin título'}</div>
                    <div class="library-item-meta">Audio no disponible — vuelve a descargarla</div>
                </div>
                <div class="library-item-actions">
                    <button class="library-item-btn lib-redownload-btn" data-index="${index}" title="Volver a descargar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="library-item-btn lib-del-btn" data-src="${song.src}" title="Eliminar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>`;
    }

    return `
        <div class="library-item ${options.isEditMode ? 'edit-mode' : ''}" data-src="${song.src}" data-index="${index}" data-song="${songDataSafe}">
            <div class="swipe-action-bg">
                <div class="swipe-indicator">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>${i18n.t('swipe_next')}</span>
                </div>
            </div>
            <div class="library-item-content">
                <img class="library-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                <div class="library-item-info">
                    <div class="library-item-title">${song.title || 'Sin título'}</div>
                    <div class="library-item-meta">${song.channel || song.artist || 'Desconocido'}</div>
                </div>
                <div class="library-item-actions">
                    ${actionsHtml}
                </div>
            </div>
        </div>`;
}

// ========================================
// LibraryModule — Biblioteca local
// ========================================
export const LibraryModule = (() => {
    const LIBRARY_KEY = 'ytdl_library';

    async function getLibrary() {
        try {
            const lib = await StorageModule.get(LIBRARY_KEY) || [];

            // Sanitización: Evitar duplicados invisibles (por src o videoId)
            const seen = new Set();
            return lib.filter(song => {
                const key = song.videoId || song.src;
                if (!key) return true;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        } catch { return []; }
    }

    async function saveLibrary(lib) {
        await StorageModule.set(LIBRARY_KEY, lib);

        // AUTO-BACKUP NATIVO
        if (isNative() && globalThis.Capacitor?.Plugins?.Filesystem) {
            try {
                globalThis.Capacitor.Plugins.Filesystem.writeFile({
                    path: 'library_backup_v1.json',
                    data: JSON.stringify(lib),
                    directory: 'DATA',
                    encoding: 'utf8'
                }).catch(() => { });
            } catch (e) { console.debug('[Library] write backup failed:', e); }
        }
    }
    async function addSongs(songs) {
        if (!songs) return 0;
        const songsArray = Array.isArray(songs) ? songs : [songs];
        if (songsArray.length === 0) return 0;

        const lib = await getLibrary();
        let addedCount = 0;
        const newlyAddedKeys = new Set();

        for (const song of songsArray) {
            if (!song?.src) continue;

            const key = song.videoId || song.src;

            if (isSongDuplicate(song, lib, newlyAddedKeys)) {
                console.log("Canción duplicada ignorada en lote:", song.title);
                await cleanupNativeDuplicateSongFile(song);
                continue;
            }

            lib.unshift({ ...song, addedAt: new Date().toISOString() });
            if (key) newlyAddedKeys.add(key);
            addedCount++;
        }

        if (addedCount > 0) {
            await saveLibrary(lib);
            await render();
            await updateCount();
        }
        return addedCount;
    }
    async function addSong(song) {
        if (!song?.src) return;
        const lib = await getLibrary();

        // Prevent exact duplicates. Check videoId OR (title AND channel).
        const isDuplicate = lib.find(s => {
            if (s.videoId && song.videoId && s.videoId === song.videoId) return true;
            if (s.title === song.title && s.channel === song.channel) return true;
            return false;
        });

        if (isDuplicate) {
            console.log("Canción duplicada ignorada:", song.title);
            showStatus(i18n.t('lib_duplicate'), 'info');
            return;
        }

        lib.unshift({ ...song, addedAt: new Date().toISOString() });
        await saveLibrary(lib);
        await render();
        await updateCount();
    }

    async function removeSong(src, itemElement) {
        // 1. La fila se pliega al momento (plan 09, T14): antes era una cadena
        //    de setTimeout de 50 y 350 ms con max-height.
        if (itemElement) collapseAndRemove(itemElement);

        const lib = await getLibrary();
        const songToDel = lib.find(s => s.src === src);

        if (songToDel?.localPath && globalThis.Capacitor?.isNative && globalThis.Capacitor?.Plugins?.Filesystem) {
            try {
                await globalThis.Capacitor.Plugins.Filesystem.deleteFile({
                    path: songToDel.localPath,
                    directory: 'DATA'
                });
                console.log("Archivo nativo borrado de la memoria interna.");
            } catch (err) {
                console.error("Error borrando archivo capacitor:", err);
            }
        } else if (typeof src === 'string' && src.startsWith(IDB_SRC_PREFIX)) {
            // Web: liberar el audio guardado en IndexedDB, o se acumulan MB huérfanos
            await deleteStoredAudio(src);
        } else {
            const match = src.match(/\/api\/stream\/([a-zA-Z0-9-]+)/);
            if (match?.[1]) {
                const downloadId = match[1];
                fetch(`${apiBase()}/api/download/${downloadId}`, { method: 'DELETE' }).catch(() => { });
            }
        }

        const newLib = lib.filter(s => s.src !== src);
        await saveLibrary(newLib);

        // Borrado en cascada: Eliminar también de cualquier playlist
        const playlists = await PlaylistModule.getPlaylists();
        for (const pl of playlists) {
            if (pl.songs.some(s => s.src === src)) {
                await PlaylistModule.removeSongFromPlaylist(pl.id, src);
            }
        }

        // Remove from current playing queue to prevent ghost loading
        PlayerModule.removeSongFromQueue(src);

        updateCount();
    }

    async function updateCount() {
        const count = document.getElementById('libraryCount');
        const lib = await getLibrary();
        if (count) count.textContent = contarCanciones(lib.length);
    }

    let cachedEmpty = null;
    let cachedLoader = null;

    async function render() {
        const list = document.getElementById('libraryList');
        if (!list) return;

        // Cache the empty and loader nodes before they get destroyed
        if (document.getElementById('libraryEmpty')) cachedEmpty = document.getElementById('libraryEmpty');
        if (document.getElementById('libraryLoader')) cachedLoader = document.getElementById('libraryLoader');

        toggleLibraryLoader(true);

        const lib = await getLibrary();

        // Filas que entran y se recolocan (plan 09, T14)
        const antes = measure(list, '.library-item', el => el.dataset.src);

        list.innerHTML = '';
        if (cachedLoader) list.appendChild(cachedLoader);
        if (cachedEmpty) list.appendChild(cachedEmpty);

        if (lib.length === 0) {
            toggleLibraryLoader(false);
            if (cachedEmpty) {
                cachedEmpty.classList.remove('hidden');
                cachedEmpty.style.display = 'flex';
            }
            return;
        }

        if (cachedEmpty) {
            cachedEmpty.classList.add('hidden');
            cachedEmpty.style.display = 'none';
        }

        const html = lib.map((song, i) => {
            return renderLibraryItem(song, i, { context: 'library' });
        }).join('');
        list.insertAdjacentHTML('beforeend', html);
        animateListChange(list, '.library-item', el => el.dataset.src, antes);

        // Bind clicks
        list.querySelectorAll('.library-item').forEach((el, i) => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.library-item-btn')) return;
                PlayerModule.play(lib[i], [...lib], i);
            });
        });

        list.querySelectorAll('.lib-del-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('¿Eliminar esta canción de la biblioteca?')) {
                    const itemEl = btn.closest('.library-item');
                    await removeSong(btn.dataset.src, itemEl);
                }
            });
        });

        list.querySelectorAll('.lib-redownload-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const song = lib[Number.parseInt(btn.dataset.index, 10)];
                if (!song) return;

                // Se quita la entrada rota y se relanza la descarga original
                await removeSong(song.src, btn.closest('.library-item'));
                const url = song.url || (song.videoId ? `https://www.youtube.com/watch?v=${song.videoId}` : null);
                if (url) {
                    await downloadFromUrl(url, song);
                } else {
                    showStatus(i18n.t('lib_no_source'), 'error');
                }
            });
        });

        list.querySelectorAll('.lib-add-playlist-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const song = lib[Number.parseInt(btn.dataset.index, 10)];
                if (song) PlaylistModule.showAddToPlaylist(song);
            });
        });

        list.querySelectorAll('.lib-fav-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const song = lib[Number.parseInt(btn.dataset.index, 10)];
                if (song) {
                    await FavoritesModule.toggleFavorite(song, btn);
                }
            });
        });

        await updateCount();
        toggleLibraryLoader(false);
    }

    function setPlaying(src) {
        document.querySelectorAll('.library-item').forEach(el => {
            el.classList.toggle('playing', el.dataset.src === src);
        });
    }

    return { addSong, addSongs, removeSong, getLibrary, render, setPlaying, updateCount };
})();
