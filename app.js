let isTransitioning = false; // Prevents rapid clicks (400ms debounce)

// Environment Detection (Dynamic to handle remote injection)
// Priority: isNative > platform check > UA check (fallback)
const getIsNative = () => (
    (globalThis.Capacitor !== undefined && globalThis.Capacitor.isNative) ||
    (globalThis.Capacitor !== undefined && ['android', 'ios'].includes(globalThis.Capacitor.platform)) ||
    (navigator.userAgent.includes('Capacitor'))
);
const getApiBase = () => (getIsNative() ? 'https://music.dannarita.es' : '');

let IS_NATIVE = getIsNative();
let API_BASE = getApiBase();

function updateEnvironment() {
    IS_NATIVE = getIsNative();
    API_BASE = getApiBase();
    console.log(`[Env] Updated: NATIVE=${IS_NATIVE}, BASE=${API_BASE}`);

    // Final UI Debug update
    const debugLabel = document.getElementById('debug-env-label');
    if (debugLabel) debugLabel.textContent = `v=74 [N:${IS_NATIVE}]`;
}
updateEnvironment(); // Initial check

// ========================================
// Native Media Session Helper (uses @jofr/capacitor-media-session plugin)
// Falls back to navigator.mediaSession for web/PWA
// ========================================
const NativeMediaSession = (() => {
    let _plugin = null;
    let _handlersRegistered = false;

    function getPlugin() {
        if (_plugin) return _plugin;
        try {
            if (globalThis.Capacitor?.Plugins?.MediaSession) {
                _plugin = globalThis.Capacitor.Plugins.MediaSession;
                console.log('[NativeMediaSession] Plugin found!');
                return _plugin;
            }
        } catch (e) {
            console.warn('[NativeMediaSession] Plugin not available:', e);
        }
        return null;
    }

    async function setMetadata(metadata) {
        const plugin = getPlugin();
        if (plugin) {
            try {
                // CRITICAL: Android Binder IPC has a 1MB transaction limit.
                // Sending multiple artwork entries (especially base64 data: URIs)
                // will exceed this limit and crash the app instantly.
                // Solution: send at most 1 small artwork to the native plugin.
                const nativeMetadata = { ...metadata };
                if (metadata.artwork && metadata.artwork.length > 0) {
                    // Pick the first non-base64 artwork, or just the first one
                    const urlArt = metadata.artwork.find(a => !a.src.startsWith('data:'));
                    nativeMetadata.artwork = urlArt ? [urlArt] : [metadata.artwork[0]];
                }
                await plugin.setMetadata(nativeMetadata);
                console.log('[NativeMediaSession] Metadata set successfully');
            } catch (e) {
                console.warn('[NativeMediaSession] setMetadata error:', e);
            }
        }
        // Web MediaMetadata doesn't have the Binder limit — send full artwork array
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata(metadata);
            } catch (e) {
                console.debug('[MediaSession] Metadata error ignored:', e);
            }
        }
    }

    async function setPlaybackState(state) {
        const plugin = getPlugin();
        if (plugin) {
            try {
                await plugin.setPlaybackState({ playbackState: state });
            } catch (e) {
                console.warn('[NativeMediaSession] setPlaybackState error:', e);
            }
        }
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.playbackState = state;
            } catch (e) {
                console.debug('[MediaSession] PlaybackState error ignored:', e);
            }
        }
    }

    async function setPositionState(posState) {
        const plugin = getPlugin();
        if (plugin) {
            try {
                await plugin.setPositionState(posState);
            } catch (e) {
                console.warn('[NativeMediaSession] setPositionState error:', e);
            }
        }
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
                navigator.mediaSession.setPositionState(posState);
            } catch (e) {
                console.debug('[MediaSession] PositionState error ignored:', e);
            }
        }
    }

    // Register action handlers — only needs to be done once
    // callbacks = { play, pause, nexttrack, previoustrack, seekforward, seekbackward, seekto }
    async function registerHandlers(callbacks) {
        if (_handlersRegistered) return;
        _handlersRegistered = true;

        const plugin = getPlugin();
        const actions = ['play', 'pause', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward', 'seekto'];

        for (const action of actions) {
            if (!callbacks[action]) continue;

            // Native plugin handlers
            if (plugin) {
                try {
                    await plugin.setActionHandler({ action }, callbacks[action]);
                } catch (e) {
                    console.warn(`[NativeMediaSession] Handler '${action}' error:`, e);
                }
            }

            // Web fallback handlers
            if ('mediaSession' in navigator) {
                try {
                    navigator.mediaSession.setActionHandler(action, callbacks[action]);
                } catch (e) {
                    console.debug(`[MediaSession] Action '${action}' ignored:`, e);
                }
            }
        }
        console.log('[NativeMediaSession] All handlers registered.');
    }

    function isAvailable() {
        return !!getPlugin();
    }

    return { setMetadata, setPlaybackState, setPositionState, registerHandlers, isAvailable };
})();


// ========================================
// Utilities
// ========================================
function sanitizeFilename(name) {
    if (!name) return 'audio_unknown';
    // Remove unwanted characters for Android/Windows filesystems
    return name.replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

/**
 * Unifies the rendering of a song item across Library, Playlist and Search views.
 * Ensures consistent swipe-to-queue support and safe data encoding.
 */
function renderLibraryItem(song, index, options = {}) {
    const isFav = globalThis.FavoritesModule !== undefined && FavoritesModule.isFavorite(song.videoId);
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
                    <span>Siguiente</span>
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

/**
 * Marca como no disponibles las canciones cuyo `src` es un object URL muerto.
 *
 * Su audio es irrecuperable: el blob nunca llegó a guardarse en ningún sitio.
 * No se borran porque conservan videoId, título y miniatura, así que se pueden
 * volver a descargar.
 */
async function repairLegacyBlobEntries() {
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

// Generic modal close utility to resolve SonarQube duplicate function issues
function closeOverlayOrHideModal(modal) {
    if (typeof NavigationModule !== 'undefined') {
        NavigationModule.closeOverlay();
    } else if (modal) {
        modal.classList.add('hidden');
    }
}

// Global/Module-level Utility Helpers to resolve SonarQube complexity/nesting warnings
function addOptionalEventListener(element, event, callback) {
    if (element) {
        element.addEventListener(event, callback);
    }
}

function toggleHeartButtonState(btn, active) {
    if (!btn) return;
    btn.classList.toggle('active', active);
    const svg = btn.querySelector('svg');
    if (svg) svg.style.fill = active ? 'currentColor' : 'none';
}

function syncRepeatButtonState(btn, repeatMode) {
    if (!btn) return;
    btn.classList.toggle('active', repeatMode > 0);
    const badge = btn.querySelector('.repeat-one-badge');
    if (badge) badge.style.display = repeatMode === 2 ? 'block' : 'none';
}

async function writeBlobToNativeFilesystem(fs, internalNativePath, publicDocsPath, blob) {
    const CHUNK_SIZE = 2 * 1024 * 1024;
    let offset = 0;
    let isFirstChunk = true;
    while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const base64Chunk = arrayBufferToBase64(await chunk.arrayBuffer());
        if (isFirstChunk) {
            await fs.writeFile({ path: internalNativePath, data: base64Chunk, directory: 'DATA' });
            try { await fs.writeFile({ path: publicDocsPath, data: base64Chunk, directory: 'DOCUMENTS' }); } catch (err) { console.debug('[Filesystem] writeFile documents ignored:', err); }
            isFirstChunk = false;
        } else {
            await fs.appendFile({ path: internalNativePath, data: base64Chunk, directory: 'DATA' });
            try { await fs.appendFile({ path: publicDocsPath, data: base64Chunk, directory: 'DOCUMENTS' }); } catch (err) { console.debug('[Filesystem] appendFile documents ignored:', err); }
        }
        offset += CHUNK_SIZE;
    }
}

async function downloadOfflineThumbnail(thumbUrl) {
    if (!thumbUrl) return null;
    try {
        let bestThumb = thumbUrl;
        if (bestThumb.includes('i.ytimg.com')) {
            bestThumb = bestThumb.replace('maxresdefault.jpg', 'mqdefault.jpg').replace('hqdefault.jpg', 'mqdefault.jpg');
        }

        const thumbRes = await fetch(bestThumb);
        if (thumbRes.ok) {
            const thumbBlob = await thumbRes.blob();
            const thumbReader = new FileReader();
            thumbReader.readAsDataURL(thumbBlob);
            await new Promise(r => { thumbReader.onloadend = r; });
            return thumbReader.result;
        }
    } catch (e) { console.warn('Failed to save offline thumbnail', e); }
    return null;
}

async function saveDownloadToApp(download_id, videoInfo, downloadUrl, finalProgressData) {
    let streamUrl = `${API_URL}/api/stream/${download_id}`;
    let localPath = null;
    let offlineBase64Thumb = null;

    if (globalThis.Capacitor?.isNative && globalThis.Capacitor?.Plugins?.Filesystem) {
        updateProgress(100, 'Guardando en la app...');
        try {
            const res = await saveToNativeCapacitor(download_id, videoInfo, downloadUrl, finalProgressData);
            streamUrl = res.streamUrl;
            localPath = res.localPath;
            offlineBase64Thumb = res.offlineBase64Thumb;
        } catch (err) {
            console.error("Error en modo offline:", err);
            showStatus('Selección automática de guardado fallida. Intentando reproducir online.', 'error');
        }
    } else {
        setTimeout(() => { globalThis.location.href = downloadUrl; }, 500);
    }
    return { streamUrl, localPath, offlineBase64Thumb };
}

async function writeBlobToDocumentsFilesystem(fs, fullPath, blob) {
    const CHUNK_SIZE = 2 * 1024 * 1024;
    let offset = 0;
    let isFirstChunk = true;
    while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await chunk.arrayBuffer();
        const base64Chunk = arrayBufferToBase64(arrayBuffer);

        if (isFirstChunk) {
            await fs.writeFile({ path: fullPath, data: base64Chunk, directory: 'DOCUMENTS' });
            isFirstChunk = false;
        } else {
            await fs.appendFile({ path: fullPath, data: base64Chunk, directory: 'DOCUMENTS' });
        }
        offset += CHUNK_SIZE;
    }
}

function syncFullPlayerFavoriteButton(song) {
    if (!song || !fullPlayerFav) return;
    const videoId = song.videoId || song.id || extractVideoId(song.src);
    if (!videoId) return;

    const isFav = FavoritesModule.isFavorite(videoId);
    fullPlayerFav.classList.toggle('active', isFav);
    const svg = fullPlayerFav.querySelector('svg');
    if (svg) svg.style.fill = isFav ? 'currentColor' : 'none';
}

function buildMediaSessionArtwork(artworkUrl, isValidNativeUrl) {
    const artwork = [];
    if (artworkUrl && isValidNativeUrl) {
        const sizes = ['96', '128', '192', '256', '384', '512'];
        sizes.forEach(s => {
            artwork.push({ src: artworkUrl, sizes: `${s}x${s}`, type: 'image/jpeg' });
        });

        if (artworkUrl.includes('i.ytimg.com')) {
            const hq = artworkUrl.replace('mqdefault.jpg', 'hqdefault.jpg').replace('default.jpg', 'hqdefault.jpg');
            artwork.push({ src: hq, sizes: '480x360', type: 'image/jpeg' });
            const maxres = artworkUrl.replace('mqdefault.jpg', 'maxresdefault.jpg').replace('default.jpg', 'maxresdefault.jpg');
            artwork.push({ src: maxres, sizes: '1280x720', type: 'image/jpeg' });
        }
    }
    return artwork;
}

function validateArtworkUrlForNative(artworkUrl) {
    if (!artworkUrl) return true;
    if (IS_NATIVE) {
        return artworkUrl.includes(';base64,');
    }
    return artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://') || artworkUrl.includes(';base64,');
}

/** Prefijo de los `src` cuyo audio vive en IndexedDB (web). */
const IDB_SRC_PREFIX = 'idb://';

/**
 * Identificador para una canción sin videoId.
 * `crypto.randomUUID` solo existe en contexto seguro (HTTPS/localhost),
 * así que hay un respaldo para no romper en HTTP plano.
 */
function generateSongId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `song_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

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
async function resolveStreamSrc(song) {
    // 1. Nativo: fichero en el sistema de archivos del dispositivo
    if (IS_NATIVE && globalThis.Capacitor?.Plugins?.Filesystem && song.localPath) {
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
            const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
            return song.videoId ? `${apiBase}/api/stream/${song.videoId}` : song.src;
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
        const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '';
        if (song.videoId) return `${apiBase}/api/stream/${song.videoId}`;

        console.error('[Player] Audio no recuperable para:', song.title);
        return null;
    }

    // 3. Cualquier otra cosa: URL http, ruta legada, etc.
    return song.src;
}

async function resolveNativeThumbnail(song) {
    let finalThumb = song.thumbnail || '';
    let runtimeThumbnailNative = null;
    if (IS_NATIVE && globalThis.Capacitor?.Plugins?.Filesystem && song.localThumbnailPath) {
        try {
            const isImported = song.localPath?.startsWith('imported_');
            const directory = isImported ? 'DATA' : 'DOCUMENTS';
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

function updatePlayerUI(song, finalThumb) {
    const pTitle = document.getElementById('playerTitle');
    const pArtist = document.getElementById('playerArtist');
    const pThumb = document.getElementById('playerThumb');
    const fpTitle = document.getElementById('fullPlayerTitle');
    const fpArtist = document.getElementById('fullPlayerArtist');
    const fpThumb = document.getElementById('fullPlayerThumb');
    const fpBg = document.getElementById('fullPlayerBg');
    const fpSource = document.getElementById('fullPlayerSource');

    if (pTitle) pTitle.textContent = song.title || 'Sin título';
    if (pArtist) pArtist.textContent = song.channel || '—';
    if (pThumb) pThumb.src = finalThumb || '';

    if (fpTitle) fpTitle.textContent = song.title || 'Sin título';
    if (fpArtist) fpArtist.textContent = song.channel || '—';
    if (fpThumb) fpThumb.src = finalThumb || '';
    if (fpBg) fpBg.style.backgroundImage = `url('${finalThumb}')`;
    if (fpSource) {
        if (typeof NavigationModule !== 'undefined' && (NavigationModule.currentView === 'playlists' || PlaylistModule.currentPlaylistId)) {
            fpSource.textContent = PlaylistModule.currentPlaylistName || 'Playlist';
        } else {
            fpSource.textContent = 'Mi Biblioteca';
        }
    }
}


function isSongDuplicate(song, lib, newlyAddedKeys) {
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

/**
 * Libera el audio de una canción guardada en IndexedDB (src `idb://<id>`).
 * No hace nada si el src es de otro tipo (nativo, http, legado).
 */
async function deleteStoredAudio(src) {
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

async function cleanupNativeDuplicateSongFile(song) {
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
async function handleDeleteEmptyPlaylist(playlistId, plName) {
    await deletePlaylist(playlistId);
    if (typeof showStatus === 'function') {
        showStatus(`La playlist "${plName}" se ha eliminado automáticamente al no tener canciones`, 'info');
    }
    if (typeof PlaylistModule !== 'undefined' && PlaylistModule.currentPlaylistId === playlistId) {
        PlaylistModule.currentPlaylistId = null;
        NavigationModule.switchView('playlistsView');
    }
}

async function handleUpdateNonEmptyPlaylist(playlistId, playlists, pl) {
    await savePlaylists(playlists);
    await renderGrid();

    // Refresh detail view instantly if it's the current one
    if (typeof PlaylistModule !== 'undefined' && PlaylistModule.currentPlaylistId === playlistId) {
        const countEl = document.getElementById('playlistDetailCount');
        if (countEl) countEl.textContent = `${pl.songs.length} canción${pl.songs.length !== 1 ? 'es' : ''}`;
        renderPlaylistSongs(pl);
    }
}
async function resolvePlaylistDetails(playlistId) {
    if (playlistId === 'favorites') {
        const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
        const favorites = lib.filter(s => FavoritesModule.isFavorite(s.videoId));
        return {
            id: 'favorites',
            name: 'Favoritos',
            songs: favorites
        };
    }
    const playlists = await getPlaylists();
    return playlists.find(p => p.id === playlistId);
}

function syncPlaylistDetailHeader(pl, playlistId) {
    const addSection = document.querySelector('.playlist-add-section');
    if (addSection) {
        addSection.style.display = (playlistId === 'favorites' ? 'none' : 'block');
    }

    const nameEl = document.getElementById('playlistDetailName');
    const descEl = document.getElementById('playlistDetailDescription');
    const countEl = document.getElementById('playlistDetailCount');

    if (nameEl) nameEl.textContent = pl.name;
    if (descEl) {
        descEl.textContent = pl.description || 'Sin descripción';
        descEl.style.display = (pl.description ? 'block' : 'none');
    }
    if (countEl) countEl.textContent = `${pl.songs.length} canción${pl.songs.length !== 1 ? 'es' : ''}`;
}

function syncPlaylistPlayerStates() {
    if (typeof PlayerModule !== 'undefined') {
        const shufVal = PlayerModule.isShuffled();
        const repVal = PlayerModule.getRepeatMode();

        const plShuf = document.getElementById('plShuffleBtn');
        if (plShuf) plShuf.classList.toggle('active', shufVal);

        syncRepeatButtonState(document.getElementById('plRepeatBtn'), repVal);
    }
}

function handlePlaylistDeletionUI(pl) {
    const deleteModal = document.getElementById('playlistDeleteConfirmModal');
    const deleteName = document.getElementById('plDeleteConfirmName');
    const deleteYes = document.getElementById('plDeleteConfirmYesBtn');
    const deleteNo = document.getElementById('plDeleteConfirmNoBtn');

    if (deleteModal && deleteName && deleteYes && deleteNo) {
        deleteName.textContent = pl.name;
        deleteModal.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('playlistDeleteConfirmModal');
        }

        deleteYes.onclick = async () => {
            await deletePlaylist(pl.id);
            closeOverlayOrHideModal(deleteModal);
            NavigationModule.switchView('playlistsView');
        };

        const closeDelete = () => closeOverlayOrHideModal(deleteModal);

        deleteNo.onclick = closeDelete;
        deleteModal.querySelector('.auth-modal-backdrop').onclick = closeDelete;
    }
}

async function handlePlaylistCheckboxChange(e, lbl, song) {
    const plId = lbl.dataset.id;
    if (e.target.checked) {
        await addSongToPlaylist(plId, song);
    } else {
        await removeSongFromPlaylist(plId, song.src);
    }
    // Actualizar el contador dinámicamente sin cerrar el modal
    const updatedPls = await getPlaylists();
    const pl = updatedPls.find(p => p.id === plId);
    if (pl) {
        lbl.querySelector('.pl-count-indicator').textContent = `${pl.songs.length} canciones`;
    }
}

async function renderPlaylistCreateSongsList(songsList, saveBtn) {
    if (!songsList) return;
    const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
    if (lib.length === 0) {
        songsList.innerHTML = '<p style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.8rem;">No tienes canciones en tu biblioteca. ¡Descarga canciones primero!</p>';
        return;
    }

    songsList.innerHTML = lib.map((song, i) => {
        return `
        <label class="playlist-create-song-row" style="display:flex; align-items:center; padding:6px; cursor:pointer; gap:10px; border-bottom:1px solid rgba(255,255,255,0.02);">
            <input type="checkbox" class="playlist-create-checkbox" data-index="${i}" style="transform:scale(1.1); accent-color:var(--accent-gold);">
            <img src="${song.thumbnail || 'favicon.png'}" style="width:32px; height:32px; object-fit:cover; border-radius:4px;" alt="" onerror="this.src='favicon.png'">
            <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
                <div style="font-size:0.75rem; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${song.title}</div>
                <div style="font-size:0.65rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${song.channel}</div>
            </div>
        </label>
        `;
    }).join('');

    // Listener to enable/disable button
    const checkboxes = songsList.querySelectorAll('.playlist-create-checkbox');
    const updateCreateBtnState = () => {
        const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
        if (saveBtn) saveBtn.disabled = selectedCount === 0;
    };

    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateCreateBtnState);
    });
}

async function recoverLostLibraryFromVault(fs) {
    const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
    if (lib.length > 0) return;

    try {
        const result = await fs.readFile({ path: 'library_backup_v1.json', directory: 'DATA', encoding: 'utf8' });
        if (result.data) {
            const parsed = JSON.parse(result.data);
            if (parsed && parsed.length > 0) {
                await StorageModule.set('ytdl_library', parsed);
                console.log(`[Recovery] Restauradas ${parsed.length} canciones de la biblioteca nativa.`);
                if (typeof LibraryModule !== 'undefined') await LibraryModule.render();
            }
        }
    } catch (e) { /* No backup found */ }
}

async function recoverLostPlaylistsFromVault(fs) {
    const playlists = typeof PlaylistModule !== 'undefined' ? await PlaylistModule.getPlaylists() : [];
    if (playlists.length > 0) return;

    try {
        const result = await fs.readFile({ path: 'playlists_backup_v1.json', directory: 'DATA', encoding: 'utf8' });
        if (result.data) {
            const parsed = JSON.parse(result.data);
            if (parsed && parsed.length > 0) {
                await StorageModule.set('ytdl_playlists', parsed);
                console.log(`[Recovery] Restauradas ${parsed.length} playlists de la bóveda nativa.`);
                if (typeof PlaylistModule !== 'undefined') await PlaylistModule.renderGrid();
            }
        }
    } catch (e) { /* No backup found */ }
}

async function runNativeGarbageCollector(fs) {
    try {
        const fullLib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
        const validNames = new Set(fullLib.map(s => s.localPath).filter(Boolean));

        const dir = await fs.readdir({ path: '', directory: 'DATA' });
        if (dir?.files) {
            for (let f of dir.files) {
                const fileName = f.name || f;
                if (fileName.startsWith('ytmusic_') && fileName.endsWith('.m4a')) {
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
                    picture: coverBase64
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

        scannedSongs.push({
            src: playableUrl,
            localPath: fullLocalPath,
            title: metadata?.title || fileName.replace('.m4a', '').replace('.mp3', ''),
            channel: metadata?.artist || 'Local',
            thumbnail: metadata?.picture || '',
            videoId: `local_${Math.random().toString(36).substring(2, 9)}`,
            addedAt: new Date().toISOString()
        });
        existingPaths.add(fullLocalPath);
    } catch (e) {
        console.error(`[Scan] Error reading file: ${fileName} in ${baseDir}`, e);
    }
}

async function scanPublicDirectory(fs, baseDir, existingPaths, existingBaseNames, silent, scannedSongs) {
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
            if (!fileName.endsWith('.m4a') && !fileName.endsWith('.mp3')) continue;

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

function readJsMediaTags(file) {
    return new Promise((resolve) => {
        if (typeof jsmediatags === 'undefined') return resolve(null);
        jsmediatags.read(file, {
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
                    picture: coverBase64
                });
            },
            onError: () => resolve(null)
        });
    });
}

function handleSongSwipeAddToQueue(songData) {
    if (PlayerModule && typeof PlayerModule.addToNextQueue === 'function' && songData.src) {
        PlayerModule.addToNextQueue(songData);
        if (navigator.vibrate) navigator.vibrate(30);
    } else {
        console.error("PlayerModule.addToNextQueue not found or missing song src", { pm: !!PlayerModule, src: songData?.src });
    }
}

// ========================================
// Deep Link Handler (Native Auth)
// ========================================
try {
    if (globalThis.Capacitor?.Plugins?.App) {
        const handleDeepLinkData = async (urlStr) => {
            try {
                console.log('[NativeAuth] Processing URL:', urlStr);
                // Robust check: matches protocol OR contains our specific auth params
                if (urlStr.includes('ytdlauth') || (urlStr.includes('token=') && urlStr.includes('user='))) {
                    // Normalize URL for parsing (some platforms struggle with custom schemes in URL constructor)
                    const normalizedUrl = urlStr.replace('ytdlauth://', 'https://proxy/').replace('ytdlauth:', 'https://proxy/').replace('es.dannarita.music://', 'https://proxy/');
                    const url = new URL(normalizedUrl);

                    const token = url.searchParams.get('token');
                    const userEncoded = url.searchParams.get('user');

                    if (token && userEncoded) {
                        const user = JSON.parse(decodeURIComponent(userEncoded));
                        localStorage.setItem('auth_token', token);
                        localStorage.setItem('auth_user', JSON.stringify(user));

                        console.log('[NativeAuth] Session success. Reloading...');

                        if (typeof showStatus === 'function') {
                            showStatus('¡Cuenta vinculada con éxito!', 'success');
                        }

                        // Delay reload to let the user see the success message
                        setTimeout(() => globalThis.location.reload(), 1200);
                        return true;
                    }
                }
            } catch (e) {
                console.error('[NativeAuth] Error parsing deep link:', e);
            }
            return false;
        };

        // 1. Listen for background -> foreground transitions
        globalThis.Capacitor.Plugins.App.addListener('appUrlOpen', (event) => {
            handleDeepLinkData(event.url);
        });

        // 2. Handle Cold Start (App was closed when link was clicked)
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(async () => {
                const { App } = globalThis.Capacitor.Plugins;
                const ret = await App.getLaunchUrl();
                if (ret?.url) {
                    console.log('[NativeAuth] Launched via URL:', ret.url);
                    handleDeepLinkData(ret.url);
                }
            }, 1500); // Wait for app to be ready
        });
    }
} catch (e) {
    console.warn('[DeepLink] Capacitor not available, skipping deep link setup:', e);
}

// ========================================
// Android Permission Onboarding
// ========================================
const OnboardingModule = (() => {
    const onboardingModal = document.getElementById('permissionOnboardingModal');
    const grantBtn = document.getElementById('grantPermissionBtn');
    const skipBtn = document.getElementById('skipPermissionBtn');

    async function requestNotificationPermission() {
        if (!IS_NATIVE) return;
        try {
            const ln = globalThis.Capacitor?.Plugins?.LocalNotifications;
            if (ln) {
                console.log('[Onboarding] Checking notification permissions...');
                let perm = await ln.checkPermissions();
                if (perm.display === 'prompt') {
                    console.log('[Onboarding] Requesting notification permissions...');
                    perm = await ln.requestPermissions();
                }
                console.log('[Onboarding] Notification permission status:', perm.display);
            } else {
                console.warn('[Onboarding] LocalNotifications plugin not found on globalThis.Capacitor.Plugins');
            }
        } catch (e) {
            console.error('[Onboarding] Error requesting notification permissions:', e);
        }
    }

    async function checkPermissions() {
        // Retry logic: Wait for Capacitor to be injected (common for remote URLs)
        let retries = 0;
        const maxRetries = 25; // 5 seconds total (25 * 200ms)

        while (!getIsNative() && retries < maxRetries) {
            console.log(`[Onboarding] Waiting for Capacitor... (Attempt ${retries + 1})`);
            await new Promise(resolve => setTimeout(resolve, 200));
            retries++;
        }

        // Sync global state once detected
        updateEnvironment();

        if (!IS_NATIVE) {
            console.warn('[Onboarding] Capacitor not detected or not native. Skipping check.');
            return;
        }

        try {
            const fs = globalThis.Capacitor.Plugins.Filesystem;

            // Check storage permissions (the only ones we can check from JS in Capacitor)
            const storageStatus = await fs.checkPermissions();

            // If storage is granted, skip onboarding and auto-scan
            if (storageStatus.publicStorage === 'granted') {
                console.log('[Onboarding] Storage permission OK. Starting auto-scan...');
                if (typeof scanPublicFolder === 'function') {
                    scanPublicFolder(true); // Silent scan
                }
                await requestNotificationPermission();
                return;
            }

            // Show modal if storage is missing
            showOnboarding();
        } catch (e) {
            console.error('[Onboarding] Error checking permissions:', e);
        }
    }

    function showOnboarding() {
        onboardingModal.classList.remove('hidden');
        if (globalThis.NavigationModule !== undefined) {
            NavigationModule.pushOverlayState('permissionOnboardingModal');
        }
    }

    function hideOnboarding() {
        if (globalThis.NavigationModule === undefined) {
            onboardingModal.classList.add('hidden');
        } else {
            NavigationModule.closeOverlay();
        }
    }

    async function requestPermissions() {
        try {
            const fs = globalThis.Capacitor.Plugins.Filesystem;

            // Request Storage Permissions (the only native permission we can request from JS)
            console.log('[Onboarding] Requesting storage permissions...');
            const storageResult = await fs.requestPermissions();

            if (storageResult.publicStorage === 'granted') {
                showStatus('¡Permisos configurados!', 'success');
                if (typeof scanPublicFolder === 'function') {
                    scanPublicFolder(true);
                }
                await requestNotificationPermission();
            }

            hideOnboarding();
        } catch (e) {
            console.error('[Onboarding] Error requesting permissions:', e);
            hideOnboarding();
        }
    }

    // Initialize events
    console.info('[Onboarding] Initializing Module...');
    if (onboardingModal) {
        grantBtn.addEventListener('click', requestPermissions);
        skipBtn.addEventListener('click', hideOnboarding);

        // Auto-check on load (IMMEDIATE for Point 7)
        const runAuthCheck = () => {
            console.info('[Onboarding] Triggering immediate permission check');
            checkPermissions();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', runAuthCheck);
        } else {
            runAuthCheck();
        }
    } else {
        console.warn('[Onboarding] Modal element not found in DOM');
    }

    return { checkPermissions };
})();

// ========================================
// StorageModule — Unified IndexedDB Handler
// ========================================
const StorageModule = (() => {
    const DB_NAME = 'YTMusicDB';
    const STORE_NAME = 'kv_store';
    const BLOB_STORE = 'audio_blobs';
    const DB_VERSION = 2;

    let dbPromise = null;

    function initDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // Ambos stores se crean solo si faltan: nunca se borran datos existentes
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
                if (!db.objectStoreNames.contains(BLOB_STORE)) {
                    db.createObjectStore(BLOB_STORE);
                }
            };

            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
        return dbPromise;
    }

    /**
     * Ejecuta una operación sobre un store y resuelve cuando la transacción
     * ha confirmado (no solo cuando la petición ha tenido éxito), para que una
     * escritura de blob no se dé por buena antes de estar en disco.
     */
    async function runTx(storeName, mode, fn) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            let result;
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = fn(store);
            request.onsuccess = () => { result = request.result; };
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error);
            transaction.onerror = () => reject(transaction.error);
        });
    }

    const get = (key) => runTx(STORE_NAME, 'readonly', (s) => s.get(key));
    const set = (key, value) => runTx(STORE_NAME, 'readwrite', (s) => s.put(value, key));
    const remove = (key) => runTx(STORE_NAME, 'readwrite', (s) => s.delete(key));

    const getBlob = (id) => runTx(BLOB_STORE, 'readonly', (s) => s.get(id));
    const deleteBlob = (id) => runTx(BLOB_STORE, 'readwrite', (s) => s.delete(id));

    /** Guarda un blob de audio. Devuelve true/false en vez de lanzar. */
    async function putBlob(id, blob) {
        try {
            await runTx(BLOB_STORE, 'readwrite', (s) => s.put(blob, id));
            return true;
        } catch (err) {
            if (err?.name === 'QuotaExceededError') {
                console.error('[Storage] Cuota de almacenamiento agotada:', err);
                if (typeof showStatus === 'function') {
                    showStatus('No hay espacio suficiente para guardar la canción sin conexión', 'error');
                }
            } else {
                console.error('[Storage] Error guardando el audio:', err);
            }
            return false;
        }
    }

    /** Pide almacenamiento persistente para que el navegador no desaloje la biblioteca. */
    async function requestPersistence() {
        try {
            if (!navigator.storage?.persist) return;
            if (await navigator.storage.persisted()) return;
            const granted = await navigator.storage.persist();
            console.log(`[Storage] Almacenamiento persistente: ${granted ? 'concedido' : 'denegado'}`);
        } catch (e) {
            console.debug('[Storage] persist() no disponible:', e);
        }
    }

    return { get, set, remove, getBlob, putBlob, deleteBlob, requestPersistence };
})();

const MIGRATION_FLAG_KEY = 'ytdl_migrated_v1';

/** Clave de identidad de un elemento guardado (canción, favorito, playlist). */
function storageItemKey(item) {
    return item?.id || item?.videoId || item?.src || null;
}

/**
 * Fusiona dos arrays por clave conservando SIEMPRE lo que ya está en IndexedDB.
 * Sustituye a la comparación por longitud, que podía resucitar elementos borrados.
 */
function mergeStoredArrays(existing, incoming) {
    const byKey = new Map();
    const unkeyed = [];

    for (const item of existing) {
        const k = storageItemKey(item);
        if (k) byKey.set(k, item);
        else unkeyed.push(item);
    }
    for (const item of incoming) {
        const k = storageItemKey(item);
        if (!k) continue; // sin clave no se puede deduplicar: se descarta lo entrante
        if (!byKey.has(k)) byKey.set(k, item);
    }

    return [...byKey.values(), ...unkeyed];
}

async function migrateStorage() {
    // La migración es un evento único, no algo de cada arranque.
    try {
        if (await StorageModule.get(MIGRATION_FLAG_KEY)) return;
    } catch (e) {
        console.debug('[Migration] No se pudo leer el flag de migración:', e);
    }

    const keys = ['ytdl_library', 'ytdl_playlists', 'favorites', 'downloadHistory'];
    for (const key of keys) {
        try {
            const localVal = localStorage.getItem(key);
            if (!localVal) continue;

            const parsed = JSON.parse(localVal);
            const existing = await StorageModule.get(key);

            let merged;
            if (!existing) {
                merged = parsed;
            } else if (Array.isArray(existing) && Array.isArray(parsed)) {
                merged = mergeStoredArrays(existing, parsed);
            } else {
                merged = existing; // tipos no fusionables: gana lo que ya hay en IndexedDB
            }

            await StorageModule.set(key, merged);
            // Solo se borra de localStorage cuando la escritura ha confirmado
            localStorage.removeItem(key);
            console.log(`[Migration] ${key} migrado (${Array.isArray(merged) ? merged.length : 1} elementos).`);
        } catch (e) {
            console.error(`[Migration] Error migrando ${key}:`, e);
        }
    }

    try {
        await StorageModule.set(MIGRATION_FLAG_KEY, new Date().toISOString());
    } catch (e) {
        console.debug('[Migration] No se pudo marcar la migración como completada:', e);
    }
}

// ========================================
// FavoritesModule — Sistema de Likes Unificado
// ========================================
const FavoritesModule = (() => {
    const FAV_KEY = 'favorites'; // Unify with legacy key
    let favIds = new Set();

    // Initialize from StorageModule
    async function init() {
        try {
            const saved = await StorageModule.get(FAV_KEY) || [];
            favIds = new Set(saved.map(item => (item.id || item.videoId)?.toString()).filter(Boolean));
        } catch (e) { console.error('Error loading favorites:', e); }
    }

    async function getFavorites() {
        try {
            return await StorageModule.get(FAV_KEY) || [];
        } catch (e) {
            console.error('Error in getFavorites:', e);
            return [];
        }
    }

    function isFavorite(videoId) {
        if (!videoId) return false;
        return favIds.has(videoId.toString());
    }

    let isTransitioning = false;

    function syncAddFavorite(entry) {
        if (globalThis.auth?.isLoggedIn()) {
            fetch(`${API_URL}/api/user/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...globalThis.auth.getAuthHeaders() },
                body: JSON.stringify(entry)
            }).catch(e => console.error('Server sync error:', e));
        }
    }

    function syncDeleteFavorite(videoId) {
        if (globalThis.auth?.isLoggedIn()) {
            fetch(`${API_URL}/api/user/favorites/${videoId}`, {
                method: 'DELETE',
                headers: globalThis.auth.getAuthHeaders()
            }).catch(e => console.error('Server sync error:', e));
        }
    }

    async function toggleFavorite(video, btnElement) {
        // Robust ID detection
        const videoIdValue = video.id || video.videoId || (typeof extractVideoId === 'function' ? extractVideoId(video.url || video.src) : null);
        if (!videoIdValue) return false;

        if (isTransitioning) return false;
        isTransitioning = true;

        try {
            const videoId = videoIdValue.toString();

            const favorites = await getFavorites();
            const existingIndex = favorites.findIndex(item => (item.id || item.videoId) == videoId);
            const isRemoving = existingIndex >= 0;

            if (isRemoving) {
                favorites.splice(existingIndex, 1);
                favIds.delete(videoId);
                if (typeof showStatus === 'function') showStatus('Eliminado de favoritos', 'info');
                syncDeleteFavorite(videoId);
            } else {
                const entry = {
                    id: videoId,
                    videoId: videoId, // Ensure both are present for compatibility
                    title: video.title || 'Sin título',
                    thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
                    channel: video.channel || 'Desconocido',
                    url: video.url || video.src || `https://www.youtube.com/watch?v=${videoId}`,
                    addedAt: new Date().toISOString(),
                    duration: video.duration
                };
                favorites.unshift(entry);
                favIds.add(videoId);
                if (typeof showStatus === 'function') showStatus('Añadido a favoritos', 'success');
                syncAddFavorite(entry);
            }

            // Save state
            await StorageModule.set(FAV_KEY, favorites);

            // GLOBAL UI REFRESH
            await refreshAllUI(videoId, !isRemoving);

            // Refresh Favorites View if open
            if (globalThis.PlaylistModule?.currentPlaylistId === 'favorites') {
                await globalThis.PlaylistModule.openPlaylistDetail('favorites');
            }

            return !isRemoving;
        } catch (err) {
            console.error('Error in toggleFavorite:', err);
            return false;
        } finally {
            // Unlock after delay
            setTimeout(() => { isTransitioning = false; }, 400);
        }
    }

    /**
     * Actualiza campos de un favorito ya existente. Escribe en IndexedDB,
     * que es la única fuente de verdad (antes se escribía en localStorage).
     */
    async function updateFavorite(videoId, newData) {
        if (!videoId || !newData) return false;

        const favorites = await getFavorites();
        const idx = favorites.findIndex(item => (item.id || item.videoId) == videoId);
        if (idx === -1) return false;

        if (newData.title) favorites[idx].title = newData.title;
        if (newData.thumbnail) favorites[idx].thumbnail = newData.thumbnail;

        await StorageModule.set(FAV_KEY, favorites);
        return true;
    }

    function updateFavoriteButtonsDOM(videoId, isFav) {
        document.querySelectorAll(`.favorite-btn[data-id="${videoId}"]`).forEach(btn => {
            btn.classList.toggle('active', isFav);
            btn.title = isFav ? "Quitar de favoritos" : "Añadir a favoritos";
            const svg = btn.querySelector('svg');
            if (svg) svg.style.fill = isFav ? 'currentColor' : 'none';
        });
    }

    async function refreshOpenPlaylistDetail(currPlId) {
        const detailView = document.getElementById('playlistDetailView');
        if (!detailView || detailView.classList.contains('hidden') || !currPlId) return;

        let plToRefresh = null;
        if (currPlId === 'favorites') {
            const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
            plToRefresh = { id: 'favorites', name: 'Favoritos', songs: lib.filter(s => isFavorite(s.videoId)) };
        } else if (typeof PlaylistModule.getPlaylists === 'function') {
            const playlists = await PlaylistModule.getPlaylists();
            plToRefresh = playlists.find(p => p.id === currPlId);
        }

        if (plToRefresh && typeof PlaylistModule.renderPlaylistSongs === 'function') {
            PlaylistModule.renderPlaylistSongs(plToRefresh);
        }
    }

    async function refreshAllUI(videoId, isFav) {
        // 1. Update all hearts in DOM directly for immediate feedback
        updateFavoriteButtonsDOM(videoId, isFav);

        // 2. Notify Modules
        if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.updateFavBtn === 'function') {
            PlayerModule.updateFavBtn();
        }
        if (typeof PlaylistModule !== 'undefined') {
            if (typeof PlaylistModule.renderGrid === 'function') await PlaylistModule.renderGrid();
            await refreshOpenPlaylistDetail(PlaylistModule.currentPlaylistId);
        }

        // 3. Fallback for legacy renderers
        if (typeof renderFavorites === 'function') await renderFavorites();
    }

    return { getFavorites, isFavorite, toggleFavorite, updateFavorite, refreshAllUI, init };
})();

// ========================================
// Reusable Custom Alert Dialog Overrider
// ========================================
window.alert = function (message) {
    const alertModal = document.getElementById('customAlertModal');
    const alertMsg = document.getElementById('customAlertMessage');
    const alertBtn = document.getElementById('customAlertOkBtn');

    if (alertModal && alertMsg && alertBtn) {
        alertMsg.textContent = message;
        alertModal.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('customAlertModal');
        }

        const closeAlert = () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                alertModal.classList.add('hidden');
            }
        };

        alertBtn.onclick = closeAlert;
        alertModal.querySelector('.auth-modal-backdrop').onclick = closeAlert;
    } else {
        // Safe console fallback during load phases
        console.warn('[CustomAlert] DOM not ready, message:', message);
    }
};

// ========================================
// DOM Elements
// ========================================
const urlInput = document.getElementById('youtubeUrl');
const downloadBtn = document.getElementById('downloadBtn');
const btnText = downloadBtn.querySelector('span');
if (btnText) btnText.textContent = 'Descargar M4A';
const clearBtn = document.getElementById('clearBtn');
const statusMessage = document.getElementById('statusMessage');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const searchResults = document.getElementById('searchResults');
const resultsList = document.getElementById('resultsList');
const themeToggle = document.getElementById('themeToggle');
const qualitySelect = document.getElementById('qualitySelect');

// Playlist Selector Elements
const playlistSelector = document.getElementById('playlistSelector');
const playlistList = document.getElementById('playlistList');
const playlistCount = document.getElementById('playlistCount');
const selectedCount = document.getElementById('selectedCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

// History Elements
const historyToggle = document.getElementById('historyToggle');
const historyContent = document.getElementById('historyContent');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Favorites Elements
const favoritesToggle = document.getElementById('favoritesToggle');
const favoritesContent = document.getElementById('favoritesContent');
const favoritesList = document.getElementById('favoritesList');
const favoritesCount = document.getElementById('favoritesCount');
const favSelectAllBtn = document.getElementById('favSelectAllBtn');
const favDeselectAllBtn = document.getElementById('favDeselectAllBtn');
const downloadFavoritesBtn = document.getElementById('downloadFavoritesBtn');
const favSelectedCount = document.getElementById('favSelectedCount');

// Store playlist videos for selection
// Store playlist videos for selection
let currentPlaylistVideos = [];

// Search Pagination
let currentSearchResults = [];
let currentSearchPage = 0;
const RESULTS_PER_PAGE = 5;

// ========================================
// Configuration
// ========================================
const API_URL = globalThis.Capacitor?.isNative || window.location.protocol.includes('file') || window.location.protocol.includes('capacitor') ? 'https://music.dannarita.es' : '';
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
const HISTORY_MAX_ITEMS = 1000;
const HISTORY_STORAGE_KEY = 'downloadHistory';
const FAVORITES_STORAGE_KEY = 'favorites';

// ========================================
// Language / i18n
// ========================================

const TRANSLATIONS = {
    es: {
        subtitle: 'Descarga tu música favorita en MP3',
        nav_home: 'Inicio',
        nav_library: 'Biblioteca',
        nav_playlists: 'Playlists',
        search_placeholder: 'Busca una canción o pega un enlace...',
        hint: 'Compatible con videos, playlists, YouTube Music o busca por nombre',
        download_btn: 'Descargar MP3',
        search_results_title: 'Selecciona una canción:',
        playlist_content: 'Contenido de la Playlist',
        songs: 'canciones',
        select_all: 'Seleccionar todo',
        deselect_all: 'Deseleccionar todo',
        selected: 'seleccionadas',
        download_selected: 'Descargar Seleccionadas',
        playlist_title_prefix: 'Canciones en la playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Descargar seleccionadas (',
        download_selected_suffix: ')',
        loading: 'Cargando...',
        connecting: 'Conectando con YouTube...',
        searching: 'Buscando en YouTube...',
        downloading_zip: 'Preparando archivo ZIP...',
        download_complete: '¡Descarga completada!',
        zip_complete: '¡{n} canciones descargadas en ZIP!',
        error_search: 'Error al buscar. Inténtalo de nuevo',
        error_download: 'Error al descargar. Inténtalo de nuevo',
        input_error: 'Introduce al menos 2 caracteres para buscar',
        url_error: 'Por favor, introduce un enlace de YouTube o busca una canción',
        initializing: 'Iniciando descarga...',
        downloading: 'Descargando...',
        my_favorites: 'Mis Favoritos',
        download_history: 'Historial de descargas',
        clear_history: 'Borrar historial',
        mix_error: '⚠️ Los "Mix" de YouTube no se pueden descargar. Esto es una limitación de YouTube, no de la aplicación. Los Mix son playlists dinámicas generadas automáticamente.',
        powered_by: 'Powered by',
        personal_use: 'Solo para uso personal',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Alta)',
        quality_max: '320kbps (Máxima)',
        preview_error_restricted: 'El propietario ha bloqueado la reproducción en sitios externos. Descárgala para escucharla.',
        preview_error_not_found: 'El video no ha sido encontrado.',
        preview_error_generic: 'Error al reproducir la previsualización.',
        download_complete_title: '¡Descarga completada!',
        cancel_download: 'Cancelar descarga',
        cancelling: 'Cancelando...',
        sign_in: 'Iniciar sesión',
        sign_out: 'Cerrar sesión',
        sign_in_with_google: 'Continuar con Google',
        sign_in_prompt: 'Inicia sesión',
        sign_in_subtitle: 'Guarda tu historial y favoritos en la nube',
        sign_in_footer: 'Solo usamos tu cuenta para guardar tus datos. No publicamos nada.',
        syncing_data: 'Sincronizando datos...',
        data_synced: '¡Datos sincronizados!',
        logged_in_as: 'Conectado como',
        buy_coffee: 'Invítame a un café',
        logout_confirm_title: '¿Cerrar sesión?',
        logout_confirm_subtitle: '¿Estás seguro de que deseas cerrar tu sesión? Perderás el acceso a tus datos sincronizados.',
        logout_confirm_yes: 'Sí, cerrar sesión',
        logout_confirm_no: 'No, cancelar'
    },
    en: {
        subtitle: 'Download your favorite music in MP3',
        nav_home: 'Home',
        nav_library: 'Library',
        nav_playlists: 'Playlists',
        search_placeholder: 'Search for a song or paste a link...',
        hint: 'Supports single videos, playlists, YouTube Music or search by name',
        download_btn: 'Download MP3',
        search_results_title: 'Select a song:',
        playlist_content: 'Playlist Content',
        songs: 'songs',
        select_all: 'Select All',
        deselect_all: 'Deselect All',
        selected: 'selected',
        download_selected: 'Download Selected',
        playlist_title_prefix: 'Songs in playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Download selected (',
        download_selected_suffix: ')',
        loading: 'Loading...',
        connecting: 'Connecting to YouTube...',
        searching: 'Searching on YouTube...',
        downloading_zip: 'Preparing ZIP file...',
        download_complete: 'Download completed!',
        zip_complete: '¡{n} songs downloaded in ZIP!',
        error_search: 'Search error. Please try again',
        error_download: 'Download error. Please try again',
        input_error: 'Please enter at least 2 characters to search',
        url_error: 'Please enter a YouTube link or search for a song',
        initializing: 'Initializing download...',
        downloading: 'Downloading...',
        my_favorites: 'My Favorites',
        download_history: 'Download History',
        clear_history: 'Clear History',
        mix_error: '⚠️ YouTube "Mixes" cannot be downloaded. This is a YouTube limitation. Mixes are dynamic playlists.',
        powered_by: 'Powered by',
        personal_use: 'For personal use only',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (High)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'The owner has blocked playback on external sites. Download it to listen.',
        preview_error_not_found: 'Video not found.',
        preview_error_generic: 'Error playing preview.',
        download_complete_title: 'Download completed!',
        cancel_download: 'Cancel download',
        cancelling: 'Cancelling...',
        sign_in: 'Sign in',
        sign_out: 'Sign out',
        sign_in_with_google: 'Continue with Google',
        sign_in_prompt: 'Sign in',
        sign_in_subtitle: 'Save your history and favorites to the cloud',
        sign_in_footer: 'We only use your account to save your data. We never post anything.',
        syncing_data: 'Syncing data...',
        data_synced: 'Data synced!',
        logged_in_as: 'Logged in as',
        buy_coffee: 'Buy me a coffee',
        logout_confirm_title: 'Log out?',
        logout_confirm_subtitle: 'Are you sure you want to log out? You will lose access to your synced data.',
        logout_confirm_yes: 'Yes, log out',
        logout_confirm_no: 'No, cancel'
    },
    fr: {
        subtitle: 'Téléchargez votre musique préférée en MP3',
        nav_home: 'Accueil',
        nav_library: 'Bibliothèque',
        nav_playlists: 'Playlists',
        search_placeholder: 'Cherchez une chanson ou collez un lien...',
        hint: 'Prend en charge les vidéos uniques, les playlists, YouTube Music ou la recherche par nom',
        download_btn: 'Télécharger MP3',
        search_results_title: 'Sélectionnez une chanson :',
        playlist_content: 'Contenu de la Playlist',
        songs: 'chansons',
        select_all: 'Tout sélectionner',
        deselect_all: 'Tout désélectionner',
        selected: 'sélectionnés',
        download_selected: 'Télécharger la sélection',
        playlist_title_prefix: 'Chansons dans la playlist (',
        playlist_title_suffix: ') :',
        download_selected_prefix: 'Télécharger la sélection (',
        download_selected_suffix: ')',
        loading: 'Chargement...',
        connecting: 'Connexion à YouTube...',
        searching: 'Recherche sur YouTube...',
        downloading_zip: 'Préparation du fichier ZIP...',
        download_complete: 'Téléchargement terminé !',
        zip_complete: '¡{n} chansons téléchargées en ZIP !',
        error_search: 'Erreur de recherche. Veuillez réessayer',
        error_download: 'Erreur de téléchargement. Veuillez réessayer',
        input_error: 'Veuillez saisir au moins 2 caractères pour rechercher',
        url_error: 'Veuillez saisir un lien YouTube ou rechercher une chanson',
        initializing: 'Initialisation du téléchargement...',
        downloading: 'Téléchargement...',
        my_favorites: 'Mes Favoris',
        download_history: 'Historique des téléchargements',
        clear_history: 'Effacer l\'historique',
        mix_error: '⚠️ Les "Mix" YouTube ne peuvent pas être téléchargés. C\'est une limitation de YouTube. Les Mix sont des playlists dynamiques.',
        powered_by: 'Propulsé par',
        personal_use: 'Pour usage personnel seulement',
        quality_normal: '128kbps (Normale)',
        quality_high: '192kbps (Haute)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'Le propriétaire a bloqué la lecture sur des sites externes. Téléchargez-le pour écouter.',
        preview_error_not_found: 'Vidéo non trouvée.',
        preview_error_generic: 'Erreur lors de la lecture de l\'aperçu.',
        download_complete_title: 'Téléchargement terminé !',
        cancel_download: 'Annuler le téléchargement',
        cancelling: 'Annulation...',
        sign_in: 'Se connecter',
        sign_out: 'Se déconnecter',
        sign_in_with_google: 'Continuer avec Google',
        sign_in_prompt: 'Connectez-vous',
        sign_in_subtitle: 'Sauvegardez votre historique et vos favoris dans le cloud',
        sign_in_footer: 'Nous utilisons votre compte uniquement pour sauvegarder vos données. Nous ne publions rien.',
        syncing_data: 'Synchronisation des données...',
        data_synced: 'Données synchronisées !',
        logged_in_as: 'Connecté en tant que',
        buy_coffee: 'Offrez-moi un café',
        logout_confirm_title: 'Se déconnecter ?',
        logout_confirm_subtitle: 'Êtes-vous sûr de vouloir vous déconnecter ? Vous perdrez l\'accès à vos données synchronisées.',
        logout_confirm_yes: 'Oui, se déconnecter',
        logout_confirm_no: 'Non, annuler'
    },
    de: {
        subtitle: 'Laden Sie Ihre Lieblingsmusik als MP3 herunter',
        nav_home: 'Startseite',
        nav_library: 'Bibliothek',
        nav_playlists: 'Playlists',
        search_placeholder: 'Suchen Sie ein Lied oder fügen Sie einen Link ein...',
        hint: 'Unterstützt einzelne Videos, Playlists, YouTube Music oder Namenssuche',
        download_btn: 'MP3 herunterladen',
        search_results_title: 'Wählen Sie ein Lied:',
        playlist_content: 'Playlist-Inhalt',
        songs: 'Lieder',
        select_all: 'Alles auswählen',
        deselect_all: 'Alles abwählen',
        selected: 'ausgewählt',
        download_selected: 'Ausgewählte herunterladen',
        playlist_title_prefix: 'Lieder in der Playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Ausgewählte herunterladen (',
        download_selected_suffix: ')',
        loading: 'Laden...',
        connecting: 'Verbindung zu YouTube...',
        searching: 'Suche auf YouTube...',
        downloading_zip: 'ZIP-Datei wird vorbereitet...',
        download_complete: 'Download abgeschlossen!',
        zip_complete: '¡{n} Lieder als ZIP heruntergeladen!',
        error_search: 'Suchfehler. Bitte versuchen Sie es erneut',
        error_download: 'Downloadfehler. Bitte versuchen Sie es erneut',
        input_error: 'Geben Sie mindestens 2 Zeichen für die Suche ein',
        url_error: 'Bitte geben Sie einen YouTube-Link ein oder suchen Sie nach einem Lied',
        initializing: 'Download wird gestartet...',
        downloading: 'Herunterladen...',
        my_favorites: 'Meine Favoriten',
        download_history: 'Download-Verlauf',
        clear_history: 'Verlauf löschen',
        mix_error: '⚠️ YouTube "Mixe" können nicht heruntergeladen werden. Dies ist eine Einschränkung von YouTube. Mixe sind dynamische Playlists.',
        powered_by: 'Angetrieben von',
        personal_use: 'Nur für den persönlichen Gebrauch',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Hoch)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'Der Eigentümer hat die Wiedergabe auf externen Websites blockiert. Laden Sie es herunter, um es anzuhören.',
        preview_error_not_found: 'Video nicht gefunden.',
        preview_error_generic: 'Fehler bei der Vorschauwiedergabe.',
        download_complete_title: 'Download abgeschlossen!',
        cancel_download: 'Download abbrechen',
        cancelling: 'Abbrechen...',
        sign_in: 'Anmelden',
        sign_out: 'Abmelden',
        sign_in_with_google: 'Mit Google fortfahren',
        sign_in_prompt: 'Anmelden',
        sign_in_subtitle: 'Speichern Sie Ihren Verlauf und Ihre Favoriten in der Cloud',
        sign_in_footer: 'Wir verwenden Ihr Konto nur zum Speichern Ihrer Daten. Wir veröffentlichen nichts.',
        syncing_data: 'Daten werden synchronisiert...',
        data_synced: 'Daten synchronisiert!',
        logged_in_as: 'Angemeldet als',
        buy_coffee: 'Kauf mir einen Kaffee',
        logout_confirm_title: 'Abmelden?',
        logout_confirm_subtitle: 'Möchten Sie sich wirklich abmelden? Sie verlieren den Zugriff auf Ihre synchronisierten Daten.',
        logout_confirm_yes: 'Ja, abmelden',
        logout_confirm_no: 'Nein, abbrechen'
    },
    pt: {
        subtitle: 'Baixe suas músicas favoritas em MP3',
        nav_home: 'Início',
        nav_library: 'Biblioteca',
        nav_playlists: 'Playlists',
        search_placeholder: 'Pesquise uma música ou cole um link...',
        hint: 'Suporta vídeos únicos, playlists, YouTube Music ou pesquisa por nome',
        download_btn: 'Baixar MP3',
        search_results_title: 'Selecione uma música:',
        playlist_content: 'Conteúdo da Playlist',
        songs: 'músicas',
        select_all: 'Selecionar tudo',
        deselect_all: 'Desmarcar tudo',
        selected: 'selecionados',
        download_selected: 'Baixar Selecionados',
        playlist_title_prefix: 'Músicas na playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Baixar selecionados (',
        download_selected_suffix: ')',
        loading: 'Carregando...',
        connecting: 'Conectando ao YouTube...',
        searching: 'Pesquisando no YouTube...',
        downloading_zip: 'Preparando arquivo ZIP...',
        download_complete: 'Download concluído!',
        zip_complete: '¡{n} músicas baixadas em ZIP!',
        error_search: 'Erro na pesquisa. Tente novamente',
        error_download: 'Erro no download. Tente novamente',
        input_error: 'Digite pelo menos 2 caracteres para pesquisar',
        url_error: 'Por favor, insira um link do YouTube ou pesquise uma música',
        initializing: 'Iniciando download...',
        downloading: 'Baixando...',
        my_favorites: 'Meus Favoritos',
        download_history: 'Histórico de downloads',
        clear_history: 'Limpar histórico',
        mix_error: '⚠️ Os "Mix" do YouTube não podem ser baixados. Esta é uma limitação do YouTube. Mixes são playlists dinâmicas.',
        powered_by: 'Distribuído por',
        personal_use: 'Apenas para uso pessoal',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Alta)',
        quality_max: '320kbps (Máxima)',
        preview_error_restricted: 'O proprietário bloqueou a reprodução em sites externos. Baixe para ouvir.',
        preview_error_not_found: 'Vídeo não encontrado.',
        preview_error_generic: 'Erro ao reproduzir prévia.',
        download_complete_title: 'Download concluído!',
        cancel_download: 'Cancelar download',
        cancelling: 'Cancelando...',
        sign_in: 'Entrar',
        sign_out: 'Sair',
        sign_in_with_google: 'Continuar com o Google',
        sign_in_prompt: 'Faça login',
        sign_in_subtitle: 'Salve seu histórico e favoritos na nuvem',
        sign_in_footer: 'Usamos sua conta apenas para salvar seus dados. Não publicamos nada.',
        syncing_data: 'Sincronizando dados...',
        data_synced: 'Dados sincronizados!',
        logged_in_as: 'Conectado como',
        buy_coffee: 'Pague-me um café',
        logout_confirm_title: 'Sair da conta?',
        logout_confirm_subtitle: 'Tem certeza que deseja sair? Você perderá o acesso aos seus dados sincronizados.',
        logout_confirm_yes: 'Sim, sair',
        logout_confirm_no: 'Não, cancelar'
    },
    zh: {
        subtitle: '以 MP3 格式下载您喜爱的音乐',
        nav_home: '首页',
        nav_library: '媒体库',
        nav_playlists: '播放列表',
        search_placeholder: '搜索歌曲或粘贴链接...',
        hint: '支持单个视频、播放列表、YouTube Music 或按名称搜索',
        download_btn: '下载 MP3',
        search_results_title: '选择一首歌曲：',
        playlist_content: '播放列表内容',
        songs: '首歌曲',
        select_all: '全选',
        deselect_all: '取消全选',
        selected: '已选择',
        download_selected: '下载所选',
        playlist_title_prefix: '播放列表中的歌曲 (',
        playlist_title_suffix: '):',
        download_selected_prefix: '下载所选 (',
        download_selected_suffix: ')',
        loading: '加载中...',
        connecting: '正在连接到 YouTube...',
        searching: '正在 YouTube 上搜索...',
        downloading_zip: '正在准备 ZIP 文件...',
        download_complete: '下载完成！',
        zip_complete: '已下载 {n} 首歌曲到 ZIP！',
        error_search: '搜索错误。请重试',
        error_download: '下载错误。请重试',
        input_error: '请输入至少 2 个字符进行搜索',
        url_error: '请输入 YouTube 链接或搜索歌曲',
        initializing: '正在开始下载...',
        downloading: '正在下载...',
        my_favorites: '我的收藏',
        download_history: '下载历史',
        clear_history: '清除历史',
        mix_error: '⚠️ YouTube "合辑" 无法下载。这是 YouTube 的限制。合辑是自动生成的动态播放列表。',
        powered_by: '技术支持',
        personal_use: '仅供个人使用',
        quality_normal: '128kbps (正常)',
        quality_high: '192kbps (高)',
        quality_max: '320kbps (最大)',
        preview_error_restricted: '所有者已阻止在外部网站上播放。下载以收听。',
        preview_error_not_found: '未找到视频。',
        preview_error_generic: '预览播放错误。',
        download_complete_title: '下载完成！',
        cancel_download: '取消下载',
        cancelling: '正在取消...',
        sign_in: '登录',
        sign_out: '退出',
        sign_in_with_google: '使用 Google 继续',
        sign_in_prompt: '登录',
        sign_in_subtitle: '将您的历史记录和收藏保存到云端',
        sign_in_footer: '我们仅使用您的帐户来保存您的数据。我们不会发布任何内容。',
        syncing_data: '正在同步数据...',
        data_synced: '数据已同步！',
        logged_in_as: '已登录为',
        buy_coffee: '请我喝咖啡',
        logout_confirm_title: '退出登录？',
        logout_confirm_subtitle: '您确定要退出登录吗？您将无法访问已同步的数据。',
        logout_confirm_yes: '是的，退出登录',
        logout_confirm_no: '不，取消'
    }
};

const currentLangDisplays = document.querySelectorAll('.current-lang');

class LanguageManager {
    constructor() {
        this.currentLang = 'es';
    }

    async init() {
        this.currentLang = await StorageModule.get('language') || 'es';
        await this.setLanguage(this.currentLang);

        // Bind all language selectors in the DOM (Desktop & Mobile)
        document.querySelectorAll('.lang-toggle-el').forEach(toggleEl => {
            toggleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuEl = toggleEl.nextElementSibling;
                if (menuEl) menuEl.classList.toggle('hidden');
                toggleEl.parentElement.classList.toggle('open');
            });
        });

        document.addEventListener('click', () => {
            document.querySelectorAll('.lang-menu-el').forEach(menuEl => {
                menuEl.classList.add('hidden');
            });
            document.querySelectorAll('.lang-toggle-el').forEach(toggleEl => {
                toggleEl.parentElement.classList.remove('open');
            });
        });

        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', async () => {
                await this.setLanguage(btn.dataset.lang);
            });
        });
    }

    async setLanguage(lang) {
        this.currentLang = lang;
        await StorageModule.set('language', lang);

        // Update UI Flag
        const startFlags = {
            'es': '<img src="https://flagcdn.com/24x18/es.png" class="lang-flag-current" alt="ES">',
            'en': '<img src="https://flagcdn.com/24x18/gb.png" class="lang-flag-current" alt="EN">',
            'fr': '<img src="https://flagcdn.com/24x18/fr.png" class="lang-flag-current" alt="FR">',
            'de': '<img src="https://flagcdn.com/24x18/de.png" class="lang-flag-current" alt="DE">',
            'pt': '<img src="https://flagcdn.com/24x18/pt.png" class="lang-flag-current" alt="PT">',
            'zh': '<img src="https://flagcdn.com/24x18/cn.png" class="lang-flag-current" alt="ZH">'
        };

        document.querySelectorAll('.current-lang').forEach(el => {
            el.innerHTML = startFlags[lang] || lang.toUpperCase();
        });

        // Update Static Text
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (TRANSLATIONS[lang][key]) {
                el.textContent = TRANSLATIONS[lang][key];
            }
        });

        // Update Placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (TRANSLATIONS[lang][key]) {
                el.placeholder = TRANSLATIONS[lang][key];
            }
        });

        // Update active state in menu
        document.querySelectorAll('.lang-option').forEach(btn => {
            if (btn.dataset.lang === lang) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    t(key, params = {}) {
        let text = TRANSLATIONS[this.currentLang]?.[key] || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    }
}

const i18n = new LanguageManager();

// ========================================
// Auth Manager (Google Sign-In)
// ========================================

const GOOGLE_CLIENT_ID = '938078752300-e59ed4ln5bjeqeb8rfomfjtdtebqcckt.apps.googleusercontent.com';
const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';
// v2: el flag v1 se marcaba aunque el sync no llegase a ocurrir (leía de
// localStorage tras la migración a IndexedDB, y siempre encontraba vacío).
const SYNC_FLAG_KEY = 'data_synced_v2';

// Auth DOM elements (Desktop Sidebar & Mobile Bottom-Nav)
const authLoginBtn = document.getElementById('sidebarAuthLoginBtn');
const authLogoutBtn = document.getElementById('sidebarAuthLogoutBtn');
const userProfile = document.getElementById('sidebarUserProfile');
const userAvatar = document.getElementById('sidebarUserAvatar');
const userName = document.getElementById('sidebarUserName');

const navProfile = document.getElementById('navProfile');
const navProfileIcon = document.getElementById('navProfileIcon');
const navProfileAvatar = document.getElementById('navProfileAvatar');

const authModal = document.getElementById('authModal');
const authModalClose = document.getElementById('authModalClose');
const authModalBackdrop = authModal ? authModal.querySelector('.auth-modal-backdrop') : null;
const googleSignInBtn = document.getElementById('googleSignInBtn');

const logoutConfirmModal = document.getElementById('logoutConfirmModal');
const logoutConfirmYesBtn = document.getElementById('logoutConfirmYesBtn');
const logoutConfirmNoBtn = document.getElementById('logoutConfirmNoBtn');
const logoutConfirmBackdrop = logoutConfirmModal ? logoutConfirmModal.querySelector('.auth-modal-backdrop') : null;

class AuthManager {
    token = localStorage.getItem(AUTH_TOKEN_KEY) || null;
    user = null;
    _serverHistoryCache = null;
    _serverFavoritesCache = null;

    constructor() {
        try {
            const savedUser = localStorage.getItem(AUTH_USER_KEY);
            if (savedUser) this.user = JSON.parse(savedUser);
        } catch (e) { console.debug('[AuthManager] Failed parsing saved user:', e); }

        this.initEventListeners();
    }

    initEventListeners() {
        if (authLoginBtn) authLoginBtn.addEventListener('click', () => this.showModal());
        if (authLogoutBtn) authLogoutBtn.addEventListener('click', () => this.showLogoutConfirm());

        if (navProfile) {
            navProfile.addEventListener('click', () => {
                if (this.isLoggedIn()) {
                    this.showLogoutConfirm();
                } else {
                    this.showModal();
                }
            });
        }

        if (authModalClose) authModalClose.addEventListener('click', () => this.hideModal());
        if (authModalBackdrop) authModalBackdrop.addEventListener('click', () => this.hideModal());

        if (logoutConfirmYesBtn) {
            logoutConfirmYesBtn.addEventListener('click', () => {
                this.hideLogoutConfirm();
                this.logout();
            });
        }
        if (logoutConfirmNoBtn) {
            logoutConfirmNoBtn.addEventListener('click', () => this.hideLogoutConfirm());
        }
        if (logoutConfirmBackdrop) {
            logoutConfirmBackdrop.addEventListener('click', () => this.hideLogoutConfirm());
        }
    }

    async init() {
        // Initialize Google Identity Services
        this.initGoogleSignIn();
        updateEnvironment();

        if (this.token) {
            const valid = await this.checkSession();
            if (valid) {
                this.updateUI(true);
                await this.loadServerData();
            } else {
                this.clearSession();
            }
        }
    }

    showModal() {
        if (authModal) authModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        // Re-render Google button in case modal was just created
        this.renderGoogleButton();
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('authModal');
        }
    }

    hideModal() {
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.closeOverlay();
        } else {
            if (authModal) authModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    showLogoutConfirm() {
        if (logoutConfirmModal) logoutConfirmModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('logoutConfirmModal');
        }
    }

    hideLogoutConfirm() {
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.closeOverlay();
        } else {
            if (logoutConfirmModal) logoutConfirmModal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    }

    initGoogleSignIn() {
        if (typeof google === 'undefined' || !google.accounts) {
            setTimeout(() => this.initGoogleSignIn(), 500);
            return;
        }

        const config = {
            client_id: GOOGLE_CLIENT_ID
        };

        if (IS_NATIVE) {
            // For native Android (WebView), Redirect UX is much more reliable than Popups
            config.ux_mode = 'redirect';
            // Google will POST the credential to this URL
            config.login_uri = `${API_URL}/api/auth/google/native`;
        } else {
            config.callback = (response) => this.handleGoogleCallback(response);
        }

        google.accounts.id.initialize(config);

        this.renderGoogleButton();
    }

    renderGoogleButton() {
        const container = document.getElementById('googleSignInBtn');
        if (!container) return;

        if (IS_NATIVE) {
            // Render a custom, compliant button for native APK
            // Google blocks the official button (iframe) in WebViews
            container.innerHTML = `
                <button id="customGoogleBtn" style="
                    background: #1a73e8; color: #ffffff; border: 1px solid transparent;
                    border-radius: 8px; padding: 0 24px; height: 44px; font-weight: 700;
                    display: flex; align-items: center; justify-content: center;
                    gap: 12px; cursor: pointer; transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1); width: 100%;
                    max-width: 300px; font-size: 14.5px; box-shadow: 0 4px 12px rgba(26, 115, 232, 0.25);
                    font-family: inherit; margin: 0 auto; outline: none;
                ">
                    <svg width="18" height="18" viewBox="0 0 18 18" style="background: white; border-radius: 4px; padding: 3px; flex-shrink:0;">
                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.712s.102-1.172.282-1.712V4.956H.957C.347 6.173 0 7.548 0 9s.347 2.827.957 4.044l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.582C13.463.891 11.426 0 9 0 5.483 0 2.443 2.017.957 4.956L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                    </svg>
                    <span>Continuar con Google</span>
                </button>
            `;

            const btn = document.getElementById('customGoogleBtn');
            if (btn) {
                btn.addEventListener('click', async () => {
                    // Use Capacitor Browser plugin to open in the REAL system browser (Chrome)
                    // window.open('...', '_system') opens a Chrome Custom Tab which does NOT
                    // share cookies/sessions with Chrome, causing Google Auth to fail.
                    try {
                        if (globalThis.Capacitor?.Plugins?.Browser) {
                            await globalThis.Capacitor.Plugins.Browser.open({
                                url: 'https://music.dannarita.es/auth/native',
                                presentationStyle: 'fullscreen'
                            });
                        } else {
                            // Fallback if Browser plugin not available
                            globalThis.open('https://music.dannarita.es/auth/native', '_blank', 'noopener');
                        }
                    } catch (e) {
                        console.error('[NativeAuth] Error opening browser:', e);
                        globalThis.open('https://music.dannarita.es/auth/native', '_blank', 'noopener');
                    }
                });

                // Add hover style effect elastically
                btn.addEventListener('mouseenter', () => {
                    btn.style.transform = 'translateY(-1.5px)';
                    btn.style.boxShadow = '0 6px 20px rgba(26, 115, 232, 0.45)';
                    btn.style.background = '#155cb4';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.transform = '';
                    btn.style.boxShadow = '0 4px 12px rgba(26, 115, 232, 0.25)';
                    btn.style.background = '#1a73e8';
                });
            }
        } else {
            if (typeof google === 'undefined' || !google.accounts) {
                // FALLBACK: If google GSI script is blocked/offline, show a helpful message and retry option
                container.innerHTML = `
                    <div class="google-fallback-container" style="
                        text-align: center; color: var(--text-muted); font-size: 0.85rem; 
                        padding: 20px 15px; border: 1px dashed var(--border-subtle); border-radius: 8px; 
                        background: rgba(255,255,255,0.02); display: flex; flex-direction: column; align-items: center; gap: 10px;
                    ">
                        <span class="material-symbols-outlined" style="font-size: 28px; color: var(--text-muted);">cloud_off</span>
                        <span>Google Sign-In no pudo cargarse (bloqueado o sin conexión).</span>
                        <button id="webGoogleFallbackBtn" style="
                            background: var(--accent); color: var(--bg); border: none;
                            border-radius: 6px; padding: 8px 16px; font-size: 0.8rem;
                            cursor: pointer; width: 100%; font-weight: 700; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                        ">Reintentar Cargar Google</button>
                    </div>
                `;
                const retryBtn = document.getElementById('webGoogleFallbackBtn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        retryBtn.textContent = 'Intentando recargar...';
                        const existingScript = document.querySelector('script[src*="gsi/client"]');
                        if (existingScript) existingScript.remove();
                        const script = document.createElement('script');
                        script.src = 'https://accounts.google.com/gsi/client';
                        script.async = true;
                        script.defer = true;
                        script.onload = () => {
                            this.initGoogleSignIn();
                        };
                        script.onerror = () => {
                            retryBtn.textContent = 'Reintentar Cargar Google';
                            if (typeof showStatus === 'function') showStatus('No se pudo cargar el script de Google.', 'error');
                        };
                        document.head.appendChild(script);
                    });
                }
                return;
            }
            // Clear old content and render official Google button
            container.innerHTML = '';
            google.accounts.id.renderButton(container, {
                theme: 'filled_black',
                size: 'large',
                width: 300,
                text: 'continue_with',
                shape: 'pill'
            });
        }
    }

    async handleGoogleCallback(response) {
        if (!response.credential) {
            console.error('No credential in Google response');
            return;
        }

        try {
            showStatus(i18n.t('syncing_data'), 'info');

            const res = await fetch(`${API_URL}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Authentication failed');
            }

            const data = await res.json();
            this.token = data.token;
            this.user = data.user;

            localStorage.setItem(AUTH_TOKEN_KEY, this.token);
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(this.user));

            this.hideModal();
            this.updateUI(true);

            // Sync localStorage data to server
            await this.syncLocalData();

            showStatus(`${i18n.t('logged_in_as')} ${this.user.name}`, 'success');
        } catch (error) {
            console.error('Login error:', error);
            showStatus(error.message || 'Login failed', 'error');
        }
    }

    async checkSession() {
        try {
            const res = await fetch(`${API_URL}/api/auth/me`, {
                headers: this.getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                this.user = data.user;
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(this.user));
                return true;
            }
            return false;
        } catch (e) {
            console.warn('Session check failed:', e);
            return false;
        }
    }

    async syncLocalData() {
        // Only sync once ever — if already synced before, just load server data.
        // Flag versionado (v2): el v1 se marcaba aunque el sync nunca ocurriese,
        // así que todo el mundo reintenta una vez con el código ya corregido.
        if (localStorage.getItem(SYNC_FLAG_KEY)) {
            await this.loadServerData();
            return;
        }

        // Los datos viven en IndexedDB desde migrateStorage(), no en localStorage
        let localHistory = [];
        let localFavorites = [];

        try {
            localHistory = await StorageModule.get(HISTORY_STORAGE_KEY) || [];
        } catch (e) { console.debug('[AuthManager] No se pudo leer el historial local:', e); }

        try {
            localFavorites = await StorageModule.get(FAVORITES_STORAGE_KEY) || [];
        } catch (e) { console.debug('[AuthManager] No se pudieron leer los favoritos locales:', e); }

        if (localHistory.length === 0 && localFavorites.length === 0) {
            // Nada que subir: se marca como sincronizado y se cargan los datos del servidor
            localStorage.setItem(SYNC_FLAG_KEY, 'true');
            await this.loadServerData();
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/user/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({
                    history: localHistory,
                    favorites: localFavorites
                })
            });

            if (res.ok) {
                const data = await res.json();
                this._serverHistoryCache = data.history;
                this._serverFavoritesCache = data.favorites;
                // Solo se marca como sincronizado si el servidor ha confirmado.
                // Si falla la red, el próximo login reintenta en vez de darlo por hecho.
                localStorage.setItem(SYNC_FLAG_KEY, 'true');
                renderHistory();
                renderFavorites();
            } else {
                console.warn(`[AuthManager] Sync rechazado por el servidor (${res.status}); se reintentará.`);
            }
        } catch (e) {
            console.error('Sync error:', e);
        }
    }

    async loadServerData() {
        try {
            const [historyRes, favoritesRes] = await Promise.all([
                fetch(`${API_URL}/api/user/history`, { headers: this.getAuthHeaders() }),
                fetch(`${API_URL}/api/user/favorites`, { headers: this.getAuthHeaders() })
            ]);

            if (historyRes.ok) {
                const hData = await historyRes.json();
                this._serverHistoryCache = hData.history;
            }
            if (favoritesRes.ok) {
                const fData = await favoritesRes.json();
                this._serverFavoritesCache = fData.favorites;
            }

            renderHistory();
            renderFavorites();
        } catch (e) {
            console.error('Failed to load server data:', e);
        }
    }

    logout() {
        this.clearSession();
        this.updateUI(false);
        this._serverHistoryCache = null;
        this._serverFavoritesCache = null;
        renderHistory();
        renderFavorites();
        showStatus(i18n.t('sign_out'), 'info');
    }

    clearSession() {
        this.token = null;
        this.user = null;
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
    }

    updateLoggedInUI() {
        // Update Desktop Sidebar
        if (authLoginBtn) authLoginBtn.classList.add('hidden');
        if (userProfile) userProfile.classList.remove('hidden');
        if (userAvatar) {
            userAvatar.src = this.user.picture || '';
            userAvatar.style.display = '';
            userAvatar.onerror = () => { userAvatar.style.display = 'none'; };
        }
        if (userName) userName.textContent = this.user.name || this.user.email;

        // Update Mobile Bottom-Nav
        if (navProfileIcon) navProfileIcon.classList.add('hidden');
        if (navProfileAvatar) {
            navProfileAvatar.src = this.user.picture || '';
            navProfileAvatar.classList.remove('hidden');
            navProfileAvatar.onerror = () => {
                navProfileAvatar.classList.add('hidden');
                if (navProfileIcon) navProfileIcon.classList.remove('hidden');
            };
        }
        const profileText = navProfile ? navProfile.querySelector('span') : null;
        if (profileText) profileText.textContent = i18n.currentLang === 'es' ? 'Salir' : 'Logout';
    }

    updateLoggedOutUI() {
        // Update Desktop Sidebar
        if (authLoginBtn) authLoginBtn.classList.remove('hidden');
        if (userProfile) userProfile.classList.add('hidden');

        // Update Mobile Bottom-Nav
        if (navProfileIcon) navProfileIcon.classList.remove('hidden');
        if (navProfileAvatar) {
            navProfileAvatar.classList.add('hidden');
            navProfileAvatar.src = '';
        }
        const profileText = navProfile ? navProfile.querySelector('span') : null;
        if (profileText) profileText.textContent = i18n.currentLang === 'es' ? 'Perfil' : 'Profile';
    }

    updateUI(loggedIn) {
        if (loggedIn && this.user) {
            this.updateLoggedInUI();
        } else {
            this.updateLoggedOutUI();
        }
    }

    isLoggedIn() {
        return !!this.token && !!this.user;
    }

    getAuthHeaders() {
        if (this.token) {
            return { 'Authorization': `Bearer ${this.token}` };
        }
        return {};
    }
}

const auth = new AuthManager();

// ========================================
// Utility Functions
// ========================================

function isValidInput(input) {
    const trimmed = input.trim();
    return YOUTUBE_URL_PATTERN.test(trimmed) || trimmed.length >= 2;
}

function isUrl(input) {
    return YOUTUBE_URL_PATTERN.test(input.trim());
}

function isPlaylistUrl(input) {
    const url = input.trim();
    // Check for playlist URL (list=PL... or list=RD...)
    const hasPlaylistParam = /[?&]list=/.test(url);
    // Allow any playlist including RD (Mixes)
    return hasPlaylistParam;
}

function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} visible`;
}

function hideStatus() {
    statusMessage.className = 'status-message';
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

function showProgress() {
    progressSection.classList.remove('hidden');
    updateProgress(0, i18n.t('initializing'));
}

function hideProgress() {
    progressSection.classList.add('hidden');
}

function showSearchResults() {
    searchResults.classList.remove('hidden');
}

function hideSearchResults() {
    searchResults.classList.add('hidden');
    resultsList.innerHTML = '';
}

function showPlaylistSelector() {
    playlistSelector.classList.remove('hidden');
}

function hidePlaylistSelector() {
    playlistSelector.classList.add('hidden');
    playlistList.innerHTML = '';
    currentPlaylistVideos = [];
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function setLoading(loading) {
    if (loading) {
        downloadBtn.classList.add('loading');
        downloadBtn.disabled = true;
    } else {
        downloadBtn.classList.remove('loading');
        downloadBtn.disabled = false;
    }
}

function downloadBlob(blob, filename) {
    const url = globalThis.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    globalThis.URL.revokeObjectURL(url);
}

/**
 * Caché de object URLs para el audio guardado en IndexedDB.
 *
 * Un object URL mantiene vivo su blob hasta que se revoca, así que sin techo
 * reproducir 40 canciones retiene cientos de MB. El límite de 5 deja resueltas
 * la canción actual y sus vecinas en la cola, que es lo único que necesita
 * el reproductor.
 */
const AudioUrlCache = (() => {
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

/**
 * Convierte un ArrayBuffer a Base64 de forma eficiente sin saturar la pila
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCodePoint(bytes[i]);
    }
    return globalThis.btoa(binary);
}

// ========================================
// Progress Polling
// ========================================

function updateBatchETA(data, total, etaState) {
    if (data.status !== 'downloading' || total <= 1) return;

    if (data.current > etaState.lastCurrent) {
        const elapsed = (Date.now() - etaState.startTime) / 1000;
        const avgTimePerItem = elapsed / data.current;
        const remaining = total - data.current;
        etaState.etaSeconds = Math.round(remaining * avgTimePerItem);
        etaState.lastCurrent = data.current;
    } else if (etaState.etaSeconds !== null && etaState.etaSeconds > 0) {
        etaState.etaSeconds--;
    }

    if (etaState.etaSeconds === null || data.current <= 0) return;

    const mins = Math.floor(etaState.etaSeconds / 60);
    const secs = etaState.etaSeconds % 60;
    const etaStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const cleanMsg = data.message.split(' - ETA:')[0];
    data.message = `${cleanMsg} - ETA: ${etaStr}`;
}

function updateQueueUI(downloadId, data, total) {
    if (globalThis.queueManager === undefined) return;

    let qPercent = 0;
    if (data.status === 'complete') qPercent = 100;
    else if (total > 0) qPercent = (data.current / total) * 100;

    if (data.status === 'downloading') {
        if (total === 1 && data.current === 0) qPercent = 50;
        queueManager.update(downloadId, qPercent, data.message || i18n.t('downloading'), data);
    } else if (data.status === 'complete') {
        queueManager.complete(downloadId);
    }
}

function handlePollStatus(data, total, downloadId, pollInterval) {
    switch (data.status) {
        case 'downloading': {
            const percent = total > 0
                ? Math.min(10 + (data.current / total) * 80, 90)
                : 50;
            updateProgress(percent, data.message);
            return null;
        }
        case 'complete':
            clearInterval(pollInterval);
            updateProgress(95, data.message);
            if (data.video_id && (data.title || data.thumbnail)) {
                updateHistoryItem(data.video_id, { title: data.title, thumbnail: data.thumbnail });
                updateFavoriteItem(data.video_id, { title: data.title, thumbnail: data.thumbnail });
            }
            return { resolved: true, value: data };
        case 'error':
            clearInterval(pollInterval);
            if (globalThis.queueManager !== undefined) queueManager.remove(downloadId);
            return { resolved: false, error: new Error(data.message) };
        case 'cancelled':
            clearInterval(pollInterval);
            return { resolved: true, value: { cancelled: true } };
        case 'starting':
            updateProgress(5, data.message);
            return null;
        default:
            return null;
    }
}

async function pollProgress(downloadId, total) {
    const etaState = { startTime: Date.now(), lastCurrent: 0, etaSeconds: null };

    return new Promise((resolve, reject) => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`${API_URL}/api/progress/${downloadId}`);
                const data = await response.json();

                updateBatchETA(data, total, etaState);
                updateQueueUI(downloadId, data, total);

                const result = handlePollStatus(data, total, downloadId, pollInterval);
                if (result?.resolved) resolve(result.value);
                else if (result && !result.resolved) reject(result.error);
            } catch (err) {
                console.warn('Poll error:', err);
            }
        }, 1000);

        // Timeout after 30 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            reject(new Error('La descarga tardó demasiado'));
        }, 30 * 60 * 1000);
    });
}

// ========================================
// Main Download Function
// ========================================

async function handleDownload() {
    const input = urlInput.value.trim();

    if (!input) {
        showStatus(i18n.t('url_error'), 'error');
        urlInput.focus();
        return;
    }

    if (!isValidInput(input)) {
        showStatus(i18n.t('input_error'), 'error');
        urlInput.focus();
        return;
    }

    hideStatus();
    hideSearchResults();
    hidePlaylistSelector();

    // Check if it's a playlist URL first
    if (isPlaylistUrl(input)) {
        await fetchAndShowPlaylist(input);
    } else if (isUrl(input)) {
        await downloadFromUrl(input);
    } else {
        await searchAndShowResults(input);
    }
}

async function searchAndShowResults(query) {
    setLoading(true);
    showProgress();
    updateProgress(30, i18n.t('searching'));

    try {
        const response = await fetch(`${API_URL}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al buscar');
        }

        const { results } = await response.json();
        hideProgress();
        renderSearchResults(results);

    } catch (error) {
        console.error('Search error:', error);
        hideProgress();
        const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al buscar. Inténtalo de nuevo');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderSearchResults(results) {
    // Initialize new search
    currentSearchResults = results;
    currentSearchPage = 0;
    resultsList.innerHTML = '';

    showNextPage();
    showSearchResults();
}

function showNextPage() {
    // Remove existing "Load More" button if present
    const existingBtn = document.getElementById('loadMoreContainer');
    if (existingBtn) existingBtn.remove();

    const start = currentSearchPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    const pageItems = currentSearchResults.slice(start, end);

    pageItems.forEach(video => {
        const item = document.createElement('div');
        item.className = 'result-item';

        // Extract video ID from URL
        const videoId = extractVideoId(video.url);

        const isFav = FavoritesModule.isFavorite(videoId);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = `
            <button class="preview-btn" data-video-id="${videoId}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${videoId}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="result-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="result-info">
                <div class="result-title">${video.title}</div>
                <div class="result-meta">
                    <span class="result-channel">${video.channel}</span>
                    ${video.duration ? `<span class="result-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(videoId, previewBtn);
        });

        // Favorite click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(video, favBtn);
        });

        // Download click handler (on rest of the item)
        const thumbnail = item.querySelector('.result-thumbnail');
        const infoArea = item.querySelector('.result-info');

        const startDownload = () => {
            stopPreview();
            // Do NOT hide search results to allow multiple downloads
            // hideSearchResults();

            // Pass the item element for visual feedback (background mode)
            downloadFromUrl(video.url, video, { item });
        };

        thumbnail.style.cursor = 'pointer';
        thumbnail.addEventListener('click', startDownload);
        infoArea.style.cursor = 'pointer';
        infoArea.addEventListener('click', startDownload);

        resultsList.appendChild(item);
    });

    currentSearchPage++;

    // Add Load More button if there are more results
    if (end < currentSearchResults.length) {
        const btnContainer = document.createElement('div');
        btnContainer.id = 'loadMoreContainer';
        btnContainer.className = 'load-more-container';
        btnContainer.innerHTML = `<button class="load-more-btn">Cargar más resultados (${currentSearchResults.length - end} restantes)...</button>`;

        btnContainer.querySelector('button').addEventListener('click', showNextPage);
        resultsList.appendChild(btnContainer);
    }
}

// Extract video ID from YouTube URL or Local Stream Path
function extractVideoId(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('blob:')) return null; // Cannot extract from blob URLs

    // Check for app-specific local stream format /api/stream/ID
    if (url.includes('/api/stream/')) {
        const parts = url.split('/');
        return parts.at(-1);
    }

    // Check for app-specific local path format ytmusic_VIDEOID.m4a
    if (url.includes('ytmusic_')) {
        const localMatch = /ytmusic_([\w-]{8,11})/.exec(url);
        if (localMatch) return localMatch[1];
    }

    const match = /(?:v=|\/)([\w-]{8,11})(?:\?|&|$)/.exec(url);
    return match ? match[1] : null;
}

function disableUIElement(uiElements) {
    if (!uiElements?.item) return;
    uiElements.item.style.opacity = '0.7';
    uiElements.item.style.pointerEvents = 'none';
}

function resetUIElement(uiElements, borderColor = '') {
    if (!uiElements?.item) return;
    uiElements.item.style.opacity = '1';
    uiElements.item.style.pointerEvents = 'auto';
    if (borderColor) uiElements.item.style.borderColor = borderColor;
}

function getErrorMessage(error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return 'No se puede conectar al servidor. Asegúrate de que está ejecutándose';
    }
    if (error.message === 'MIX_PLAYLIST_ERROR') return i18n.t('mix_error');
    return error.message || 'Error al descargar. Inténtalo de nuevo';
}

function buildHistoryEntry(url, videoInfo, finalProgressData) {
    const videoId = extractVideoId(url) || finalProgressData.video_id;
    const fallbackThumb = 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png';
    const title = finalProgressData.title
        || (videoInfo?.title !== 'YouTube Video' ? videoInfo.title : null)
        || 'Descarga';
    return {
        id: videoId || videoInfo?.id,
        title,
        url,
        thumbnail: finalProgressData.thumbnail || videoInfo?.thumbnail || fallbackThumb,
        channel: videoInfo?.channel || 'YouTube',
        downloadedAt: new Date().toISOString()
    };
}

function handleDownloadCancel(isBackground, uiElements) {
    if (!isBackground) hideProgress();
    resetUIElement(uiElements);
    setLoading(false);
}

function handleDownloadSuccess(isBackground, uiElements, videoInfo) {
    if (!isBackground) {
        showSuccessAnimation();
        setTimeout(() => { showStatus(i18n.t('download_complete'), 'success'); hideProgress(); }, 1000);
    } else {
        showStatus(`¡Descargado! ${videoInfo?.title || 'Video'}`, 'success');
        resetUIElement(uiElements, 'var(--success-color)');
    }
}

function handleDownloadError(error, isBackground, uiElements) {
    console.error('Download error:', error);
    if (!isBackground) hideProgress();
    resetUIElement(uiElements, 'var(--error-color)');
    showStatus(getErrorMessage(error), 'error');
}

function ensureVideoInfo(videoInfo, download_id, title, thumbnail) {
    if (videoInfo?.title && videoInfo.title !== 'YouTube Video') return videoInfo;

    let realTitle = title || 'YouTube Video';
    let realChannel = 'YouTube';

    // Try to infer the channel from "Artist - Song" title patterns
    if (realTitle.includes(' - ')) {
        const parts = realTitle.split(' - ');
        realChannel = parts[0].trim();
        realTitle = parts.slice(1).join(' - ').trim();
    }

    return {
        id: download_id,
        title: realTitle,
        thumbnail: thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
        channel: realChannel
    };
}

async function saveToNativeCapacitor(download_id, videoInfo, downloadUrl, finalProgressData) {
    const fs = globalThis.Capacitor.Plugins.Filesystem;
    const sanitizedTitle = sanitizeFilename(videoInfo.title || 'audio');
    const fileExt = '.m4a';
    const fileName = `${sanitizedTitle}${fileExt}`;
    const folderName = 'YTMusic';
    const publicDocsPath = `${folderName}/${fileName}`;

    const uuid = download_id || Math.random().toString(36).substring(2, 10);
    const internalNativePath = `imported_${uuid}_${fileName}`;

    // Ensure public folder exists
    try {
        await fs.mkdir({
            path: folderName,
            directory: 'DOCUMENTS',
            recursive: true
        });
    } catch (e) { console.debug('[Filesystem] mkdir documents ignored:', e); }

    // Download to App's isolated DATA sandbox
    const response = await fetch(downloadUrl);
    const blob = await response.blob();
    await writeBlobToNativeFilesystem(fs, internalNativePath, publicDocsPath, blob);

    const writeResult = await fs.getUri({ path: internalNativePath, directory: 'DATA' });
    const streamUrl = globalThis.Capacitor.convertFileSrc(writeResult.uri);

    // Save thumbnail as DataURL
    const thumbUrl = videoInfo.thumbnail || finalProgressData?.thumbnail;
    const offlineBase64Thumb = await downloadOfflineThumbnail(thumbUrl);

    fetch(`${API_URL}/api/download/${download_id}`, { method: 'DELETE' }).catch(() => { });

    return { streamUrl, localPath: internalNativePath, offlineBase64Thumb };
}

async function downloadFromUrl(url, videoInfo = null, uiElements = null) {
    const isBackground = !!uiElements;
    setLoading(true);

    if (!isBackground) {
        showProgress();
        updateProgress(5, i18n.t('connecting'));
    } else {
        showStatus(`${i18n.t('initializing')}: ${videoInfo?.title || 'Download'}`, 'info');
        disableUIElement(uiElements);
    }

    try {
        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, quality }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id, total, title, thumbnail } = await startResponse.json();
        videoInfo = ensureVideoInfo(videoInfo, download_id, title, thumbnail);

        if (globalThis.queueManager !== undefined) {
            queueManager.add(download_id, videoInfo);
        }

        if (!isBackground) {
            updateProgress(10, total > 1 ? `Preparando descarga de ${total} canciones...` : 'Descargando...');
        }

        const finalProgressData = await pollProgress(download_id, total);

        if (finalProgressData.cancelled) {
            handleDownloadCancel(isBackground, uiElements);
            return;
        }

        if (!isBackground) updateProgress(100, '¡Descarga completada!');

        const downloadUrl = `${API_URL}/api/download/${download_id}`;
        const { streamUrl, localPath, offlineBase64Thumb } = await saveDownloadToApp(download_id, videoInfo, downloadUrl, finalProgressData);

        if (total === 1) addToHistory(buildHistoryEntry(url, videoInfo, finalProgressData));

        const libEntry = {
            src: streamUrl,
            localPath: localPath,
            title: finalProgressData?.title || videoInfo?.title || 'Sin título',
            channel: finalProgressData?.channel || videoInfo?.channel || videoInfo?.uploader || 'Artista desconocido',
            thumbnail: typeof offlineBase64Thumb === 'string' ? offlineBase64Thumb : (finalProgressData?.thumbnail || videoInfo?.thumbnail || ''),
            videoId: videoInfo?.id || videoInfo?.videoId || '',
            downloadedAt: new Date().toISOString()
        };
        if (typeof LibraryModule !== 'undefined') {
            LibraryModule.addSong(libEntry);
        }

        handleDownloadSuccess(isBackground, uiElements, videoInfo);

    } catch (error) {
        handleDownloadError(error, isBackground, uiElements);
    } finally {
        setLoading(false);
    }
}

// ========================================
// Event Listeners
// ========================================

downloadBtn.addEventListener('click', handleDownload);

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleDownload();
    }
});

urlInput.addEventListener('input', () => {
    if (statusMessage.classList.contains('visible')) {
        hideStatus();
    }
});

// Clear button functionality
clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    hideStatus();
    hidePlaylistSelector();
    urlInput.focus();
});

// ========================================
// Playlist Selector Functions
// ========================================

async function fetchAndShowPlaylist(url) {
    setLoading(true);
    showProgress();
    updateProgress(30, 'Obteniendo canciones de la playlist...');

    try {
        const response = await fetch(`${API_URL}/api/playlist-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al obtener la playlist');
        }

        const { videos } = await response.json();
        hideProgress();
        renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al obtener la playlist');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistList.innerHTML = '';
    playlistCount.textContent = videos.length;

    videos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item selected';
        item.dataset.index = index;

        const isFav = FavoritesModule.isFavorite(video.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = `
            <input type="checkbox" class="playlist-checkbox" data-index="${index}" checked>
            <button class="preview-btn" data-video-id="${video.id}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${video.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="playlist-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="playlist-info">
                <div class="playlist-item-title">${video.title}</div>
                <div class="playlist-meta">
                    <span class="playlist-channel">${video.channel}</span>
                    ${video.duration ? `<span class="playlist-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview button click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(video.id, previewBtn);
        });

        // Favorite button click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(video, favBtn);
        });

        // Toggle selection on click (but not on checkbox or preview button)
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.preview-btn')) {
                const checkbox = item.querySelector('.playlist-checkbox');
                checkbox.checked = !checkbox.checked;
            }
            item.classList.toggle('selected', item.querySelector('.playlist-checkbox').checked);
            updateSelectedCount();
        });

        playlistList.appendChild(item);
    });

    updateSelectedCount();
    showPlaylistSelector();
}

function updateSelectedCount() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const count = checkboxes.length;
    selectedCount.textContent = count;
    downloadSelectedBtn.disabled = count === 0;
}

function selectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.add('selected');
        item.querySelector('.playlist-checkbox').checked = true;
    });
    updateSelectedCount();
}

function deselectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.remove('selected');
        item.querySelector('.playlist-checkbox').checked = false;
    });
    updateSelectedCount();
}

async function downloadSelectedPlaylistVideos() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = Number.parseInt(cb.dataset.index);
        return currentPlaylistVideos[index];
    });

    if (selectedVideos.length === 0) {
        showStatus('Selecciona al menos una canción', 'error');
        return;
    }

    hidePlaylistSelector();
    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    // If only one song, use regular single download
    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Check for Mobile/Tablet
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Mobile specific: If > 2 songs, download individually to avoid huge ZIPs
    if (isMobile && total > 2) {
        try {
            // Processing Queue with Concurrency Limit
            const CONCURRENCY_LIMIT = 5;
            let activeCount = 0;
            let completedCount = 0;
            let queueIndex = 0;
            const errors = [];

            updateProgress(5, `Iniciando descarga paralela (${selectedVideos.length} canciones)...`);

            await new Promise((resolve) => {
                function processNext() {
                    while (activeCount < CONCURRENCY_LIMIT && queueIndex < total) {
                        const video = selectedVideos[queueIndex++];
                        activeCount++;

                        // Use M4A optimized single download endpoint
                        downloadFromUrl(video.url, video)
                            .catch(err => {
                                console.error('Download error:', err);
                                errors.push(video.title);
                            })
                            .finally(() => {
                                activeCount--;
                                completedCount++;
                                const percent = Math.round((completedCount / total) * 100);
                                updateProgress(percent, `Descargando: ${completedCount}/${total} (${percent}%)`);

                                if (completedCount === total) {
                                    resolve();
                                } else {
                                    processNext();
                                }
                            });
                    }
                }
                processNext();
            });

            setLoading(false);
            hideProgress();

            if (errors.length > 0) {
                showStatus(`Completado con ${errors.length} error(es)`, 'warning');
            } else {
                showStatus(i18n.t('download_complete'), 'success');
                showSuccessAnimation();
            }

        } catch (error) {
            console.error('Mobile parallel batch error:', error);
            showStatus('Error en la descarga paralela.', 'error');
            hideProgress();
        } finally {
            setLoading(false);
        }
        return; // Stop here, don't do ZIP logic
    }

    // Multiple songs: use batch download (will be packaged as ZIP)
    try {
        updateProgress(5, i18n.t('initializing'));

        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, quality }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        // Add to visual queue manager for batch download
        if (globalThis.queueManager !== undefined) {
            const batchInfo = {
                id: download_id,
                title: `Descargando ${total} canciones...`,
                thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
                channel: 'Playlist'
            };
            queueManager.add(download_id, batchInfo);
        }

        // Poll for progress
        const finalProgressData = await pollProgress(download_id, total);

        // Check if download was cancelled - skip everything if so
        if (finalProgressData.cancelled) {
            hideProgress();
            setLoading(false);
            showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
            return; // Exit early, don't download or save to history
        }

        // Download the ZIP file
        updateProgress(100, '¡Descarga completada!');

        setTimeout(() => {
            window.location.href = `${API_URL}/api/download/${download_id}`;

            showSuccessAnimation();
            setTimeout(() => {
                hideProgress();
                showStatus(i18n.t('zip_complete', { n: total }), 'success');
            }, 1000);
        }, 300);

        // Add all downloaded videos to history
        selectedVideos.forEach(video => {
            addToHistory({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                channel: video.channel,
                url: video.url,
                duration: video.duration
            });
        });

    } catch (error) {
        console.error('Batch download error:', error);
        hideProgress();
        showStatus(error.message || 'Error al descargar. Inténtalo de nuevo', 'error');
    } finally {
        setLoading(false);
    }
}

// Playlist selector button event listeners
if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPlaylistItems);
if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllPlaylistItems);
if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelectedPlaylistVideos);

// Favorites selection button event listeners
if (favSelectAllBtn) favSelectAllBtn.addEventListener('click', selectAllFavorites);
if (favDeselectAllBtn) favDeselectAllBtn.addEventListener('click', deselectAllFavorites);
if (downloadFavoritesBtn) downloadFavoritesBtn.addEventListener('click', downloadSelectedFavorites);

// ========================================
// Download History
// ========================================

async function getDownloadHistory() {
    // If logged in, use server cache
    if (typeof auth !== 'undefined' && auth.isLoggedIn() && auth._serverHistoryCache) {
        return auth._serverHistoryCache;
    }
    // Fallback to StorageModule
    try {
        return await StorageModule.get(HISTORY_STORAGE_KEY) || [];
    } catch (e) {
        console.error('Error reading history:', e);
        return [];
    }
}

async function saveDownloadHistory(history) {
    try {
        await StorageModule.set(HISTORY_STORAGE_KEY, history);
    } catch (e) {
        console.error('Error saving history:', e);
    }
}

async function addToHistory(video) {
    const entry = {
        id: video.id || extractVideoId(video.url),
        title: video.title,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id || extractVideoId(video.url)}/mqdefault.jpg`,
        channel: video.channel || 'Desconocido',
        url: video.url,
        downloadedAt: new Date().toISOString()
    };

    // If logged in, save to server
    if (globalThis.auth?.isLoggedIn()) {
        fetch(`${API_URL}/api/user/history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...globalThis.auth.getAuthHeaders()
            },
            body: JSON.stringify(entry)
        }).then(res => {
            if (res.ok) {
                // Refresh server cache
                return fetch(`${API_URL}/api/user/history`, { headers: globalThis.auth.getAuthHeaders() });
            }
        }).then(res => res?.ok ? res.json() : null).then(data => {
            if (data) {
                globalThis.auth._serverHistoryCache = data.history;
                renderHistory();
            }
        }).catch(e => console.error('Server history save error:', e));
    }

    // Always also save to localStorage/IndexedDB
    const history = await getDownloadHistory();
    const filteredHistory = history.filter(item => item.id !== entry.id);
    filteredHistory.unshift(entry);
    const trimmedHistory = filteredHistory.slice(0, typeof HISTORY_MAX_ITEMS !== 'undefined' ? HISTORY_MAX_ITEMS : 50);
    await saveDownloadHistory(trimmedHistory);
    await renderHistory();
}

async function updateHistoryItem(videoId, newData) {
    const history = await getDownloadHistory();
    const index = history.findIndex(item => item.id === videoId);

    if (index !== -1) {
        // Update fields if provided
        if (newData.title) history[index].title = newData.title;
        if (newData.thumbnail) history[index].thumbnail = newData.thumbnail;

        await saveDownloadHistory(history);
        await renderHistory();
    }
}

async function clearHistory() {
    if (confirm('¿Estás seguro de que quieres limpiar el historial?')) {
        await StorageModule.remove(HISTORY_STORAGE_KEY);

        // If logged in, also clear on server
        if (globalThis.auth?.isLoggedIn()) {
            fetch(`${API_URL}/api/user/history`, {
                method: 'DELETE',
                headers: globalThis.auth.getAuthHeaders()
            }).then(async () => {
                globalThis.auth._serverHistoryCache = [];
                await renderHistory();
            }).catch(e => console.error('Server history clear error:', e));
        }

        await renderHistory();
    }
}

async function renderHistory() {
    const history = await getDownloadHistory();
    if (historyCount) historyCount.textContent = history.length;

    if (history.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No hay descargas recientes</p>';
        return;
    }

    historyList.innerHTML = '';

    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const date = new Date(item.downloadedAt);
        const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        const isFav = FavoritesModule.isFavorite(item.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        div.innerHTML = `
            <button class="favorite-btn ${heartClass}" data-id="${item.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                    <span class="history-date">${dateStr}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar de nuevo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Favorite button click handler
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(item, favBtn);
        });

        // Re-download button click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            urlInput.value = item.url;
            downloadFromUrl(item.url);
        });

        // Click on item to fill URL
        div.addEventListener('click', () => {
            urlInput.value = item.url;
            urlInput.focus();
        });

        historyList.appendChild(div);
    });
}

function toggleHistory() {
    historyToggle.classList.toggle('open');
    historyContent.classList.toggle('hidden');
}

// History event listeners
if (historyToggle) historyToggle.addEventListener('click', toggleHistory);
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

// ========================================
// Favorites Management
// ========================================

async function updateFavoriteItem(videoId, newData) {
    const changed = await FavoritesModule.updateFavorite(videoId, newData);
    if (changed) await renderFavorites();
}

async function renderFavorites() {
    const favorites = await FavoritesModule.getFavorites();
    favoritesCount.textContent = favorites.length;

    if (favorites.length === 0) {
        favoritesList.innerHTML = '<p class="history-empty">No tienes favoritos aún</p>';
        if (downloadFavoritesBtn) downloadFavoritesBtn.disabled = true;
        if (favSelectedCount) favSelectedCount.textContent = '0';
        return;
    }

    favoritesList.innerHTML = '';

    favorites.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';

        div.innerHTML = `
            <input type="checkbox" class="fav-checkbox playlist-checkbox" data-index="${index}" checked>
            <button class="favorite-btn active" data-id="${item.id}" title="Quitar de favoritos">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Checkbox change
        const checkbox = div.querySelector('.fav-checkbox');
        checkbox.addEventListener('change', () => {
            div.classList.toggle('selected', checkbox.checked);
            updateFavSelectedCount();
        });
        div.classList.add('selected');

        // Unfavorite click
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await FavoritesModule.toggleFavorite(item, favBtn);
        });

        // Download click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            urlInput.value = item.url;
            await downloadFromUrl(item.url, item);
        });

        // Item click (toggle selection)
        div.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input')) {
                const cb = div.querySelector('.fav-checkbox');
                if (cb) {
                    cb.checked = !cb.checked;
                    div.classList.toggle('selected', cb.checked);
                    updateFavSelectedCount();
                }

                // Set URL for quick download too
                urlInput.value = item.url;
            }
        });

        favoritesList.appendChild(div);
    });

    updateFavSelectedCount();
}

async function updateFavSelectedCount() {
    const checked = favoritesList ? favoritesList.querySelectorAll('.fav-checkbox:checked').length : 0;
    if (favSelectedCount) favSelectedCount.textContent = checked;
    if (downloadFavoritesBtn) {
        const favorites = await FavoritesModule.getFavorites();
        downloadFavoritesBtn.disabled = checked === 0 || favorites.length === 0;
    }
}

function selectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.add('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = true;
    });
    updateFavSelectedCount();
}

function deselectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = false;
    });
    updateFavSelectedCount();
}

// Bind Home Fav actions - Already handled via addEventListener above.
async function downloadFavoritesMobile(selectedVideos, total) {
    try {
        const CONCURRENCY_LIMIT = 5;
        let activeCount = 0;
        let completedCount = 0;
        let queueIndex = 0;
        const errors = [];

        updateProgress(5, `Iniciando descarga paralela (${selectedVideos.length} canciones)...`);

        const batchStartTime = Date.now();
        let lastCompletedCount = 0;
        let etaSeconds = null;

        const updateBatchStatus = () => {
            if (completedCount > lastCompletedCount) {
                const elapsed = (Date.now() - batchStartTime) / 1000;
                const avgTimePerItem = elapsed / completedCount;
                const remainingItems = total - completedCount;
                etaSeconds = Math.round(remainingItems * avgTimePerItem);
                lastCompletedCount = completedCount;
            } else if (etaSeconds !== null && etaSeconds > 0) {
                etaSeconds--;
            }

            const percent = Math.round((completedCount / total) * 100);
            let statusMsg = `Descargando: ${completedCount}/${total} (${percent}%)`;

            if (etaSeconds !== null && completedCount > 0) {
                const mins = Math.floor(etaSeconds / 60);
                const secs = etaSeconds % 60;
                const etaStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                statusMsg += ` - ETA: ${etaStr}`;
            }

            updateProgress(Math.max(5, percent), statusMsg);
        };

        const etaInterval = setInterval(updateBatchStatus, 1000);

        await new Promise((resolve) => {
            function processNext() {
                while (activeCount < CONCURRENCY_LIMIT && queueIndex < total) {
                    const video = selectedVideos[queueIndex++];
                    activeCount++;

                    downloadFromUrl(video.url, video)
                        .catch(err => {
                            console.error('Download error:', err);
                            errors.push(video.title);
                        })
                        .finally(() => {
                            activeCount--;
                            completedCount++;
                            updateBatchStatus();

                            if (completedCount === total) {
                                clearInterval(etaInterval);
                                resolve();
                            } else {
                                processNext();
                            }
                        });
                }
            }
            processNext();
        });

        setLoading(false);
        hideProgress();

        if (errors.length > 0) {
            showStatus(`Completado con ${errors.length} error(es)`, 'warning');
        } else {
            showStatus(`¡${total} canciones descargadas!`, 'success');
            showSuccessAnimation();
        }

    } catch (error) {
        console.error('Mobile parallel batch error:', error);
        showStatus('Error en la descarga paralela.', 'error');
        hideProgress();
    } finally {
        setLoading(false);
    }
}

async function downloadFavoritesDesktop(selectedVideos, total) {
    try {
        updateProgress(5, i18n.t('initializing') || 'Iniciando descarga...');

        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, quality })
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        if (globalThis.queueManager !== undefined) {
            const batchInfo = {
                id: download_id,
                title: `Descargando ${total} canciones...`,
                thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
                channel: 'Favoritos'
            };
            queueManager.add(download_id, batchInfo);
        }

        const finalProgressData = await pollProgress(download_id, total);

        if (finalProgressData.cancelled) {
            hideProgress();
            setLoading(false);
            showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
            return;
        }

        updateProgress(100, '¡Descarga completada!');

        setTimeout(() => {
            window.location.href = `${API_URL}/api/download/${download_id}`;
            showSuccessAnimation();
            setTimeout(() => {
                hideProgress();
                showStatus(i18n.t('zip_complete', { n: total }) || `¡${total} canciones descargadas!`, 'success');
            }, 1000);
        }, 300);

        if (typeof LibraryModule !== 'undefined') {
            const songsToAdd = selectedVideos.map(video => ({
                title: video.title,
                channel: video.channel,
                thumbnail: video.thumbnail,
                videoId: video.id || video.videoId,
                src: video.url, // Standard behavior for zip downloads
                addedAt: new Date().toISOString()
            }));
            await LibraryModule.addSongs(songsToAdd);
        }

        selectedVideos.forEach((video) => {
            addToHistory({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                channel: video.channel,
                url: video.url,
                duration: video.duration
            });
        });

    } catch (error) {
        console.error('Favorites batch download error:', error);
        hideProgress();
        setLoading(false);
        showStatus(error.message || 'Error en la descarga', 'error');
    } finally {
        setLoading(false);
    }
}

async function downloadSelectedFavorites() {
    const favorites = await FavoritesModule.getFavorites();
    const checkboxes = favoritesList.querySelectorAll('.fav-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = Number.parseInt(cb.dataset.index);
        return favorites[index];
    }).filter(Boolean);

    if (selectedVideos.length === 0) {
        showStatus(i18n.t('select_at_least_one') || 'Selecciona al menos una canción', 'error');
        return;
    }

    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile && total > 2) {
        await downloadFavoritesMobile(selectedVideos, total);
    } else {
        await downloadFavoritesDesktop(selectedVideos, total);
    }
}

function toggleFavorites() {
    favoritesToggle.classList.toggle('open');
    favoritesContent.classList.toggle('hidden');
}

// Favorites event listeners
if (favoritesToggle) favoritesToggle.addEventListener('click', toggleFavorites);

// ========================================
// Theme Toggle
// ========================================

function getPreferredTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.dataset.theme || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function initTheme() {
    const theme = getPreferredTheme();
    setTheme(theme);
}

// Theme toggle click handler
if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
}

// ========================================
// Audio Preview (YouTube IFrame API)
// ========================================

let ytPlayer = null;
let ytPlayerReady = false;
let currentPreviewId = null;
let currentThumbnailWrapper = null;

// Called automatically by YouTube IFrame API when ready
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API loaded, creating player...');
    ytPlayer = new YT.Player('youtubePlayer', {
        height: '1',
        width: '1',
        playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            origin: window.location.origin // standard practice for API security
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange,
            onError: onPlayerError
        }
    });
}

function onPlayerReady(event) {
    console.log('YouTube Player is ready!');
    ytPlayerReady = true;
}

function onPlayerError(event) {
    console.error('YouTube Player error:', event.data);
    let message = i18n.t('preview_error_generic');

    // Error codes: https://developers.google.com/youtube/iframe_api_reference#onError
    if (event.data === 150 || event.data === 101) {
        message = i18n.t('preview_error_restricted');
    } else if (event.data === 100) {
        message = i18n.t('preview_error_not_found');
    }

    showStatus(message, 'error');
    stopPreview(); // Reset UI
}

// Make it globally available
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === 0) {
        stopPreview();
    }
}

function togglePreview(videoId, thumbnailWrapper) {
    console.log('togglePreview called with videoId:', videoId);

    if (!ytPlayerReady || !ytPlayer?.loadVideoById) {
        console.warn('YouTube player not ready yet. ytPlayerReady:', ytPlayerReady);
        showStatus('Espera un momento, el reproductor se está cargando...', 'info');
        return;
    }

    if (!videoId) {
        console.error('No video ID provided');
        return;
    }

    // If same video is playing, pause it
    if (currentPreviewId === videoId) {
        stopPreview();
        return;
    }

    // Stop any current preview
    if (currentPreviewId) {
        stopPreview();
    }

    // Start new preview
    currentPreviewId = videoId;
    currentThumbnailWrapper = thumbnailWrapper;

    ytPlayer.loadVideoById(videoId);
    ytPlayer.unMute(); // Ensure audio is on
    ytPlayer.setVolume(100); // Max volume
    ytPlayer.playVideo();

    updatePlayingUI(thumbnailWrapper, true);
}

function stopPreview() {
    if (ytPlayer?.stopVideo) {
        ytPlayer.stopVideo();
    }

    if (currentThumbnailWrapper) {
        updatePlayingUI(currentThumbnailWrapper, false);
    }

    currentPreviewId = null;
    currentThumbnailWrapper = null;
}

function updatePlayingUI(wrapper, isPlaying) {
    if (!wrapper) return;

    const musicIcon = wrapper.querySelector('.music-icon');
    const pauseIcon = wrapper.querySelector('.pause-icon');

    if (isPlaying) {
        wrapper.classList.add('playing');
        if (musicIcon) musicIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
        wrapper.classList.remove('playing');
        if (musicIcon) musicIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    }
}

// ========================================
// Animations
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderHistory();
    renderFavorites();
    auth.init();  // Check session and load server data if logged in
    setTimeout(() => urlInput.focus(), 600);
});

// ========================================
// Success Animations
// ========================================

const CONFETTI_COLORS = ['#FF0000', '#ff3333', '#ff6666', '#2ed573', '#ffa502', '#ff6b81', '#70a1ff', '#7bed9f'];

function createConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    // Create 50 confetti pieces
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = `confetti-piece ${Math.random() > 0.5 ? 'circle' : 'square'}`;

        // Random position
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.top = '-10px';

        // Random color
        piece.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

        // Random size
        const size = 5 + Math.random() * 10;
        piece.style.width = `${size}px`;
        piece.style.height = `${size}px`;

        // Random animation delay and duration
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;

        container.appendChild(piece);
    }

    // Cleanup after animation
    setTimeout(() => container.remove(), 4000);
}

function showSuccessAnimation() {
    createConfetti();

    // Add a glow effect to container
    const card = document.querySelector('.card');
    card.style.boxShadow = '0 0 50px var(--success-color)';
    card.style.borderColor = 'var(--success-color)';

    setTimeout(() => {
        card.style.boxShadow = '';
        card.style.borderColor = '';
    }, 1000);
}

// ========================================
// Queue Manager (Visual Panel)
// ========================================
const queuePanel = document.getElementById('queuePanel');
const activeDownloadsContainer = document.getElementById('activeDownloads');
const pendingQueueContainer = document.getElementById('pendingQueue');

class QueueManager {
    constructor() {
        this.items = new Map(); // id -> { data, element, status }
        this.activeIds = [];    // List of IDs currently shown as active
        this.pendingIds = [];   // List of IDs in the stack

        this.MAX_ACTIVE_DISPLAY = 3; // Show max 3 active cards individually
    }

    add(id, videoInfo) {
        // Show panel if hidden
        queuePanel.classList.remove('hidden');

        const item = {
            id,
            info: videoInfo,
            status: 'starting',
            percent: 0,
            element: this.createCard(videoInfo, id)
        };

        this.items.set(id, item);

        // Add cancel button event listener
        const cancelBtn = item.element.querySelector('.q-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancel(id);
            });
        }

        // Decide placement
        if (this.activeIds.length < this.MAX_ACTIVE_DISPLAY) {
            this.activeIds.push(id);
            activeDownloadsContainer.appendChild(item.element);
            item.element.classList.add('entering');
        } else {
            this.pendingIds.push(id);
            pendingQueueContainer.appendChild(item.element);
            item.element.classList.add('pending');
            this.updateStackVisuals();
        }
    }

    update(id, percent, message, extras) {
        const item = this.items.get(id);
        if (!item) return;

        item.percent = percent;

        // Update DOM
        const bar = item.element.querySelector('.q-progress-fill');
        const status = item.element.querySelector('.q-status');
        const titleEl = item.element.querySelector('.q-title');
        const thumbEl = item.element.querySelector('.q-thumb');

        if (bar) bar.style.width = `${percent}%`;

        if (status) {
            // Show provided message (contains ETA/Speed) or default
            if (message) {
                status.textContent = message;
            } else {
                status.textContent = i18n.t('downloading');
            }
        }

        // Update metadata if available (e.g. from server pre-fetch)
        if (extras) {
            if (extras.title && titleEl) {
                titleEl.textContent = extras.title;
            }
            if (extras.thumbnail && thumbEl) {
                thumbEl.src = extras.thumbnail;
            }
        }
    }

    complete(id) {
        const item = this.items.get(id);
        if (!item) return;

        // Turn green
        const bar = item.element.querySelector('.q-progress-fill');
        const status = item.element.querySelector('.q-status');

        if (bar) bar.classList.add('completed');
        if (status) status.textContent = i18n.t('download_complete');

        // Remove after delay
        setTimeout(() => {
            item.element.classList.add('leaving');

            setTimeout(() => {
                this.remove(id);
            }, 400); // Wait for animation
        }, 1500); // Show green for 1.5s
    }

    async cancel(id) {
        const item = this.items.get(id);
        if (!item) return;

        // Show cancelling status on UI
        const status = item.element.querySelector('.q-status');
        if (status) status.textContent = i18n.t('cancelling') || 'Cancelando...';

        // Disable the cancel button to prevent double-clicks
        const cancelBtn = item.element.querySelector('.q-cancel-btn');
        if (cancelBtn) cancelBtn.disabled = true;

        try {
            const response = await fetch(`${API_URL}/api/cancel/${id}`, {
                method: 'POST'
            });

            if (response.ok) {
                // Animate removal
                item.element.classList.add('cancelled');
                setTimeout(() => {
                    this.remove(id);
                }, 300);
            } else {
                // If cancel failed, restore status
                if (status) status.textContent = i18n.t('error_download');
                if (cancelBtn) cancelBtn.disabled = false;
            }
        } catch (error) {
            console.error('Cancel error:', error);
            if (status) status.textContent = i18n.t('error_download');
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    remove(id) {
        const item = this.items.get(id);
        if (item?.element) {
            item.element.remove();
        }

        this.items.delete(id);
        this.activeIds = this.activeIds.filter(i => i !== id);
        this.pendingIds = this.pendingIds.filter(i => i !== id);

        // Hide panel if empty
        if (this.items.size === 0) {
            setTimeout(() => {
                if (this.items.size === 0) queuePanel.classList.add('hidden');
            }, 500);
        } else {
            // Promote pending to active if slot available
            this.promoteNext();
        }
    }

    promoteNext() {
        if (this.activeIds.length < this.MAX_ACTIVE_DISPLAY && this.pendingIds.length > 0) {
            const nextId = this.pendingIds.shift();
            this.activeIds.push(nextId);
            const item = this.items.get(nextId);

            if (item) {
                // Determine start and end positions for animation
                // We want it to "fly" from stack to active list

                // 1. Remove style from pending
                item.element.classList.remove('pending', 'p-1', 'p-2', 'p-3', 'hidden-stack');
                item.element.style.transform = '';
                item.element.style.opacity = '';

                // 2. Move to active container
                activeDownloadsContainer.appendChild(item.element);

                // 3. Animate entry (slide up)
                item.element.animate([
                    { transform: 'translateY(20px) scale(0.9)', opacity: 0.8 },
                    { transform: 'translateY(0) scale(1)', opacity: 1 }
                ], {
                    duration: 400,
                    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                });
            }

            this.updateStackVisuals();
        }
    }

    updateStackVisuals() {
        this.pendingIds.forEach((id, index) => {
            const item = this.items.get(id);
            if (!item) return;

            // Reset classes
            item.element.classList.remove('p-1', 'p-2', 'p-3', 'hidden-stack');

            if (index === 0) item.element.classList.add('p-1');
            else if (index === 1) item.element.classList.add('p-2');
            else if (index === 2) item.element.classList.add('p-3');
            else item.element.classList.add('hidden-stack');
        });
    }

    createCard(info, downloadId) {
        const div = document.createElement('div');
        div.className = 'queue-card';
        div.dataset.downloadId = downloadId;
        div.innerHTML = `
            <div class="q-header">
                <img src="${info.thumbnail || 'placeholder.jpg'}" class="q-thumb" alt="">
                <div class="q-info">
                    <div class="q-title">${info.title || i18n.t('initializing')}</div>
                    <div class="q-status">${i18n.t('loading')}</div>
                </div>
                <button class="q-cancel-btn" title="${i18n.t('cancel_download') || 'Cancelar'}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="q-progress-bg">
                <div class="q-progress-fill"></div>
            </div>
        `;
        return div;
    }
}
const queueManager = new QueueManager();

document.addEventListener('mousemove', (e) => {
    const glow = document.querySelector('.background-glow');
    if (glow) {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.02;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.02;
        glow.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    }
});

// ========================================
// Environment Detection (Handled at the top of the file)

// ========================================
// PlayerModule — MP3 Reproductor completo
// ========================================
const PlayerModule = (() => {
    const audio = document.getElementById('mainAudio');
    const playerBar = document.getElementById('playerBar');
    const playerPlay = document.getElementById('playerPlay');
    const playerPrev = document.getElementById('playerPrev');
    const playerNext = document.getElementById('playerNext');
    const playerShuffle = document.getElementById('playerShuffle');
    const playerRepeat = document.getElementById('playerRepeat');
    const playerSeek = document.getElementById('playerSeek');
    const playerSeekFill = document.getElementById('playerSeekFill');
    const playerVolume = document.getElementById('playerVolume');
    const playerVolumeFill = document.getElementById('playerVolumeFill');
    const playerMuteBtn = document.getElementById('playerMuteBtn');
    const playerDuration = document.getElementById('playerDuration');
    const playerTitle = document.getElementById('playerTitle');
    const playerArtist = document.getElementById('playerArtist');
    const playerThumb = document.getElementById('playerThumb');
    const playerBarFav = document.getElementById('playerBarFav');
    const playerFavBtn = playerBarFav; // Restore definition for backward compatibility
    const playerBarProgress = document.getElementById('playerBarProgress');

    // Selectores Full-Screen Player
    const fullPlayer = document.getElementById('fullPlayer');
    const fullPlayerClose = document.getElementById('fullPlayerClose');
    const fullPlayerPlay = document.getElementById('fullPlayerPlay');
    const fullPlayerPrev = document.getElementById('fullPlayerPrev');
    const fullPlayerNext = document.getElementById('fullPlayerNext');
    const fullPlayerShuffle = document.getElementById('fullPlayerShuffle');
    const fullPlayerRepeat = document.getElementById('fullPlayerRepeat');
    const fullPlayerSeek = document.getElementById('fullPlayerSeek');
    const fullPlayerSeekFill = document.getElementById('fullPlayerSeekFill');
    const fullPlayerCurrentTime = document.getElementById('fullPlayerCurrentTime');
    const fullPlayerDuration = document.getElementById('fullPlayerDuration');
    const fullPlayerTitle = document.getElementById('fullPlayerTitle');
    const fullPlayerArtist = document.getElementById('fullPlayerArtist');
    const fullPlayerThumb = document.getElementById('fullPlayerThumb');
    const fullPlayerBg = document.getElementById('fullPlayerBg');
    const fullPlayerFav = document.getElementById('fullPlayerFav');
    const fullPlayerSource = document.getElementById('fullPlayerSource');
    const fullPlayerLyrics = document.getElementById('fullPlayerLyrics');
    const fullPlayerQueue = document.getElementById('fullPlayerQueue');
    const fullPlayerVolume = document.getElementById('fullPlayerVolume');
    const fullPlayerVolumeFill = document.getElementById('fullPlayerVolumeFill');
    const fullPlayerMuteBtn = document.getElementById('fullPlayerMuteBtn');

    let queue = [];
    let nextQueue = []; // Spotify-style play next
    let currentIndex = 0;
    let isShuffled = false;
    let shuffledQueue = [];
    let repeatMode = 0; // 0=off, 1=all, 2=one
    let isMuted = false;
    let prevVolume = 1;



    function formatTime(sec) {
        if (!sec || Number.isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }


    function updateSeekBar() {
        if (!audio.duration) return;

        const current = audio.currentTime;
        const duration = audio.duration;
        const width = (current / duration) * 100;

        // Always update mini player progress bar if available
        if (playerBarProgress) {
            playerBarProgress.style.width = width + '%';
        }

        // If full player is hidden, stop here
        if (fullPlayer?.classList.contains('fp-hidden')) return;

        if (fullPlayerSeekFill) fullPlayerSeekFill.style.width = width + '%';
        if (fullPlayerSeek) fullPlayerSeek.value = width; // Sync range knob value!
        if (fullPlayerCurrentTime) fullPlayerCurrentTime.textContent = formatTime(current);
        if (fullPlayerDuration) fullPlayerDuration.textContent = formatTime(duration);

        // Let LyricsModule know about the update if it's there
        if (typeof LyricsModule !== 'undefined' && typeof LyricsModule.updateActiveLine === 'function') {
            LyricsModule.updateActiveLine(current);
        }
    }

    function showFullPlayer() {
        if (!fullPlayer) return;

        // Sync favorite button before showing
        const q = getCurrentQueue();
        const currentSong = q[currentIndex];
        if (currentSong) {
            syncFullPlayerFavoriteButton(currentSong);

            // Set background cover blurred
            if (fullPlayerBg && currentSong.thumbnail) {
                fullPlayerBg.style.backgroundImage = `url('${currentSong.thumbnail}')`;
            }
        }

        // Animate slide-up: replace confusing void operator with standard evaluation method .valueOf()
        fullPlayer.offsetHeight.valueOf();
        fullPlayer.classList.remove('fp-hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('fullPlayer');
        }
    }

    function hideFullPlayer() {
        if (!fullPlayer) return;
        fullPlayer.classList.add('fp-hidden');
    }

    function updateVolumeBar(val) {
        if (playerVolumeFill) playerVolumeFill.style.width = val + '%';
        if (playerVolume) playerVolume.value = val;
        if (fullPlayerVolumeFill) fullPlayerVolumeFill.style.width = val + '%';
        if (fullPlayerVolume) fullPlayerVolume.value = val;
    }

    function showBar() {
        if (playerBar) {
            playerBar.classList.remove('hidden');
            document.body.classList.add('player-active');
        }
    }

    function hideBar() {
        if (playerBar) {
            playerBar.classList.add('hidden');
            document.body.classList.remove('player-active');
        }
    }

    function updatePlayPauseBtn(playing) {
        // Bottom Bar
        if (playerPlay) {
            const playIcon = playerPlay.querySelector('.play-icon');
            const pauseIcon = playerPlay.querySelector('.pause-icon');
            if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
            if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
        }

        // Full Player
        if (fullPlayerPlay) {
            const playIcon = fullPlayerPlay.querySelector('.play-icon');
            const pauseIcon = fullPlayerPlay.querySelector('.pause-icon');
            if (playIcon) playIcon.style.display = playing ? 'none' : 'block';
            if (pauseIcon) pauseIcon.style.display = playing ? 'block' : 'none';
        }
    }

    function updateMediaSession(song) {
        if (!('mediaSession' in navigator) && !NativeMediaSession.isAvailable()) return;

        // Native plugin might crash when processing local capacitor bridge URLs or huge Base64 strings.
        // `song._runtimeThumbnailNative` contains a pure Android `file://` URI which plugins CAN parse.
        let artworkUrl = song._runtimeThumbnailNative || song.thumbnail;

        let isValidNativeUrl = validateArtworkUrlForNative(artworkUrl);

        const artwork = buildMediaSessionArtwork(artworkUrl, isValidNativeUrl);

        // Set metadata via native plugin + web fallback
        NativeMediaSession.setMetadata({
            title: song.title || 'Sin título',
            artist: song.channel || 'Artista desconocido',
            album: 'YT Music Downloader',
            artwork: artwork
        });

        // Set playback state
        NativeMediaSession.setPlaybackState(audio.paused ? 'paused' : 'playing');

        // Register action handlers (idempotent — only registers once)
        NativeMediaSession.registerHandlers({
            play: () => resume(),
            pause: () => pause(),
            previoustrack: () => prev(),
            nexttrack: () => next(),
            seekbackward: (details) => {
                const skipTime = details?.seekOffset || 10;
                audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
                updatePositionState();
            },
            seekforward: (details) => {
                const skipTime = details?.seekOffset || 10;
                audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
                updatePositionState();
            },
            seekto: (details) => {
                if (details?.fastSeek && 'fastSeek' in audio) {
                    audio.fastSeek(details.seekTime);
                } else if (details?.seekTime !== undefined) {
                    audio.currentTime = details.seekTime;
                }
                audio.play().catch(() => { });
                updatePlayPauseBtn(true);
                NativeMediaSession.setPlaybackState('playing');
                updatePositionState();
            }
        });

        updatePositionState();
    }

    let lastPositionUpdate = 0;
    function updatePositionState() {
        if (!audio.duration || Number.isNaN(audio.duration) || !Number.isFinite(audio.duration)) return;

        const posState = {
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: audio.currentTime || 0
        };

        NativeMediaSession.setPositionState(posState);
    }

    function getCurrentQueue() {
        return isShuffled ? shuffledQueue : queue;
    }

    function removeSongFromQueue(src) {
        if (!src) return;
        const isPlayingThis = audio?.src?.includes(src);

        // Remover de la cola normal y ajustar el índice si es necesario
        const idx = queue.findIndex(s => s.src === src);
        if (idx !== -1) {
            queue.splice(idx, 1);
            if (!isShuffled && idx < currentIndex) currentIndex--;
        }

        // Remover de la cola aleatoria si aplicara
        const sIdx = shuffledQueue.findIndex(s => s.src === src);
        if (sIdx !== -1) {
            shuffledQueue.splice(sIdx, 1);
            if (isShuffled && sIdx < currentIndex) currentIndex--;
        }

        const q = getCurrentQueue();
        if (q.length === 0) {
            pause();
            hideBar();
            return;
        }

        // Si eliminaste la canción que estaba sonando *ahora mismo*, saltar a la siguiente
        if (isPlayingThis) {
            if (currentIndex >= q.length) currentIndex = 0;
            play(q[currentIndex]);
        }
    }

    async function play(song, queueList, startIndex) {
        if (!song?.src) return;

        if (queueList) {
            const isSameQueue = queue.length === queueList.length && queue.every((s, i) => s.src === queueList[i].src);
            queue = queueList;
            currentIndex = startIndex ?? 0;

            if (isShuffled) {
                // Solo re-mezclamos si la lista base ha cambiado de verdad (nueva canción o playlist distinta)
                if (!isSameQueue || shuffledQueue.length === 0) {
                    shuffledQueue = [...queue];
                    // Fisher-Yates real
                    for (let i = shuffledQueue.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [shuffledQueue[i], shuffledQueue[j]] = [shuffledQueue[j], shuffledQueue[i]];
                    }
                }
                currentIndex = shuffledQueue.findIndex(s => s.src === song.src);
                if (currentIndex === -1) currentIndex = 0;
            }
        }

        const finalSrc = await resolveStreamSrc(song);

        // Sin fuente reproducible no se asigna nada: se avisa al usuario en vez
        // de dejar el fallo enterrado en el .catch() de audio.play().
        if (!finalSrc) {
            isTransitioning = false;
            if (typeof showStatus === 'function') {
                showStatus(`No se encuentra el audio de "${song.title || 'esta canción'}". Vuelve a descargarla.`, 'error');
            }
            return;
        }

        audio.src = finalSrc;
        audio.load();
        audio.play().catch(e => {
            console.warn('Audio play error:', e);
            isTransitioning = false;
        });

        // Resolve Local Offline Thumbnail
        const { finalThumb, runtimeThumbnailNative } = await resolveNativeThumbnail(song);
        song._runtimeThumbnailNative = runtimeThumbnailNative;

        // Update UI using helper
        updatePlayerUI(song, finalThumb);

        updatePlayPauseBtn(true);
        showBar();

        // Update fav button
        updateFavBtn();

        // Update library playing state
        if (typeof LibraryModule !== 'undefined') {
            LibraryModule.setPlaying(song.src);
        }

        // Wrap in try-catch: metadata errors must NEVER kill audio playback
        try {
            updateMediaSession(song);
        } catch (e) {
            console.error('[Player] updateMediaSession error (non-fatal):', e);
        }

        // 🟢 Trigger lyrics fetch for the new song
        try {
            if (typeof LyricsModule !== 'undefined') {
                await LyricsModule.onTrackChange(song.title, song.channel);
            }
        } catch (e) {
            console.warn('[Player] Lyrics fetch error (non-fatal):', e);
        }
    }

    function updateFavBtn() {
        if (!playerFavBtn) return;
        const q = getCurrentQueue();
        const currentSong = q[currentIndex];
        if (currentSong) {
            const videoId = currentSong.videoId || currentSong.id || extractVideoId(currentSong.src);
            if (!videoId) return;

            playerFavBtn.dataset.id = videoId;
            if (fullPlayerFav) fullPlayerFav.dataset.id = videoId;

            const isFav = FavoritesModule.isFavorite(videoId);

            // Sync all favorite hearts cleanly using the helper
            toggleHeartButtonState(playerFavBtn, isFav);
            toggleHeartButtonState(playerBarFav, isFav);
            toggleHeartButtonState(fullPlayerFav, isFav);
        }
    }

    // Link between Favorites and Player is now handled in unified listeners below


    function pause() {
        audio.pause();
        updatePlayPauseBtn(false);
        NativeMediaSession.setPlaybackState('paused');
    }

    function resume() {
        audio.play().catch(e => console.warn(e));
        updatePlayPauseBtn(true);
        NativeMediaSession.setPlaybackState('playing');
    }

    function togglePlay() {
        if (audio.paused) resume();
        else pause();
    }

    function next() {
        if (isTransitioning) return;

        // Priority sequence: manually added songs go first
        if (nextQueue.length > 0) {
            const song = nextQueue.shift();
            play(song);
            return;
        }

        const q = getCurrentQueue();
        if (!q.length) return;

        isTransitioning = true;
        let nextIdx = (currentIndex + 1) % q.length;
        currentIndex = nextIdx;
        play(q[nextIdx]);

        // Lock navigation for 400ms to allow audio context to stabilize
        setTimeout(() => { isTransitioning = false; }, 400);
    }

    function addToNextQueue(song) {
        if (!song) return;
        nextQueue.push({ ...song });
        showStatus('Se reproducirá a continuación', 'success');

        // Refresh UI if the queue panel is open
        if (typeof renderQueuePanel === 'function') {
            renderQueuePanel();
        }

        // Refresh full player source name if open
        if (!fullPlayer.classList.contains('hidden')) {
            updateFullPlayerSource();
        }
    }

    function prev() {
        if (isTransitioning) return;
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }
        const q = getCurrentQueue();
        if (!q.length) return;

        isTransitioning = true;
        let prevIdx = (currentIndex - 1 + q.length) % q.length;
        currentIndex = prevIdx;
        play(q[prevIdx]);

        setTimeout(() => { isTransitioning = false; }, 400);
    }

    function toggleShuffle() {
        if (isTransitioning) return;
        isTransitioning = true;
        isShuffled = !isShuffled;

        // Sync player bar
        if (playerShuffle) playerShuffle.classList.toggle('active', isShuffled);

        // Sync full player
        if (fullPlayerShuffle) fullPlayerShuffle.classList.toggle('active', isShuffled);

        // Sync playlist header
        const plShuf = document.getElementById('plShuffleBtn');
        if (plShuf) plShuf.classList.toggle('active', isShuffled);

        const currentSong = getCurrentQueue()[currentIndex];

        if (isShuffled) {
            shuffledQueue = [...queue];
            for (let i = shuffledQueue.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledQueue[i], shuffledQueue[j]] = [shuffledQueue[j], shuffledQueue[i]];
            }
            if (currentSong) currentIndex = shuffledQueue.findIndex(s => s.src === currentSong.src);
        } else if (currentSong) {
            currentIndex = queue.findIndex(s => s.src === currentSong.src);
        }

        if (currentIndex === -1) currentIndex = 0;
        showStatus(isShuffled ? 'Aleatorio activado' : 'Aleatorio desactivado', 'info');
        setTimeout(() => { isTransitioning = false; }, 400);
    }
    function toggleRepeat() {
        if (isTransitioning) return;
        isTransitioning = true;
        repeatMode = (repeatMode + 1) % 3; // 0=off, 1=all, 2=one

        // Sync all repeat buttons using helper
        syncRepeatButtonState(playerRepeat, repeatMode);
        syncRepeatButtonState(fullPlayerRepeat, repeatMode);
        syncRepeatButtonState(document.getElementById('plRepeatBtn'), repeatMode);

        const repeatMsgMap = ['Repetir desactivado', 'Repetir todo', 'Repetir canción'];
        const msg = repeatMsgMap[repeatMode] || 'Repetir desactivado';
        showStatus(msg, 'info');
        setTimeout(() => { isTransitioning = false; }, 400);
    }
    function setQueue(songs, startIndex = 0) {
        queue = songs;
        currentIndex = startIndex;
        if (isShuffled) {
            shuffledQueue = [...songs].sort(() => Math.random() - 0.5);
        }
    }
    // Event Listeners
    addOptionalEventListener(audio, 'timeupdate', () => {
        updateSeekBar();
        // Throttle position state updates to the System Media Session (every 1s)
        const now = Date.now();
        if (now - lastPositionUpdate > 1000) {
            updatePositionState();
            lastPositionUpdate = now;
        }
    });

    addOptionalEventListener(audio, 'loadedmetadata', () => {
        if (playerDuration) playerDuration.textContent = formatTime(audio.duration);
        if (fullPlayerDuration) fullPlayerDuration.textContent = formatTime(audio.duration);
        updatePositionState();
    });

    addOptionalEventListener(audio, 'ended', () => {
        updatePlayPauseBtn(false);
        if (repeatMode === 2) {
            // Repeat one
            audio.currentTime = 0;
            audio.play();
            updatePlayPauseBtn(true);
        } else {
            const q = getCurrentQueue();
            const isLast = currentIndex >= q.length - 1;
            if (!isLast || repeatMode === 1) {
                if (!isTransitioning) next();
            } else {
                hideBar();
            }
        }
    });

    addOptionalEventListener(audio, 'play', () => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    });

    addOptionalEventListener(audio, 'pause', () => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    });

    addOptionalEventListener(playerPlay, 'click', (e) => { e.stopPropagation(); togglePlay(); });
    addOptionalEventListener(playerPrev, 'click', (e) => { e.stopPropagation(); prev(); });
    addOptionalEventListener(playerNext, 'click', (e) => { e.stopPropagation(); next(); });
    addOptionalEventListener(playerShuffle, 'click', (e) => { e.stopPropagation(); toggleShuffle(); });
    addOptionalEventListener(playerRepeat, 'click', (e) => { e.stopPropagation(); toggleRepeat(); });

    addOptionalEventListener(playerBarFav, 'click', (e) => {
        e.stopPropagation();
        const q = getCurrentQueue();
        const currentSong = q[currentIndex];
        if (currentSong && typeof FavoritesModule !== 'undefined') {
            FavoritesModule.toggleFavorite(currentSong, playerBarFav).then(() => {
                if (typeof updateFavBtn === 'function') updateFavBtn();
            });
        }
    });

    // Full Player listeners
    addOptionalEventListener(fullPlayerPlay, 'click', togglePlay);
    addOptionalEventListener(fullPlayerPrev, 'click', prev);
    addOptionalEventListener(fullPlayerNext, 'click', next);
    addOptionalEventListener(fullPlayerShuffle, 'click', toggleShuffle);
    addOptionalEventListener(fullPlayerRepeat, 'click', toggleRepeat);
    addOptionalEventListener(fullPlayerClose, 'click', hideFullPlayer);

    // Footer actions - Delegate to LyricsModule toggle
    addOptionalEventListener(fullPlayerLyrics, 'click', () => {
        const toggle = document.getElementById('lyricsToggle');
        if (toggle) {
            toggle.click();
        } else {
            // Fallback direct toggle
            const fs = document.getElementById('lyricsSection');
            const fp = document.getElementById('fullPlayer');
            if (fs && fp) {
                fp.classList.toggle('lyrics-mode');
                fs.classList.toggle('hidden');
            }
        }
    });

    // ── Playback Queue Panel Logic ──
    const pqSheet = document.getElementById('playbackQueueSheet');
    const pqBackdrop = pqSheet?.querySelector('.pq-backdrop');
    const pqCloseBtn = document.getElementById('pqCloseBtn');
    const pqShuffleBtn = document.getElementById('pqShuffleBtn');
    const pqRepeatBtn = document.getElementById('pqRepeatBtn');
    const pqNowPlaying = document.getElementById('pqNowPlaying');
    const pqNextList = document.getElementById('pqNextList');
    const pqNextSection = document.getElementById('pqNextSection');
    const pqQueueList = document.getElementById('pqQueueList');

    function renderQueueItem(song, isNowPlaying) {
        const playing = isNowPlaying ? ' is-playing' : '';
        const bars = isNowPlaying ? '<div class="pq-playing-bars"><span></span><span></span><span></span></div>' : '';
        return `<div class="pq-item${playing}" data-src="${song.src || ''}">
            <img class="pq-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
            <div class="pq-item-info">
                <div class="pq-item-title">${song.title || 'Sin título'}</div>
                <div class="pq-item-artist">${song.channel || song.artist || 'Desconocido'}</div>
            </div>
            ${bars}
        </div>`;
    }

    function renderNextUpQueueSection(pqNextSection, pqNextList) {
        if (!pqNextSection || !pqNextList) return;
        if (nextQueue.length > 0) {
            pqNextSection.style.display = '';
            pqNextList.innerHTML = nextQueue.map((s, i) => {
                return `<div class="pq-item" data-next-index="${i}" data-src="${s.src || ''}">
                    <img class="pq-item-thumb" src="${s.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                    <div class="pq-item-info">
                        <div class="pq-item-title">${s.title || 'Sin título'}</div>
                        <div class="pq-item-artist">${s.channel || s.artist || 'Desconocido'}</div>
                    </div>
                    <button class="pq-item-remove" data-next-remove="${i}" title="Quitar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
            }).join('');
            // Bind remove buttons for next queue
            pqNextList.querySelectorAll('[data-next-remove]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = Number.parseInt(btn.dataset.nextRemove, 10);
                    nextQueue.splice(idx, 1);
                    renderQueuePanel();
                });
            });
        } else {
            pqNextSection.style.display = 'none';
        }
    }

    function renderMainQueueSection(pqQueueList, q) {
        if (!pqQueueList) return;
        const upcoming = [];
        for (let i = 1; i < q.length; i++) {
            const idx = (currentIndex + i) % q.length;
            upcoming.push(q[idx]);
        }
        if (upcoming.length > 0) {
            pqQueueList.innerHTML = upcoming.map(s => renderQueueItem(s, false)).join('');
            // Bind click-to-play on queue items
            pqQueueList.querySelectorAll('.pq-item').forEach((el, i) => {
                el.addEventListener('click', () => {
                    const realIdx = (currentIndex + i + 1) % q.length;
                    play(q[realIdx]);
                    currentIndex = realIdx;
                    renderQueuePanel();
                });
            });
        } else {
            pqQueueList.innerHTML = '<div class="pq-empty">No hay más canciones en la cola</div>';
        }
    }

    function renderQueuePanel() {
        if (!pqSheet) return;
        const q = getCurrentQueue();
        const current = q[currentIndex];

        // Now Playing
        if (pqNowPlaying) {
            pqNowPlaying.innerHTML = current ? renderQueueItem(current, true) : '<div class="pq-empty">Nada en reproducción</div>';
        }

        // Render sections via helpers
        renderNextUpQueueSection(pqNextSection, pqNextList);
        renderMainQueueSection(pqQueueList, q);

        // Sync shuffle/repeat button states using the repeat state helper
        if (pqShuffleBtn) pqShuffleBtn.classList.toggle('active', isShuffled);
        syncRepeatButtonState(pqRepeatBtn, repeatMode);
    }

    function openQueuePanel() {
        if (!pqSheet) return;
        renderQueuePanel();
        pqSheet.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('playbackQueueSheet');
        }
    }

    function closeQueuePanel() {
        if (pqSheet) pqSheet.classList.add('hidden');
    }

    // Wire up buttons
    if (fullPlayerQueue) {
        fullPlayerQueue.addEventListener('click', () => openQueuePanel());
    }
    if (pqCloseBtn) {
        pqCloseBtn.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                closeQueuePanel();
            }
        });
    }
    if (pqBackdrop) {
        pqBackdrop.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                closeQueuePanel();
            }
        });
    }
    if (pqShuffleBtn) {
        pqShuffleBtn.addEventListener('click', () => {
            toggleShuffle();
            renderQueuePanel();
        });
    }
    if (pqRepeatBtn) {
        pqRepeatBtn.addEventListener('click', () => {
            toggleRepeat();
            renderQueuePanel();
        });
    }

    if (fullPlayerFav) {
        fullPlayerFav.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof FavoritesModule !== 'undefined') {
                const q = getCurrentQueue();
                const currentSong = q[currentIndex];
                if (currentSong) {
                    FavoritesModule.toggleFavorite(currentSong, fullPlayerFav).then(() => {
                        if (typeof updateFavBtn === 'function') updateFavBtn();
                    });
                }
            }
        });
    }

    // Toggle full player on bar click
    if (playerBar) {
        playerBar.addEventListener('click', (e) => {
            // Don't open if clicking a button or range input
            if (e.target.closest('button') || e.target.closest('input[type="range"]')) return;
            showFullPlayer();
        });
    }

    const handleSeekInput = (el) => {
        if (!audio.duration) return;
        const newTime = (el.value / 100) * audio.duration;
        audio.currentTime = newTime;

        const pct = el.value + '%';
        if (playerSeekFill) playerSeekFill.style.width = pct;
        if (fullPlayerSeekFill) fullPlayerSeekFill.style.width = pct;
    };

    if (playerSeek) playerSeek.addEventListener('input', () => handleSeekInput(playerSeek));
    if (fullPlayerSeek) fullPlayerSeek.addEventListener('input', () => handleSeekInput(fullPlayerSeek));

    function syncMuteButtonsState() {
        const volIcon = playerMuteBtn?.querySelector('.vol-icon');
        const muteIcon = playerMuteBtn?.querySelector('.mute-icon');
        if (volIcon) volIcon.style.display = isMuted ? 'none' : 'block';
        if (muteIcon) muteIcon.style.display = isMuted ? 'block' : 'none';

        const fpVolIcon = fullPlayerMuteBtn?.querySelector('.fp-vol-icon');
        const fpMuteIcon = fullPlayerMuteBtn?.querySelector('.fp-mute-icon');
        if (fpVolIcon) fpVolIcon.style.display = isMuted ? 'none' : 'block';
        if (fpMuteIcon) fpMuteIcon.style.display = isMuted ? 'block' : 'none';
    }

    const handleVolumeInput = (el) => {
        const vol = el.value / 100;
        audio.volume = vol;
        isMuted = vol === 0;
        updateVolumeBar(el.value);
        syncMuteButtonsState();
    };

    if (playerVolume) playerVolume.addEventListener('input', () => handleVolumeInput(playerVolume));
    if (fullPlayerVolume) fullPlayerVolume.addEventListener('input', () => handleVolumeInput(fullPlayerVolume));

    const toggleMute = () => {
        isMuted = !isMuted;
        if (isMuted) {
            prevVolume = audio.volume;
            audio.volume = 0;
            updateVolumeBar(0);
        } else {
            audio.volume = prevVolume;
            updateVolumeBar(prevVolume * 100);
        }
        syncMuteButtonsState();
    };

    if (playerMuteBtn) playerMuteBtn.addEventListener('click', toggleMute);
    if (fullPlayerMuteBtn) fullPlayerMuteBtn.addEventListener('click', toggleMute);

    // Inicializar barras de volumen sincronizadas
    if (audio) {
        updateVolumeBar(audio.volume * 100);
    }


    return {
        play, pause, resume, togglePlay, next, prev, setQueue, showBar, hideBar, removeSongFromQueue,
        toggleShuffle, toggleRepeat, addToNextQueue, showFullPlayer, hideFullPlayer, updateFavBtn,
        isShuffled: () => isShuffled,
        getRepeatMode: () => repeatMode,
        getQueueState: () => ({ queue: getCurrentQueue(), nextQueue, currentIndex }),
        renderQueuePanel, openQueuePanel, closeQueuePanel,
        seekTo: (time) => { if (audio) { audio.currentTime = time; } }
    };
})();

// ========================================
// NavigationModule — Control de Vistas y Back Button
// ========================================
const NavigationModule = (() => {
    let currentView = 'homeView';

    // Initialize history state on load
    try {
        if (!window.history.state) {
            window.history.replaceState({ type: 'view', view: 'homeView' }, '', '');
        }
    } catch (e) { }

    function switchView(viewId, pushToHistory = true) {
        if (viewId === currentView) return;

        const outgoing = document.getElementById(currentView);
        const incoming = document.getElementById(viewId);

        // Switch views instantly without delays or overlapping animations
        if (outgoing) {
            outgoing.classList.add('hidden');
            outgoing.classList.remove('view-exit', 'view-enter');
            if (outgoing.fallbackTimeout) clearTimeout(outgoing.fallbackTimeout);
        }

        if (incoming) {
            incoming.classList.remove('hidden', 'view-exit', 'view-enter');
            if (incoming.fallbackTimeout) clearTimeout(incoming.fallbackTimeout);
        }

        document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewId);
        });

        // Toggle Buy Coffee visibility (only on Home)
        const coffeeBtn = document.querySelector('.buy-coffee-btn');
        if (coffeeBtn) {
            if (viewId === 'homeView') coffeeBtn.classList.remove('hidden');
            else coffeeBtn.classList.add('hidden');
        }

        currentView = viewId;
        if (pushToHistory) {
            try {
                window.history.pushState({ type: 'view', view: viewId }, '', '');
            } catch (e) { }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Parent map: defines where "back" goes from each view
    const viewParent = {
        'playlistDetailView': 'playlistsView',
        'playlistsView': 'homeView',
        'libraryView': 'homeView'
    };

    // Pushes overlay state to history stack to prevent app exit on Back Button
    function pushOverlayState(overlayId) {
        try {
            window.history.pushState({ type: 'overlay', id: overlayId }, '', '');
        } catch (e) { }
    }

    // Programmatically trigger a history pop when user closes overlay manually
    function closeOverlay() {
        try {
            window.history.back();
        } catch (e) {
            // Visual fallback if history back fails
            goBack();
        }
    }

    function goBack() {
        // High priority: Close Playback Queue if open
        const pqSheet = document.getElementById('playbackQueueSheet');
        if (pqSheet && !pqSheet.classList.contains('hidden')) {
            if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.closeQueuePanel === 'function') {
                PlayerModule.closeQueuePanel();
            } else {
                pqSheet.classList.add('hidden');
            }
            return true;
        }

        // First priority: Close Full Player if open
        const fullPlayer = document.getElementById('fullPlayer');
        if (fullPlayer && !fullPlayer.classList.contains('fp-hidden')) {
            if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.hideFullPlayer === 'function') {
                PlayerModule.hideFullPlayer();
            } else {
                fullPlayer.classList.add('fp-hidden');
            }
            return true;
        }

        // Second priority: Close any open modal
        const openModal = document.querySelector('.modal-container:not(.hidden), .auth-modal:not(.hidden)');
        if (openModal) {
            openModal.classList.add('hidden');
            document.body.style.overflow = '';
            return true;
        }

        // Third priority: Navigate to parent view
        const parent = viewParent[currentView];
        if (parent) {
            switchView(parent, false);
            return true;
        }

        return false; // Already on homeView — signal to exit
    }

    // Browser back button (popstate) for web
    window.addEventListener('popstate', (e) => {
        if (e.state?.type === 'view') {
            // If the state is a view state, let's see if we have overlays to close first
            const hasOverlayOpen = (
                (document.getElementById('playbackQueueSheet') && !document.getElementById('playbackQueueSheet').classList.contains('hidden')) ||
                (document.getElementById('fullPlayer') && !document.getElementById('fullPlayer').classList.contains('fp-hidden')) ||
                document.querySelector('.modal-container:not(.hidden), .auth-modal:not(.hidden)')
            );
            if (hasOverlayOpen) {
                goBack();
            } else {
                switchView(e.state.view, false);
            }
        } else {
            // Either type is overlay, or it's null (user went back)
            goBack();
        }
    });

    // Capacitor Native Back Button Handling — Double-tap to exit
    let lastBackPress = 0;
    try {
        if (globalThis.Capacitor?.Plugins?.App) {
            globalThis.Capacitor.Plugins.App.addListener('backButton', () => {
                if (!goBack()) {
                    // We're on homeView with nothing to close — require double-tap
                    const now = Date.now();
                    if (now - lastBackPress < 2000) {
                        globalThis.Capacitor.Plugins.App.exitApp();
                    } else {
                        lastBackPress = now;
                        if (typeof showStatus === 'function') {
                            showStatus('Pulsa de nuevo para salir', 'info');
                        }
                    }
                }
            });
        }
    } catch (e) {
        console.warn('Capacitor App plugin not available:', e);
    }

    // Bind nav buttons
    document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    return { switchView, goBack, pushOverlayState, closeOverlay, getCurrentView: () => currentView };
})();;

// ========================================
// LibraryModule — Biblioteca local
// ========================================
const LibraryModule = (() => {
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
        const IS_NATIVE = globalThis.Capacitor !== undefined && globalThis.Capacitor.isNative;
        if (IS_NATIVE && globalThis.Capacitor?.Plugins?.Filesystem) {
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
            if (typeof showStatus === 'function') {
                showStatus('Esta canción ya está en la biblioteca', 'info');
            }
            return;
        }

        lib.unshift({ ...song, addedAt: new Date().toISOString() });
        await saveLibrary(lib);
        await render();
        await updateCount();
    }

    async function removeSong(src, itemElement) {
        // 1. Animate out the DOM element immediately for instant visual feedback
        if (itemElement) {
            itemElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease, max-height 0.3s ease';
            itemElement.style.opacity = '0';
            itemElement.style.transform = 'translateX(-100%)';
            itemElement.style.maxHeight = itemElement.offsetHeight + 'px';
            itemElement.style.overflow = 'hidden';
            setTimeout(() => {
                itemElement.style.maxHeight = '0';
                itemElement.style.padding = '0';
                itemElement.style.margin = '0';
            }, 50);
            // Remove from DOM after animation
            setTimeout(() => itemElement.remove(), 350);
        }

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
                fetch(`${API_URL}/api/download/${downloadId}`, { method: 'DELETE' }).catch(() => { });
            }
        }

        const newLib = lib.filter(s => s.src !== src);
        await saveLibrary(newLib);

        // Borrado en cascada: Eliminar también de cualquier playlist
        if (typeof PlaylistModule !== 'undefined') {
            const playlists = await PlaylistModule.getPlaylists();
            for (const pl of playlists) {
                if (pl.songs.some(s => s.src === src)) {
                    await PlaylistModule.removeSongFromPlaylist(pl.id, src);
                }
            }
        }

        // Remove from current playing queue to prevent ghost loading
        if (typeof PlayerModule !== 'undefined') {
            PlayerModule.removeSongFromQueue(src);
        }

        updateCount();
    }

    async function updateCount() {
        const count = document.getElementById('libraryCount');
        const lib = await getLibrary();
        if (count) count.textContent = `${lib.length} canción${lib.length !== 1 ? 'es' : ''}`;
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
                if (url && typeof downloadFromUrl === 'function') {
                    await downloadFromUrl(url, song);
                } else if (typeof showStatus === 'function') {
                    showStatus('No se puede recuperar esta canción: falta su enlace original', 'error');
                }
            });
        });

        list.querySelectorAll('.lib-add-playlist-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const song = lib[Number.parseInt(btn.dataset.index, 10)];
                if (song && typeof PlaylistModule !== 'undefined') PlaylistModule.showAddToPlaylist(song);
            });
        });

        list.querySelectorAll('.lib-fav-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const song = lib[Number.parseInt(btn.dataset.index, 10)];
                if (song && typeof FavoritesModule !== 'undefined') {
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

// ========================================
// PlaylistModule — Playlists personalizadas
// ========================================
const PlaylistModule = (() => {
    const PLAYLISTS_KEY = 'ytdl_playlists';
    const LAYOUT_KEY = 'ytdl_playlist_layout';
    let currentPlaylistId = null; // track which playlist detail is open
    async function getLayoutMode() {
        return await StorageModule.get(LAYOUT_KEY) || 'grid';
    }
    let layoutMode = 'grid'; // Initial fallback


    async function getPlaylists() {
        try {
            return await StorageModule.get(PLAYLISTS_KEY) || [];
        } catch { return []; }
    }

    async function savePlaylists(playlists) {
        await StorageModule.set(PLAYLISTS_KEY, playlists);

        // AUTO-BACKUP NATIVO
        updateEnvironment();
        if (IS_NATIVE && globalThis.Capacitor?.Plugins?.Filesystem) {
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

    async function createPlaylist(name, initialSongs = []) {
        const trimmed = name.trim();
        if (!trimmed) return { success: false, error: 'El nombre no puede estar vacío' };
        if (trimmed.length > 40) return { success: false, error: 'El nombre es demasiado largo (máximo 40 caracteres)' };

        const playlists = await getPlaylists();
        const exists = playlists.some(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) return { success: false, error: 'Ya existe una playlist con ese nombre' };

        playlists.push({
            id: Date.now().toString(),
            name: trimmed,
            description: '',
            songs: initialSongs,
            createdAt: new Date().toISOString()
        });
        await savePlaylists(playlists);
        await renderGrid();
        return { success: true };
    }

    async function deletePlaylist(id) {
        const playlists = await getPlaylists();
        const filtered = playlists.filter(p => p.id !== id);
        await savePlaylists(filtered);
        await renderGrid();
    }

    async function addSongToPlaylist(playlistId, song) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl && !pl.songs.some(s => s.src === song.src)) {
            pl.songs.push(song);
            await savePlaylists(playlists);
            await renderGrid();

            // ALWAYS refresh detail view — the user sees it behind the modal
            const countEl = document.getElementById('playlistDetailCount');
            if (countEl) countEl.textContent = `${pl.songs.length} canción${pl.songs.length !== 1 ? 'es' : ''}`;
            renderPlaylistSongs(pl);
        }
    }
    async function removeSongFromPlaylist(playlistId, songSrc) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.songs = pl.songs.filter(s => s.src !== songSrc);
            if (pl.songs.length === 0) {
                await handleDeleteEmptyPlaylist(playlistId, pl.name);
            } else {
                await handleUpdateNonEmptyPlaylist(playlistId, playlists, pl);
            }
        }
    }

    async function openPlaylistDetail(playlistId) {
        currentPlaylistId = playlistId;
        isEditMode = false; // Reset edit mode on open
        const btnEdit = document.getElementById('plActionEdit');
        if (btnEdit) btnEdit.classList.remove('active');

        const pl = await resolvePlaylistDetails(playlistId);
        if (!pl) return;

        // Sync header and section displays via helper
        syncPlaylistDetailHeader(pl, playlistId);

        // Sync player states via helper
        syncPlaylistPlayerStates();

        // Bind Action Bar Buttons
        bindActionButtons(pl);

        // Render songs in playlist
        renderPlaylistSongs(pl);

        // Switch to detail view
        NavigationModule.switchView('playlistDetailView');
    }

    function bindActionButtons(pl) {
        const btnAdd = document.getElementById('plActionAdd');
        const btnEdit = document.getElementById('plActionEdit');
        const btnReorder = document.getElementById('plActionReorder');
        const btnDelete = document.getElementById('plActionDelete');
        const btnPlShuffle = document.getElementById('plShuffleBtn');
        const btnPlRepeat = document.getElementById('plRepeatBtn');
        const btnPlPlay = document.getElementById('plPlayBtn');
        const isFavPlaylist = pl.id === 'favorites';

        // Hide edit/reorder/delete for Favorites (it's a virtual read-only playlist)
        if (btnEdit) btnEdit.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnReorder) btnReorder.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnDelete) btnDelete.style.display = isFavPlaylist ? 'none' : 'flex';

        if (btnDelete) {
            btnDelete.onclick = () => {
                if (isFavPlaylist) return;
                handlePlaylistDeletionUI(pl);
            };
        }

        if (btnAdd) btnAdd.onclick = () => openAddSongsModal(pl.id);
        if (btnEdit) btnEdit.onclick = () => openEditDetailsModal(pl);
        if (btnReorder) btnReorder.onclick = () => toggleEditMode();

        if (btnPlPlay) {
            btnPlPlay.onclick = () => {
                if (pl.songs && pl.songs.length > 0) {
                    PlayerModule.play(pl.songs[0], pl.songs, 0);
                } else if (typeof showStatus === 'function') {
                    showStatus('La playlist está vacía. Añade canciones primero.', 'info');
                }
            };
        }

        if (btnPlShuffle) {
            btnPlShuffle.onclick = () => {
                if (typeof PlayerModule !== 'undefined') PlayerModule.toggleShuffle();
            };
        }
        if (btnPlRepeat) {
            btnPlRepeat.onclick = () => {
                if (typeof PlayerModule !== 'undefined') PlayerModule.toggleRepeat();
            };
        }
    }
    let isEditMode = false;
    async function toggleEditMode() {
        isEditMode = !isEditMode;
        const btnReorder = document.getElementById('plActionReorder');
        if (btnReorder) btnReorder.classList.toggle('active', isEditMode);

        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === currentPlaylistId);
        if (pl) renderPlaylistSongs(pl);
    }

    function openEditDetailsModal(pl) {
        const modal = document.getElementById('editPlaylistModal');
        const nameInput = document.getElementById('editPlaylistNameInput');
        const descInput = document.getElementById('editPlaylistDescInput');
        const saveBtn = document.getElementById('confirmEditPlaylistBtn');
        const closeBtn = document.getElementById('closeEditPlaylistModal');

        if (!modal || !nameInput || !descInput) return;

        nameInput.value = pl.name;
        descInput.value = pl.description || '';

        modal.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('editPlaylistModal');
        }

        saveBtn.onclick = async () => {
            const newName = nameInput.value.trim();
            const newDesc = descInput.value.trim();
            if (!newName) return;

            const playlists = await getPlaylists();
            const target = playlists.find(p => p.id === pl.id);
            if (target) {
                target.name = newName;
                target.description = newDesc;
                await savePlaylists(playlists);
                await openPlaylistDetail(pl.id); // Refresh
                await renderGrid(); // Update main grid
                if (typeof NavigationModule !== 'undefined') {
                    NavigationModule.closeOverlay();
                } else {
                    modal.classList.add('hidden');
                }
            }
        };

        const closeEdit = () => closeOverlayOrHideModal(modal);

        closeBtn.onclick = closeEdit;
        modal.querySelector('.auth-modal-backdrop').onclick = closeEdit;
    }

    function openSortModal(playlistId) {
        const modal = document.getElementById('playlistSortModal');
        if (!modal) return;
        modal.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('playlistSortModal');
        }

        const closeSort = () => closeOverlayOrHideModal(modal);

        modal.querySelectorAll('.sort-option-btn').forEach(btn => {
            btn.onclick = async () => {
                const sortMode = btn.dataset.sort;
                await sortPlaylist(playlistId, sortMode);
                closeSort();
            };
        });

        // Close on backdrop click
        modal.querySelector('.auth-modal-backdrop').onclick = closeSort;
    }

    async function sortPlaylist(playlistId, mode) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (!pl) return;

        if (mode === 'title') {
            pl.songs.sort((a, b) => a.title.localeCompare(b.title));
        } else if (mode === 'artist') {
            pl.songs.sort((a, b) => a.channel.localeCompare(b.channel));
        } else if (mode === 'recent') {
            pl.songs.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
        }

        await savePlaylists(playlists);
        if (currentPlaylistId === playlistId) {
            renderPlaylistSongs(pl);
        }
        await renderGrid();
    }

    function openAddSongsModal(playlistId) {
        const modal = document.getElementById('playlistSearchModal');
        const input = document.getElementById('plSearchInput');
        const results = document.getElementById('plSearchResults');
        const closeBtn = document.getElementById('closePlaylistSearchModal');

        if (!modal || !results) return;

        modal.classList.remove('hidden');
        if (typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('playlistSearchModal');
        }
        input.value = '';
        renderLibSearchResults('', playlistId);

        input.oninput = () => {
            renderLibSearchResults(input.value.trim(), playlistId);
        };

        const closeAddSongs = () => closeOverlayOrHideModal(modal);

        closeBtn.onclick = closeAddSongs;
        modal.querySelector('.auth-modal-backdrop').onclick = closeAddSongs;
    }

    async function renderLibSearchResults(query, playlistId) {
        const results = document.getElementById('plSearchResults');
        const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);

        const filtered = lib.filter(song =>
            song.title.toLowerCase().includes(query.toLowerCase()) ||
            song.channel.toLowerCase().includes(query.toLowerCase())
        );

        if (filtered.length === 0) {
            results.innerHTML = '<div class="library-empty">No se encontraron canciones</div>';
            return;
        }

        results.innerHTML = filtered.map(song => {
            const alreadyIn = pl?.songs?.some(s => s.src === song.src);
            return `
                <div class="pl-add-song-row ${alreadyIn ? 'added' : ''}" data-video-id="${song.videoId}">
                    <img class="pl-add-song-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                    <div class="pl-add-song-info">
                        <div class="pl-add-song-title">${song.title}</div>
                        <div class="pl-add-song-artist">${song.channel}</div>
                    </div>
                    <div class="pl-add-song-status">
                        <svg class="pl-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            ${alreadyIn ? '<polyline points="20 6 9 17 4 12"/>' : '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'}
                        </svg>
                    </div>
                </div>
            `;
        }).join('');

        // Make the ENTIRE row clickable
        results.querySelectorAll('.pl-add-song-row').forEach((row, i) => {
            row.onclick = async () => {
                const song = filtered[i];
                const isAdding = !row.classList.contains('added');
                const icon = row.querySelector('.pl-add-icon');

                if (isAdding) {
                    await addSongToPlaylist(playlistId, song);
                    row.classList.add('added');
                    if (icon) icon.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
                } else {
                    await removeSongFromPlaylist(playlistId, song.src);
                    row.classList.remove('added');
                    if (icon) icon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
                }
            };
        });
    }

    function renderPlaylistSongs(pl) {
        const list = document.getElementById('playlistDetailList');
        const empty = document.getElementById('playlistDetailEmpty');
        if (!list) return;

        if (pl.songs.length === 0) {
            list.innerHTML = '';
            if (empty) { list.appendChild(empty); empty.style.display = 'flex'; }
            if (window.playlistSortable) {
                window.playlistSortable.destroy();
                window.playlistSortable = null;
            }
            return;
        }

        if (empty) empty.style.display = 'none';

        list.innerHTML = pl.songs.map((song, i) => {
            return renderLibraryItem(song, i, {
                context: 'playlist',
                isEditMode: isEditMode
            });
        }).join('');

        // Bind events
        list.querySelectorAll('.library-item').forEach((el, i) => {
            el.onclick = (e) => {
                if (isEditMode || e.target.closest('.library-item-btn') || e.target.closest('.pl-drag-handle')) return;
                PlayerModule.play(pl.songs[i], pl.songs, i);
            };

            const favBtn = el.querySelector('.favorite-btn');
            if (favBtn) {
                favBtn.onclick = (e) => {
                    e.stopPropagation();
                    const song = pl.songs[i];

                    // Call unified toggleFavorite
                    if (typeof FavoritesModule !== 'undefined' && typeof FavoritesModule.toggleFavorite === 'function') {
                        FavoritesModule.toggleFavorite(song, favBtn);
                    }
                };
            }
        });

        list.querySelectorAll('.pl-remove-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                await removeSongFromPlaylist(pl.id, btn.dataset.src);
            };
        });

        // Initialize or destroy SortableJS based on isEditMode
        if (isEditMode) {
            if (window.playlistSortable) window.playlistSortable.destroy();
            window.playlistSortable = new Sortable(list, {
                handle: '.pl-drag-handle',
                animation: 280,
                easing: 'cubic-bezier(0.11, 0, 0.5, 0)',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                forceFallback: true,
                fallbackClass: 'sortable-fallback',
                fallbackOnBody: true,
                fallbackTolerance: 3,
                swapThreshold: 0.55,
                onEnd: async function (evt) {
                    const fromIdx = evt.oldIndex;
                    const toIdx = evt.newIndex;
                    if (fromIdx === toIdx) return;
                    // Only persist data — SortableJS already moved the DOM element
                    try {
                        const playlists = await getPlaylists();
                        const currentPl = playlists.find(p => p.id === pl.id);
                        if (!currentPl) return;
                        const [removed] = currentPl.songs.splice(fromIdx, 1);
                        currentPl.songs.splice(toIdx, 0, removed);
                        await savePlaylists(playlists);
                        // Update the local reference so future drags use correct order
                        pl.songs = currentPl.songs;
                    } catch (e) {
                        console.error('Error persisting song move:', e);
                    }
                }
            });
        } else if (window.playlistSortable) {
            window.playlistSortable.destroy();
            window.playlistSortable = null;
        }
    }

    async function movePlaylistSong(playlistId, from, to) {
        try {
            const playlists = await getPlaylists(); // FIXED: added await
            const pl = playlists.find(p => p.id === playlistId);
            if (!pl) return;

            const [removed] = pl.songs.splice(from, 1);
            pl.songs.splice(to, 0, removed);

            await savePlaylists(playlists); // FIXED: added await
            renderPlaylistSongs(pl);
        } catch (e) {
            console.error('Error moving song:', e);
        }
    }

    async function showAddToPlaylist(song) {
        const modal = document.getElementById('addToPlaylistModal');
        const list = document.getElementById('addToPlaylistList');
        const songName = document.getElementById('addToPlaylistSongName');
        const createNewBtn = document.getElementById('addToPlaylistCreateNewBtn');
        if (!modal || !list) return;

        const isAlreadyOpen = !modal.classList.contains('hidden');
        modal.classList.remove('hidden');
        if (!isAlreadyOpen && typeof NavigationModule !== 'undefined') {
            NavigationModule.pushOverlayState('addToPlaylistModal');
        }

        if (songName) songName.textContent = song.title || '';

        // Wire up quick creation button
        if (createNewBtn) {
            createNewBtn.onclick = () => {
                const createPlModal = document.getElementById('createNewPlaylistModal');
                const nameInput = document.getElementById('newPlaylistNameInput');
                const confirmBtn = document.getElementById('confirmCreateNewPlaylistBtn');
                const cancelBtn = document.getElementById('cancelCreateNewPlaylistBtn');
                const closeBtn = document.getElementById('closeCreateNewPlaylistModal');
                const backdrop = document.getElementById('backdropCreateNewPlaylist');

                if (!createPlModal || !nameInput || !confirmBtn) return;

                // Open custom modal
                createPlModal.classList.remove('hidden');
                nameInput.value = '';
                nameInput.focus();

                const closeModal = () => {
                    createPlModal.classList.add('hidden');
                };

                cancelBtn.onclick = closeModal;
                closeBtn.onclick = closeModal;
                if (backdrop) backdrop.onclick = closeModal;
                if (closeBtn) closeBtn.onclick = closeModal;

                const submitCreation = async () => {
                    const plName = nameInput.value.trim();
                    if (!plName) {
                        if (typeof showStatus === 'function') {
                            showStatus('El nombre de la playlist no puede estar vacío.', 'error');
                        } else {
                            alert('El nombre de la playlist no puede estar vacío.');
                        }
                        return;
                    }

                    closeModal();

                    const result = await createPlaylist(plName, [song]);
                    if (result.success) {
                        if (typeof showStatus === 'function') {
                            showStatus(`Playlist "${plName}" creada con esta canción`, 'success');
                        }
                        // Refresh current modal checklist
                        await showAddToPlaylist(song);
                    } else if (typeof showStatus === 'function') {
                        showStatus(result.error, 'error');
                    } else {
                        alert(result.error);
                    }
                };

                confirmBtn.onclick = submitCreation;

                // Also listen for Enter key inside input
                nameInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitCreation();
                    }
                };
            };
        }

        const playlists = await getPlaylists();
        if (playlists.length === 0) {
            list.innerHTML = '<p style="padding:1.5rem;color:var(--text-muted);text-align:center;font-size:0.85rem;">Crea una playlist primero</p>';
        } else {
            list.innerHTML = playlists.map(pl => {
                const hasSong = pl.songs.some(s => s.src === song.src);
                return `
                <label class="add-playlist-option" data-id="${pl.id}">
                    <input type="checkbox" class="playlist-checkbox" ${hasSong ? 'checked' : ''}>
                    <span>${pl.name}</span>
                    <span class="pl-count-indicator">${pl.songs.length} canciones</span>
                </label>
                `;
            }).join('');
            list.querySelectorAll('.add-playlist-option').forEach(lbl => {
                const checkbox = lbl.querySelector('.playlist-checkbox');
                checkbox.addEventListener('change', async (e) => {
                    await handlePlaylistCheckboxChange(e, lbl, song);
                });
            });        }

        modal.classList.remove('hidden');
        
        // Also enable closing Add to Playlist modal when clicking backdrop
        const modalBackdrop = document.getElementById('backdropAddToPlaylist');
        const modalCloseBtn = document.getElementById('closeAddToPlaylistModal');
        if (modalBackdrop) {
            modalBackdrop.onclick = () => {
                modal.classList.add('hidden');
            };
        }
        if (modalCloseBtn) {
            modalCloseBtn.onclick = () => {
                modal.classList.add('hidden');
            };
        }
    }

    async function renderGrid() {
        const grid = document.getElementById('playlistsGrid');
        const empty = document.getElementById('playlistsEmpty');
        const gridIcon = document.getElementById('gridIcon');
        const listIcon = document.getElementById('listIcon');

        if (!grid) return;

        // Apply layout class
        grid.classList.toggle('list-view', layoutMode === 'list');

        // Update icons
        if (gridIcon && listIcon) {
            gridIcon.classList.toggle('hidden', layoutMode === 'list');
            listIcon.classList.toggle('hidden', layoutMode === 'grid');
        }

        const rawPlaylists = await getPlaylists();
        const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
        const favsFromLib = lib.filter(s => FavoritesModule.isFavorite(s.videoId));

        if (rawPlaylists.length === 0 && favsFromLib.length === 0) {
            grid.innerHTML = '';
            if (empty) { grid.appendChild(empty); empty.style.display = 'flex'; }
            return;
        }

        if (empty) empty.style.display = 'none';

        // Inject virtual favorites playlist at the top
        const allPlaylists = [
            { id: 'favorites', name: 'Favoritos', songs: favsFromLib, isVirtual: true },
            ...rawPlaylists
        ];

        grid.innerHTML = allPlaylists.map(pl => {
            let coverHTML = '';
            if (pl.id === 'favorites') {
                coverHTML = `
                <div class="playlist-card-cover-favorites" style="background: linear-gradient(135deg, rgba(197, 110, 110, 0.4) 0%, rgba(10, 12, 10, 0.6) 100%); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative;">
                    <svg viewBox="0 0 24 24" fill="var(--accent-error)" stroke="var(--accent-error)" stroke-width="1.5" style="width: 48px; height: 48px; filter: drop-shadow(0 0 8px rgba(197, 110, 110, 0.4));">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </div>
                `;
            } else {
                const covers = pl.songs.slice(0, 4).map(s => s.thumbnail).filter(Boolean);
                if (covers.length >= 4) {
                    const imgs = covers.map(c => `<img src="${c}" alt="" style="width:100%; height:100%; object-fit:cover;">`).join('');
                    coverHTML = `<div class="playlist-card-cover-grid" style="display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; width:100%; height:100%; gap:1px; background:rgba(0,0,0,0.1);">${imgs}</div>`;
                } else if (covers.length > 0) {
                    coverHTML = `<img src="${covers[0]}" style="width:100%;height:100%;object-fit:cover" alt="" onerror="this.src='favicon.png'">`;
                } else {
                    coverHTML = `
                    <div style="background: var(--bg-raised); border: 1px solid var(--border-subtle); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary);">
                        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--accent-gold);">music_note</span>
                    </div>
                    `;
                }
            }

            return `
                <div class="playlist-card ${pl.id === 'favorites' ? 'favorites-card' : ''}" data-id="${pl.id}">
                    <div class="playlist-card-cover">${coverHTML}</div>
                    <div class="playlist-card-info">
                        <div class="playlist-card-name">${pl.name}</div>
                        <div class="playlist-card-count">${pl.songs.length} canciones</div>
                    </div>
                </div>
            `;
        }).join('');


        grid.querySelectorAll('.playlist-card').forEach(card => {
            card.onclick = () => openPlaylistDetail(card.dataset.id);
        });
    }

    const playPlaylistBtn = document.getElementById('playPlaylistBtn');
    if (playPlaylistBtn) {
        playPlaylistBtn.addEventListener('click', async () => {
            if (!currentPlaylistId) return;

            let pl;
            if (currentPlaylistId === 'favorites') {
                const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
                const favs = lib.filter(s => FavoritesModule.isFavorite(s.videoId));
                pl = { songs: favs };
            } else {
                const playlists = await getPlaylists();
                pl = playlists.find(p => p.id === currentPlaylistId);
            }

            if (pl && pl.songs.length > 0) {
                PlayerModule.play(pl.songs[0], pl.songs, 0);
            }
        });
    }


    // Bind: Back button in detail view
    const backBtn = document.getElementById('backToPlaylistsBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentPlaylistId = null;
            NavigationModule.goBack();
        });
    }

    // Create playlist modal
    const createBtn = document.getElementById('createPlaylistBtn');
    const modal = document.getElementById('createPlaylistModal');
    const closeModal = document.getElementById('closePlaylistModal');
    const saveBtn = document.getElementById('savePlaylistBtn');
    const nameInput = document.getElementById('playlistNameInput');

    const getSelectedSongsForCreation = async () => {
        const songsList = document.getElementById('playlistCreateSongsList');
        if (!songsList) return [];
        const checkboxes = songsList.querySelectorAll('.playlist-create-checkbox:checked');
        const lib = typeof LibraryModule !== 'undefined' ? await LibraryModule.getLibrary() : [];
        return Array.from(checkboxes).map(cb => lib[Number.parseInt(cb.dataset.index, 10)]);
    };
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            if (modal) {
                if (nameInput) nameInput.value = '';

                // Fetch library songs and render in #playlistCreateSongsList using helper
                const songsList = document.getElementById('playlistCreateSongsList');
                if (songsList) {
                    await renderPlaylistCreateSongsList(songsList, saveBtn);
                }

                if (saveBtn) saveBtn.disabled = true; // start disabled
                modal.classList.remove('hidden');
                if (typeof NavigationModule !== 'undefined') {
                    NavigationModule.pushOverlayState('createPlaylistModal');
                }
                if (nameInput) setTimeout(() => nameInput.focus(), 100);
            }
        });
    }
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                modal?.classList.add('hidden');
            }
        });
    }
    if (modal) {
        modal.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                modal.classList.add('hidden');
            }
        });
    }

    if (nameInput) {
        nameInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const selectedSongs = await getSelectedSongsForCreation();
                if (selectedSongs.length === 0) {
                    alert('Debes seleccionar al menos una canción.');
                    return;
                }
                const result = await createPlaylist(nameInput.value, selectedSongs);
                if (result.success) {
                    if (typeof NavigationModule !== 'undefined') {
                        NavigationModule.closeOverlay();
                    } else {
                        modal?.classList.add('hidden');
                    }
                } else {
                    alert(result.error);
                }
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const selectedSongs = await getSelectedSongsForCreation();
            if (selectedSongs.length === 0) {
                alert('Debes seleccionar al menos una canción.');
                return;
            }
            const result = await createPlaylist(nameInput.value, selectedSongs);
            if (result.success) {
                if (typeof NavigationModule !== 'undefined') {
                    NavigationModule.closeOverlay();
                } else {
                    modal?.classList.add('hidden');
                }
            } else {
                alert(result.error);
            }
        });
    }

    const layoutToggle = document.getElementById('playlistLayoutToggle');
    if (layoutToggle) {
        layoutToggle.addEventListener('click', async () => {
            layoutMode = (layoutMode === 'grid' ? 'list' : 'grid');
            await StorageModule.set(LAYOUT_KEY, layoutMode);
            await renderGrid();
        });
    }

    // Close add-to-playlist modal
    const closeAddModal = document.getElementById('closeAddToPlaylistModal');
    const addModal = document.getElementById('addToPlaylistModal');
    if (closeAddModal) {
        closeAddModal.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                addModal?.classList.add('hidden');
            }
        });
    }
    if (addModal) {
        addModal.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                addModal.classList.add('hidden');
            }
        });
    }

    return {
        createPlaylist,
        deletePlaylist,
        addSongToPlaylist,
        removeSongFromPlaylist,
        showAddToPlaylist,
        openPlaylistDetail,
        renderGrid,
        getPlaylists,
        renderPlaylistSongs,
        get currentPlaylistId() { return currentPlaylistId; },
        set currentPlaylistId(val) { currentPlaylistId = val; },
        get layoutMode() { return layoutMode; },
        set layoutMode(val) { layoutMode = val; }
    };
})();


// ========================================
// Hook: post-download → add to library
// ========================================
// Patch downloadBlob to also add to library after successful download
const _origDownloadBlob = globalThis.downloadBlob || function () { };
async function downloadBlobAndSave(blob, filename, songMeta) {
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;

    let localPath = null;
    let audioSrc = null;

    if (getIsNative() && fs) {
        try {
            // 1. Request Permissions
            const perm = await fs.requestPermissions();
            if (perm.publicStorage !== 'granted') {
                console.warn('Permisos de almacenamiento denegados.');
            }

            // 2. Prepare Public Folder (YTMusic)
            const PUBLIC_DIR = 'YTMusic';
            try {
                await fs.mkdir({
                    path: PUBLIC_DIR,
                    directory: 'DOCUMENTS',
                    recursive: true
                });
            } catch (e) { console.debug('[Download] mkdir documents ignored:', e); }

            // 3. CHUNKED WRITE
            const sanitizedName = sanitizeFilename(filename.replace(/\.[^/.]+$/, '')) + (filename.endsWith('.mp3') ? '.mp3' : '.m4a');
            const fullPath = `${PUBLIC_DIR}/${sanitizedName}`;
            await writeBlobToDocumentsFilesystem(fs, fullPath, blob);

            localPath = fullPath;
            console.log(`[Download] Saved natively: ${fullPath} (${blob.size} bytes, chunked)`);

            // 4. Resolve to a playable URL via Capacitor
            const savedUri = await fs.getUri({ path: fullPath, directory: 'DOCUMENTS' });
            audioSrc = globalThis.Capacitor.convertFileSrc(savedUri.uri);
        } catch (err) {
            console.error('[Download] Native save error, falling back to web download:', err);
        }
    }

    // Camino web: guardar el audio en IndexedDB y entregar el fichero al usuario.
    // Son dos cosas distintas y antes estaban mezcladas: el `src` de la biblioteca
    // apuntaba al object URL de la descarga, que muere al recargar la página.
    if (!audioSrc) {
        // a) Persistencia para reproducción offline.
        //    Solo si la canción va a entrar en la biblioteca: sin songMeta el blob
        //    quedaría en IndexedDB sin que nada lo referencie ni lo pueda borrar.
        let stored = false;
        if (songMeta) {
            const songId = songMeta.id || songMeta.videoId || generateSongId();
            stored = await StorageModule.putBlob(songId, blob);
            audioSrc = stored ? `${IDB_SRC_PREFIX}${songId}` : null;
        }

        // b) Descarga al disco del usuario, con URL temporal que se revoca al momento
        const tempUrl = globalThis.URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = tempUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } finally {
            globalThis.URL.revokeObjectURL(tempUrl);
        }

        if (songMeta && !stored) {
            console.warn('[Download] El audio no se pudo guardar offline; la canción no se añade a la biblioteca.');
            if (typeof showStatus === 'function') {
                showStatus('La descarga se completó, pero no se pudo guardar en la biblioteca', 'error');
            }
            return;
        }
    }

    // Add to library
    if (songMeta) {
        await LibraryModule.addSong({
            src: audioSrc,
            localPath: localPath,
            title: songMeta.title || filename.replace('.m4a', '').replace('.mp3', ''),
            channel: songMeta.channel || 'Artista desconocido',
            thumbnail: songMeta.thumbnail || '',
            videoId: songMeta.id || songMeta.videoId || '',
            addedAt: new Date().toISOString()
        });
        await LibraryModule.render();
    }
}

// ========================================
// Native PWA Capacitor Fixes: Auto-Recover & Garbage Collector
// ========================================
async function runNativeRecovery() {
    if (!getIsNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) return;

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
function toggleLibraryLoader(show, text) {
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

async function extractLocalMetadata(blobOrFile) {
    if (typeof jsmediatags === 'undefined') return null;

    return new Promise((resolve) => {
        jsmediatags.read(blobOrFile, {
            onSuccess: (tag) => {
                let coverBase64 = '';
                if (tag.tags.picture) {
                    const { data, format } = tag.tags.picture;
                    let base64String = "";
                    for (let i = 0; i < data.length; i++) {
                        base64String += String.fromCodePoint(data[i]);
                    }
                    coverBase64 = `data:${format};base64,${globalThis.btoa(base64String)}`;
                }
                resolve({
                    title: tag.tags.title || null,
                    artist: tag.tags.artist || null,
                    picture: coverBase64
                });
            },
            onError: () => resolve(null)
        });
    });
}

function base64ToBlob(base64, type) {
    if (!base64) return null;
    try {
        const bin = atob(base64);
        const len = bin.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: type });
    } catch (e) { return null; }
}
async function scanPublicFolder(silent = false) {
    if (!getIsNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) return;

    const fs = globalThis.Capacitor.Plugins.Filesystem;
    const searchPaths = ['YTMusic', 'Download', 'Music'];
    const syncBtn = document.getElementById('syncLibraryBtn');

    try {
        if (!silent) {
            toggleLibraryLoader(true, 'Escaneando carpetas de música...');
            if (syncBtn) syncBtn.classList.add('syncing');
        }

        // Request Permissions
        const perm = await fs.requestPermissions();
        if (perm.publicStorage !== 'granted') {
            if (!silent) {
                toggleLibraryLoader(false);
                showStatus('Acceso a archivos denegado por el sistema.', 'error');
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
            if (!silent) showStatus(`¡Sincronizado! Se añadieron ${newCount} canciones nuevas.`, 'success');
        } else if (!silent) {
            showStatus('La biblioteca ya está al día.', 'success');
        }

    } catch (err) {
        console.error('Unified scan error:', err);
        if (!silent) {
            toggleLibraryLoader(false);
            showStatus('Error al escanear almacenamiento.', 'error');
        }
    } finally {
        if (syncBtn) syncBtn.classList.remove('syncing');
    }
}
function setupNativeSync() {
    const syncBtn = document.getElementById('syncLibraryBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', () => scanPublicFolder(false));
    }
}

function setupNativeImporter() {
    const importBtn = document.getElementById('importAudioBtn');
    const importInput = document.getElementById('importAudioInput');
    if (importBtn === null || importInput === null) return;

    importBtn.addEventListener('click', () => importInput.click());

    importInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        if (!getIsNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) {
            alert('Esta función "Bóveda Oculta" es exclusiva de la App Nativa.');
            importInput.value = '';
            return;
        }

        const fs = globalThis.Capacitor.Plugins.Filesystem;
        let successCount = 0;

        if (typeof showStatus === 'function') {
            showStatus(`Importando ${files.length} audios...`, 'info');
        }

        const CONCURRENCY_LIMIT = 4;
        let processedCount = 0;


        const processFile = async (file) => {
            if (file.size > 100 * 1024 * 1024) {
                console.warn('Archivo demasiado grande:', file.name);
                return null;
            }

            try {
                const metadata = await Promise.race([
                    readJsMediaTags(file),
                    new Promise(resolve => setTimeout(() => resolve(null), 5000))
                ]);

                const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const uuid = Math.random().toString(36).substring(2, 10);
                const finalNativePath = `imported_${uuid}_${safeName}`;
                const CHUNK_SIZE = 2 * 1024 * 1024;
                let offset = 0;
                let isFirstChunk = true;

                while (offset < file.size) {
                    const chunk = file.slice(offset, offset + CHUNK_SIZE);
                    const arrayBuffer = await chunk.arrayBuffer();
                    const base64Chunk = arrayBufferToBase64(arrayBuffer);

                    if (isFirstChunk) {
                        await fs.writeFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
                        isFirstChunk = false;
                    } else {
                        await fs.appendFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
                    }
                    offset += CHUNK_SIZE;
                }

                // Resolve the file to a playable URL
                const savedUri = await fs.getUri({ path: finalNativePath, directory: 'DATA' });
                const playableUrl = globalThis.Capacitor.convertFileSrc(savedUri.uri);

                return {
                    src: playableUrl,
                    localPath: finalNativePath,
                    title: metadata?.title || file.name.replace(/\.[^/.]+$/, ""),
                    channel: metadata?.artist || 'Importado localmente',
                    thumbnail: metadata?.picture || '',
                    videoId: `lib_${uuid}`,
                    addedAt: new Date().toISOString()
                };
            } catch (err) {
                console.error('Failed to import:', file.name, err);
                return null;
            } finally {
                processedCount++;
                if (typeof showStatus === 'function' && files.length > 1) {
                    showStatus(`Importando: ${processedCount}/${files.length} finalizados...`, 'info');
                }
            }
        };

        // LOOP DE PROCESAMIENTO (Restaurado)
        const importedSongs = [];
        for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
            const batch = files.slice(i, i + CONCURRENCY_LIMIT);
            const results = await Promise.all(batch.map(f => processFile(f)));
            for (const res of results) {
                if (res) importedSongs.push(res);
            }
        }

        if (importedSongs.length > 0) {
            successCount = await LibraryModule.addSongs(importedSongs);
        }

        if (typeof showStatus === 'function') showStatus(`¡Importación lista! Añadidos: ${successCount}`, 'success');
        importInput.value = '';
    });

    setupNativeSync();
}

function setupDownloadModal() {
    const modal = document.getElementById('downloadApkModal');
    const closeBtn = document.getElementById('downloadModalClose');
    const backdrop = modal?.querySelector('.auth-modal-backdrop');

    if (!modal) return;

    document.querySelectorAll('.android-app-btn-el').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            modal.classList.remove('hidden');
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.pushOverlayState('downloadApkModal');
            }
        });
    });

    const close = () => closeOverlayOrHideModal(modal);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
}

document.addEventListener('DOMContentLoaded', async () => {
    updateEnvironment(); // Refresh global vars before primary initialization
    await migrateStorage();
    await repairLegacyBlobEntries();
    StorageModule.requestPersistence(); // sin await: no debe retrasar el arranque
    window.languageManager = new LanguageManager();
    await window.languageManager.init();

    // Add debug label to footer/sidebar (Point 8)
    const footer = document.querySelector('.player-controls') || document.body;
    const label = document.createElement('div');
    label.id = 'debug-env-label';
    label.style.cssText = 'position:fixed;bottom:2px;right:5px;font-size:10px;color:rgba(255,255,255,0.2);z-index:99999;pointer-events:none;';
    label.textContent = `v=74 [N:${IS_NATIVE}]`;
    footer.appendChild(label);
    await FavoritesModule.init();

    if (typeof auth !== 'undefined' && typeof auth.init === 'function') {
        auth.init();
    }

    setTimeout(runNativeRecovery, 800);

    await LibraryModule.render();
    if (typeof PlaylistModule !== 'undefined') {
        PlaylistModule.layoutMode = await StorageModule.get('ytdl_playlist_layout') || 'grid';
        await PlaylistModule.renderGrid();
    }
    await LibraryModule.updateCount();

    setupNativeImporter();
    setupDownloadModal();
});

// Gestos Táctiles (Swipe to Queue) — Improved
let swipeEventsInitialized = false;
function initSwipeEvents() {
    if (swipeEventsInitialized) return;
    swipeEventsInitialized = true;

    let startX = 0;
    let startY = 0;
    let currentSwipeX = 0;
    let isSwiping = false;
    let swipeItem = null;
    let isHorizontal = null;
    const threshold = 120; // Higher threshold to avoid accidental triggers

    document.addEventListener('touchstart', (e) => {
        const item = e.target.closest('.library-item');
        if (!item) return;

        startX = e.touches[0].clientX;

        // Ignore swipes starting near screen edges (allow OS back gestures)
        if (startX < 30 || startX > window.innerWidth - 30) return;

        startY = e.touches[0].clientY;
        currentSwipeX = 0;
        isSwiping = true;
        isHorizontal = null;
        swipeItem = item;
        const content = item.querySelector('.library-item-content');
        if (content) content.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isSwiping || !swipeItem) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        // Determine direction on first significant move
        if (isHorizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            isHorizontal = Math.abs(dx) > Math.abs(dy);
            if (!isHorizontal) { isSwiping = false; return; }
        }
        if (!isHorizontal) return;

        currentSwipeX = Math.max(0, dx); // Only allow right swipe
        const content = swipeItem.querySelector('.library-item-content');
        const bg = swipeItem.querySelector('.swipe-action-bg');
        const capped = Math.min(currentSwipeX, threshold * 1.3);
        if (content) content.style.transform = `translateX(${capped}px)`;
        if (bg) bg.style.opacity = Math.min(currentSwipeX / threshold, 1);
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (!swipeItem) { isSwiping = false; return; }
        const content = swipeItem.querySelector('.library-item-content');
        const bg = swipeItem.querySelector('.swipe-action-bg');
        if (currentSwipeX >= threshold) {
            const rawData = swipeItem.dataset.song || '';
            console.log("Swipe data raw:", rawData);
            try {
                const songData = rawData ? JSON.parse(decodeURIComponent(rawData)) : {};
                console.log("Swipe song parsed:", songData);
                handleSongSwipeAddToQueue(songData);
            } catch (err) {
                console.error("Error parsing swipe data:", err, rawData);
            }            // Bounce-back animation
            if (content) {
                content.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                content.style.transform = 'translateX(0)';
            }
        } else if (content) {
            content.style.transition = 'transform 0.2s ease-out';
            content.style.transform = 'translateX(0)';
        }
        if (bg) {
            bg.style.transition = 'opacity 0.2s ease';
            bg.style.opacity = 0;
            setTimeout(() => { bg.style.transition = ''; }, 200);
        }
        currentSwipeX = 0;
        isSwiping = false;
        isHorizontal = null;
        swipeItem = null;
    });
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initSwipeEvents();
} else {
    document.addEventListener('DOMContentLoaded', initSwipeEvents);
}

// ========================================
// 🟢 NEW: Lyrics Module (LRCLIB API)
// Fetches synchronized lyrics and displays them in the full player
// ========================================
const LyricsModule = (() => {
    let currentLyrics = [];
    let lyricsVisible = false;
    let currentTrackKey = '';

    // Auto-scroll tracking variables
    let lastUserScrollTime = 0;
    let lastActiveIndex = -1;
    let isProgrammaticScroll = false;
    let lastUserScrollTimeoutActive = false;

    const lyricsSection = document.getElementById('lyricsSection');
    const lyricsContent = document.getElementById('lyricsContent');
    const lyricsToggle = document.getElementById('lyricsToggle');

    if (lyricsSection) {
        lyricsSection.addEventListener('scroll', () => {
            if (isProgrammaticScroll) {
                isProgrammaticScroll = false;
                return;
            }
            lastUserScrollTime = Date.now();
        });
    }

    // Toggle lyrics view scroll snap
    if (lyricsToggle) {
        lyricsToggle.addEventListener('click', () => {
            const lyricsView = document.querySelector('.full-player-lyrics-view');
            const mainView = document.querySelector('.full-player-main-view');
            const content = document.querySelector('.full-player-content');
            if (content && lyricsView && mainView) {
                const isBottom = content.scrollTop >= content.clientHeight * 0.4;
                const targetView = isBottom ? mainView : lyricsView;
                targetView.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Back to player from lyrics header
    const lyricsBackBtn = document.getElementById('lyricsBackBtn');
    if (lyricsBackBtn) {
        lyricsBackBtn.addEventListener('click', () => {
            const mainView = document.querySelector('.full-player-main-view');
            if (mainView) {
                mainView.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Detect scroll to toggle button state dynamically
    const fpContent = document.querySelector('.full-player-content');
    if (fpContent && lyricsToggle) {
        fpContent.addEventListener('scroll', () => {
            const isBottom = fpContent.scrollTop >= fpContent.clientHeight * 0.4;
            lyricsToggle.classList.toggle('active', isBottom);
            
            const wasVisible = lyricsVisible;
            lyricsVisible = isBottom;

            // Snap immediately to active line when lyrics become visible
            if (lyricsVisible && !wasVisible && lastActiveIndex >= 0) {
                const lines = lyricsContent.querySelectorAll('.lyrics-line');
                if (lines[lastActiveIndex]) {
                    isProgrammaticScroll = true;
                    lines[lastActiveIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    }

    // Parse LRC format "[mm:ss.xx] text"
    function parseLRC(lrcText) {
        if (!lrcText) return [];
        const lines = lrcText.split('\n');
        const parsed = [];

        for (const line of lines) {
            const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const ms = parseInt(match[3].padEnd(3, '0'));
                const time = minutes * 60 + seconds + ms / 1000;
                const text = match[4].trim();
                if (text) {
                    parsed.push({ time, text });
                }
            }
        }

        return parsed.sort((a, b) => a.time - b.time);
    }

    // Fetch lyrics from LRCLIB API
    async function fetchLyrics(title, artist) {
        if (!title) return null;

        // Clean title: remove common noise like "(Official Video)", "[Lyrics]", etc.
        const cleanTitle = title
            .replace(/\((?:official|lyric|audio|video|hd|hq|4k|visualizer|ft\.?|feat\.?).*?\)/gi, '')
            .replace(/\[(?:official|lyric|audio|video|hd|hq|4k).*?\]/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

        const cleanArtist = (artist || '')
            .replace(/\s*-\s*Topic$/i, '')
            .replace(/VEVO$/i, '')
            .trim();

        try {
            // Try synced search first
            const params = new URLSearchParams({
                track_name: cleanTitle,
                artist_name: cleanArtist
            });

            const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`);

            if (!response.ok) return null;

            const results = await response.json();

            if (results && results.length > 0) {
                // Prefer synced lyrics over plain
                const synced = results.find(r => r.syncedLyrics);
                if (synced?.syncedLyrics) {
                    return { type: 'synced', data: parseLRC(synced.syncedLyrics) };
                }
                // Fall back to plain lyrics
                const plain = results.find(r => r.plainLyrics);
                if (plain?.plainLyrics) {
                    return { type: 'plain', data: plain.plainLyrics };
                }
            }
        } catch (err) {
            console.warn('[Lyrics] Fetch error:', err);
        }

        return null;
    }

    // Render lyrics into the DOM
    function renderLyrics(lyrics) {
        if (!lyricsContent) return;

        if (!lyrics) {
            lyricsContent.innerHTML = '<p class="lyrics-empty">No lyrics found for this track</p>';
            return;
        }

        if (lyrics.type === 'plain') {
            lyricsContent.innerHTML = lyrics.data
                .split('\n')
                .filter(l => l.trim())
                .map(l => `<p class="lyrics-line past">${l}</p>`)
                .join('');
            return;
        }

        // Synced lyrics
        currentLyrics = lyrics.data;
        lyricsContent.innerHTML = currentLyrics
            .map((l, i) => `<p class="lyrics-line" data-time="${l.time}" data-index="${i}">${l.text}</p>`)
            .join('');

        // Click to seek
        lyricsContent.querySelectorAll('.lyrics-line[data-time]').forEach(el => {
            el.addEventListener('click', () => {
                const time = Number.parseFloat(el.dataset.time);
                if (window.PlayerModule && typeof PlayerModule.seekTo === 'function') {
                    PlayerModule.seekTo(time);
                }
            });
        });
    }

    // Update active lyric line based on current time
    function updateActiveLine(currentTime) {
        if (!currentLyrics.length || !lyricsContent) return;

        let activeIndex = -1;
        for (let i = currentLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= currentLyrics[i].time) {
                activeIndex = i;
                break;
            }
        }

        const lines = lyricsContent.querySelectorAll('.lyrics-line');
        lines.forEach((el, i) => {
            el.classList.toggle('active', i === activeIndex);
            el.classList.toggle('past', i < activeIndex);
        });

        // Auto-scroll to active line with user interaction detection
        if (activeIndex >= 0 && lines[activeIndex]) {
            const activeIndexChanged = (activeIndex !== lastActiveIndex);
            const userScrollTimeoutActive = (Date.now() - lastUserScrollTime < 5000);

            // Should scroll if:
            // 1. Line changed AND user hasn't scrolled manually recently.
            // 2. OR user went idle (scroll timeout just expired) so we snap back smoothly.
            const shouldScroll = (activeIndexChanged && !userScrollTimeoutActive) ||
                (!userScrollTimeoutActive && lastUserScrollTimeoutActive);

            if (shouldScroll && lyricsVisible) {
                isProgrammaticScroll = true;
                lines[activeIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            lastActiveIndex = activeIndex;
            lastUserScrollTimeoutActive = userScrollTimeoutActive;
        }
    }

    // Called when a new song starts playing
    async function onTrackChange(title, artist) {
        const trackKey = `${title}|${artist}`;
        if (trackKey === currentTrackKey) return;
        currentTrackKey = trackKey;

        if (lyricsContent) {
            lyricsContent.innerHTML = '<p class="lyrics-empty">Searching for lyrics...</p>';
        }

        const lyrics = await fetchLyrics(title, artist);

        // Verify we're still on the same track
        if (`${title}|${artist}` !== currentTrackKey) return;

        renderLyrics(lyrics);

        // Show lyrics section if we found them
        if (lyrics && lyricsSection) {
            lyricsSection.classList.remove('hidden');
        }
    }

    return {
        onTrackChange,
        updateActiveLine,
        get visible() { return lyricsVisible; }
    };
})();
// Listeners for Full Player
document.addEventListener('DOMContentLoaded', () => {
    const fullPlayer = document.getElementById('fullPlayer');
    const fpCloseBtn = document.getElementById('fpCloseBtn');

    // Open full player when clicking mini player info/thumb
    const playerInfo = document.getElementById('playerInfo');
    const playerThumb = document.getElementById('playerThumb');

    if (playerInfo && fullPlayer) {
        playerInfo.addEventListener('click', () => {
            if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.showFullPlayer === 'function') {
                PlayerModule.showFullPlayer();
            } else {
                fullPlayer.classList.remove('fp-hidden');
            }
        });
    }
    if (playerThumb && fullPlayer) {
        playerThumb.addEventListener('click', () => {
            if (typeof PlayerModule !== 'undefined' && typeof PlayerModule.showFullPlayer === 'function') {
                PlayerModule.showFullPlayer();
            } else {
                fullPlayer.classList.remove('fp-hidden');
            }
        });
    }

    // Close full player
    if (fpCloseBtn && fullPlayer) {
        fpCloseBtn.addEventListener('click', () => {
            if (typeof NavigationModule !== 'undefined') {
                NavigationModule.closeOverlay();
            } else {
                fullPlayer.classList.add('fp-hidden');
            }
        });
    }

    // Wire up controls in full player to match mini player
    const fpPlayPauseBtn = document.getElementById('fpPlayPauseBtn');
    const miniPlayPauseBtn = document.getElementById('playPauseBtn');

    if (fpPlayPauseBtn && miniPlayPauseBtn) {
        fpPlayPauseBtn.addEventListener('click', () => {
            miniPlayPauseBtn.click();
            // sync icon
            setTimeout(() => {
                const isPlaying = !audio.paused;
                fpPlayPauseBtn.innerHTML = isPlaying
                    ? '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">pause</span>'
                    : '<span class="material-symbols-outlined" style="font-variation-settings: \'FILL\' 1;">play_arrow</span>';
            }, 50);
        });
    }

    const fpPrevBtn = document.getElementById('fpPrevBtn');
    const miniPrevBtn = document.getElementById('prevBtn');
    if (fpPrevBtn && miniPrevBtn) {
        fpPrevBtn.addEventListener('click', () => miniPrevBtn.click());
    }

    const fpNextBtn = document.getElementById('fpNextBtn');
    const miniNextBtn = document.getElementById('nextBtn');
    if (fpNextBtn && miniNextBtn) {
        fpNextBtn.addEventListener('click', () => miniNextBtn.click());
    }

    // Seekbar implementation for Full Player
    const fpSeekBar = document.getElementById('fpSeekBar');
    if (fpSeekBar) {
        fpSeekBar.addEventListener('click', (e) => {
            if (!audio.duration) return;
            const rect = fpSeekBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (PlayerModule?.seekTo) {
                PlayerModule.seekTo(pos * audio.duration);
            }
        });
    }

    // Lógica para el desplegable de calidad de audio personalizado
    const customSelectWrapper = document.querySelector('.custom-select-wrapper');
    const customSelect = document.getElementById('customQualitySelect');
    const customOptionsContainer = document.getElementById('customQualityOptions');
    const nativeSelect = document.getElementById('qualitySelect');

    if (customSelect && customOptionsContainer && nativeSelect) {
        // Alternar menú de opciones
        customSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            customSelectWrapper.classList.toggle('open');
        });

        // Manejar selección de opción
        customOptionsContainer.querySelectorAll('.custom-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const triggerText = option.textContent;
                const i18nKey = option.dataset.i18n;

                // Actualizar texto y atributo i18n del disparador
                const trigger = customSelect.querySelector('.custom-select-trigger');
                if (trigger) {
                    trigger.textContent = triggerText;
                    if (i18nKey) trigger.dataset.i18n = i18nKey;
                    else delete trigger.dataset.i18n;
                }

                // Resaltar opción seleccionada
                customOptionsContainer.querySelectorAll('.custom-option').forEach(opt => {
                    opt.classList.toggle('selected', opt === option);
                });

                // Sincronizar select nativo oculto y disparar evento de cambio
                nativeSelect.value = value;
                nativeSelect.dispatchEvent(new Event('change'));

                // Cerrar desplegable
                customSelectWrapper.classList.remove('open');
            });
        });

        // Cerrar menú si se hace clic en cualquier otra parte
        document.addEventListener('click', () => {
            customSelectWrapper.classList.remove('open');
        });
    }
});
// Duplicate lyricsToggle listener removed to prevent toggle conflicts (handled natively inside LyricsModule)








