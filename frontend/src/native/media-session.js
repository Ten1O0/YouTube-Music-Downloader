/**
 * Controles del sistema (notificación, pantalla de bloqueo, islas): el plugin
 * de Capacitor en la APK y navigator.mediaSession en la web.
 */

import { isNative } from '../config/env.js';

// ========================================
// Native Media Session Helper (uses @jofr/capacitor-media-session plugin)
// Falls back to navigator.mediaSession for web/PWA
// ========================================
export const NativeMediaSession = (() => {
    let _plugin = null;
    let _handlersRegistered = false;

    function getPlugin() {
        if (_plugin) return _plugin;
        try {
            if (globalThis.Capacitor?.Plugins?.MediaSession) {
                _plugin = globalThis.Capacitor.Plugins.MediaSession;
                return _plugin;
            }
        } catch (e) {
            console.warn('[NativeMediaSession] Plugin not available:', e);
        }
        return null;
    }

    // `nativa` / `web`: a quién se manda (por defecto, a los dos)
    async function setMetadata(metadata, { artworkNativa, nativa = true, web = true } = {}) {
        const plugin = nativa ? getPlugin() : null;
        if (plugin) {
            try {
                // CRITICAL: Android Binder IPC has a 1MB transaction limit.
                // Sending multiple artwork entries (especially base64 data: URIs)
                // will exceed this limit and crash the app instantly.
                // Solution: send at most 1 small artwork to the native plugin.
                // Además, el plugin descarga y decodifica todas las que recibe.
                // Y siempre una lista: sin `artwork`, el plugin de Android lanza
                // una NullPointerException y cierra la app entera (plan 12, T1)
                const nativeMetadata = { ...metadata, artwork: [] };
                if (artworkNativa) {
                    nativeMetadata.artwork = [artworkNativa];
                } else if (metadata.artwork && metadata.artwork.length > 0) {
                    // Pick the first non-base64 artwork, or just the first one
                    const urlArt = metadata.artwork.find(a => !a.src.startsWith('data:'));
                    nativeMetadata.artwork = urlArt ? [urlArt] : [metadata.artwork[0]];
                }
                await plugin.setMetadata(nativeMetadata);
            } catch (e) {
                console.warn('[NativeMediaSession] setMetadata error:', e);
            }
        }
        // Web MediaMetadata doesn't have the Binder limit — send full artwork array
        if (web && 'mediaSession' in navigator) {
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
    }

    function isAvailable() {
        return !!getPlugin();
    }

    return { setMetadata, setPlaybackState, setPositionState, registerHandlers, isAvailable };
})();

export function buildMediaSessionArtwork(artworkUrl, isValidNativeUrl) {
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

export function validateArtworkUrlForNative(artworkUrl) {
    if (!artworkUrl) return true;
    if (isNative()) {
        return artworkUrl.includes(';base64,');
    }
    return artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://') || artworkUrl.includes(';base64,');
}
