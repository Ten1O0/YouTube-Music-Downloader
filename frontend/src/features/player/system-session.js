/**
 * Lo que ve el sistema de la canción que suena: título, artista y carátula en
 * la notificación, la pantalla de bloqueo y las islas; la posición; y los
 * botones del sistema y de los auriculares, que llaman al reproductor.
 */

import { buildMediaSessionArtwork, NativeMediaSession, validateArtworkUrlForNative } from '../../native/media-session.js';
import { caratulaCuadrada, LADO_SISTEMA, LADO_WEB } from '../../ui/artwork.js';

export function createSesionSistema({ audio, resume, pause, prev, next, updatePlayPauseBtn }) {
    let turnoCaratulaSistema = 0;
    function updateMediaSession(song) {
        if (!('mediaSession' in navigator) && !NativeMediaSession.isAvailable()) return;

        // Native plugin might crash when processing local capacitor bridge URLs or huge Base64 strings.
        // `song._runtimeThumbnailNative` contains a pure Android `file://` URI which plugins CAN parse.
        let artworkUrl = song._runtimeThumbnailNative || song.thumbnail;

        let isValidNativeUrl = validateArtworkUrlForNative(artworkUrl);

        const artwork = buildMediaSessionArtwork(artworkUrl, isValidNativeUrl);

        // Set metadata via native plugin + web fallback
        const metadatos = {
            title: song.title || 'Sin título',
            artist: song.channel || 'Artista desconocido',
            album: 'Music Downloader',
            artwork: artwork
        };
        NativeMediaSession.setMetadata(metadatos);

        // En cuanto está lista, una carátula cuadrada y nítida sustituye a la
        // miniatura 16:9: es la que ven la pantalla de bloqueo, la notificación
        // y las islas del sistema
        const turno = ++turnoCaratulaSistema;
        caratulaCuadrada(song.thumbnail).then((cuadrada) => {
            if (!cuadrada || turno !== turnoCaratulaSistema) return;
            NativeMediaSession.setMetadata(
                { ...metadatos, artwork: [{ src: cuadrada.web, sizes: `${LADO_WEB}x${LADO_WEB}`, type: 'image/jpeg' }, ...artwork] },
                { artworkNativa: { src: cuadrada.sistema, sizes: `${LADO_SISTEMA}x${LADO_SISTEMA}`, type: 'image/jpeg' } },
            );
        });

        // Set playback state
        updatePositionState();
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
            }
        });

        updatePositionState();
    }

    function updatePositionState() {
        if (!audio.duration || Number.isNaN(audio.duration) || !Number.isFinite(audio.duration)) return;

        const posState = {
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: audio.currentTime || 0
        };

        NativeMediaSession.setPositionState(posState);
    }

    return { updateMediaSession, updatePositionState };
}
