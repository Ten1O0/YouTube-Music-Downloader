/**
 * Lo que ve el sistema de la canción que suena: título, artista y carátula en
 * la notificación, la pantalla de bloqueo y las islas; la posición; y los
 * botones del sistema y de los auriculares, que llaman al reproductor.
 */

import { nombreDe } from '../../core/titles.js';
import { buildMediaSessionArtwork, NativeMediaSession, validateArtworkUrlForNative } from '../../native/media-session.js';
import { caratulaCuadrada, LADO_SISTEMA, LADO_WEB } from '../../ui/artwork.js';

/** Cuánto espera la APK a la carátula cuadrada antes de enseñar la miniatura. */
const ESPERA_CARATULA_MS = 400;
/** Desvío entre lo que cree el sistema y el audio a partir del cual se le corrige. */
const DESVIO_MAXIMO_S = 1;

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
            title: nombreDe(song).titulo,
            artist: nombreDe(song).artista || 'Artista desconocido',
            album: 'Music Downloader',
            artwork: artwork
        };
        NativeMediaSession.setMetadata(metadatos, { nativa: false });

        // En cuanto está lista, una carátula cuadrada y nítida sustituye a la
        // miniatura 16:9: es la que ven la pantalla de bloqueo, la notificación
        // y las islas del sistema. A la APK, si llega pronto, solo la cuadrada:
        // el plugin descarga y decodifica cada carátula (plan 19, T15)
        const turno = ++turnoCaratulaSistema;
        let provisionalEnviada = false;
        const enviarProvisional = () => {
            if (provisionalEnviada || turno !== turnoCaratulaSistema) return;
            provisionalEnviada = true;
            NativeMediaSession.setMetadata(metadatos, { web: false });
        };
        const espera = setTimeout(enviarProvisional, ESPERA_CARATULA_MS);
        caratulaCuadrada(song.thumbnail).then((cuadrada) => {
            clearTimeout(espera);
            if (!cuadrada) { enviarProvisional(); return; }
            if (turno !== turnoCaratulaSistema) return;
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

    // Lo último que se le dijo al sistema, para saber dónde cree que va
    let enviada = null;

    function updatePositionState() {
        if (!audio.duration || Number.isNaN(audio.duration) || !Number.isFinite(audio.duration)) return;

        const posState = {
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: audio.currentTime || 0
        };

        enviada = { ...posState, sonando: !audio.paused, en: Date.now() };
        NativeMediaSession.setPositionState(posState);
    }

    /**
     * Con cada `timeupdate` (plan 19, T15). El sistema avanza la posición por
     * su cuenta desde la última que recibió, así que no hace falta repetírsela
     * cada segundo: solo se le corrige si se ha desviado (un corte de red que
     * paró el audio, otra duración) o si nunca la recibió.
     */
    function revisarPosicion() {
        if (!audio.duration || !Number.isFinite(audio.duration)) return;
        if (!enviada || enviada.duration !== audio.duration) { updatePositionState(); return; }
        const cree = enviada.position + (enviada.sonando ? (Date.now() - enviada.en) / 1000 * enviada.playbackRate : 0);
        if (Math.abs(cree - audio.currentTime) > DESVIO_MAXIMO_S) updatePositionState();
    }

    return { updateMediaSession, updatePositionState, revisarPosicion };
}
