/**
 * Reproductor: cola, reproducción, barra inferior y pantalla completa.
 */

import { resolveNativeThumbnail, resolveStreamSrc } from '../../core/audio-store.js';
import { addOptionalEventListener, extractVideoId } from '../../core/utils.js';
import { i18n } from '../../i18n/language-manager.js';
import { NativeMediaSession } from '../../native/media-session.js';
import { avisarHaptico } from '../../ui/haptics.js';
import { prefersReducedMotion, Spring } from '../../ui/motion/spring.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { avisar } from '../../ui/toast.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { LyricsModule } from '../lyrics.js';
import { initBarras } from './controls.js';
import { createFullPlayer } from './full-player.js';
import { createQueueSheet } from './queue-sheet.js';
import { createSesionSistema } from './system-session.js';
import { syncRepeatButtonState, toggleHeartButtonState, updatePlayerUI } from './ui.js';

let isTransitioning = false; // Prevents rapid clicks (400ms debounce)

// ========================================
// Environment Detection (Handled at the top of the file)

// ========================================
// PlayerModule — MP3 Reproductor completo
// ========================================
export const PlayerModule = (() => {
    const audio = document.getElementById('mainAudio');
    const playerBar = document.getElementById('playerBar');
    const playerPlay = document.getElementById('playerPlay');
    const playerPrev = document.getElementById('playerPrev');
    const playerNext = document.getElementById('playerNext');
    const playerShuffle = document.getElementById('playerShuffle');
    const playerRepeat = document.getElementById('playerRepeat');
    const playerVolume = document.getElementById('playerVolume');
    const playerDuration = document.getElementById('playerDuration');
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
    const fullPlayerThumb = document.getElementById('fullPlayerThumb');
    const fullPlayerFav = document.getElementById('fullPlayerFav');
    const fullPlayerLyrics = document.getElementById('fullPlayerLyrics');
    const fullPlayerVolume = document.getElementById('fullPlayerVolume');

    let queue = [];
    let nextQueue = []; // Spotify-style play next
    let currentIndex = 0;
    let isShuffled = false;
    let shuffledQueue = [];
    let repeatMode = 0; // 0=off, 1=all, 2=one

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
        if (typeof LyricsModule.updateActiveLine === 'function') {
            LyricsModule.updateActiveLine(current);
        }
    }

    // ── Pantalla completa (full-player.js) ──
    const { showFullPlayer, hideFullPlayer } = createFullPlayer({
        cancionActual: () => getCurrentQueue()[currentIndex],
    });

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
        // Los dos glifos están superpuestos; el CSS cruza uno con otro según
        // .is-playing (plan 09, T9). El display en línea del HTML se retira.
        for (const btn of [playerPlay, fullPlayerPlay]) {
            if (!btn) continue;
            btn.querySelectorAll('.play-icon, .pause-icon').forEach(icono => { icono.style.display = ''; });
            btn.classList.toggle('is-playing', playing);
        }
    }

    // ── Sesión del sistema (system-session.js) ──
    const { updateMediaSession, updatePositionState } = createSesionSistema({
        audio, resume, pause, prev, next, updatePlayPauseBtn,
    });
    let lastPositionUpdate = 0;

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
            showStatus(i18n.t('lib_audio_missing', { title: song.title || '—' }), 'error');
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
        LibraryModule.setPlaying(song.src);

        // Wrap in try-catch: metadata errors must NEVER kill audio playback
        try {
            updateMediaSession(song);
        } catch (e) {
            console.error('[Player] updateMediaSession error (non-fatal):', e);
        }

        // 🟢 Trigger lyrics fetch for the new song
        try {
            await LyricsModule.onTrackChange(song.title, song.channel);
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

    // El estado que ve el sistema lo anuncian los eventos 'play' y 'pause' del
    // audio, no estas funciones: así también cuadra cuando pausa el sistema
    function pause() {
        audio.pause();
        updatePlayPauseBtn(false);
    }

    function resume() {
        audio.play().catch(e => console.warn(e));
        updatePlayPauseBtn(true);
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
        // Visible desde cualquier vista: el mensaje de estado solo se ve en Inicio
        avisar(i18n.t('queue_next'));

        // Refresh UI if the queue panel is open
        renderQueuePanel();
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

    // ── Barras que engordan al agarrarlas (plan 09, T10) ──
    // La pista gruesa es el tirador, como en Apple Music. Se suelta en
    // cualquier punto de la ventana, no solo encima de la barra.
    for (const barra of [fullPlayerSeek, playerVolume, fullPlayerVolume]) {
        const pista = barra?.parentElement;
        if (!pista) continue;
        pista.classList.add('grip-track');
        barra.addEventListener('pointerdown', () => {
            pista.classList.add('is-scrubbing');
            const soltar = () => {
                pista.classList.remove('is-scrubbing');
                globalThis.removeEventListener('pointerup', soltar);
                globalThis.removeEventListener('pointercancel', soltar);
            };
            globalThis.addEventListener('pointerup', soltar);
            globalThis.addEventListener('pointercancel', soltar);
        });
    }

    // ── La carátula respira (plan 09, T9) ──
    // Crece con rebote al reproducir y encoge al pausar. Se escucha al propio
    // <audio>, así que también reacciona a la pantalla de bloqueo.
    const ESCALA_PAUSA = 0.82;
    const muelleCaratula = new Spring({
        value: 1, preset: 'bouncy', precision: 0.0005,
        onUpdate: (v) => {
            if (!fullPlayerThumb) return;
            fullPlayerThumb.style.setProperty('--art-scale', String(v));
            fullPlayerThumb.style.setProperty('--art-shadow', String(Math.max(0, Math.min(1, (v - ESCALA_PAUSA) / (1 - ESCALA_PAUSA)))));
        },
    });
    function respirar(sonando) {
        // Con «Reducir movimiento» la carátula no cambia de tamaño
        if (prefersReducedMotion()) { muelleCaratula.jump(1); return; }
        muelleCaratula.to(sonando ? 1 : ESCALA_PAUSA, { preset: sonando ? 'bouncy' : 'smooth' });
    }

    // Lo que suena, tal y como lo ve el sistema (pantalla de bloqueo,
    // notificación, islas). Viene de los eventos del propio audio, que también
    // saltan cuando pausa el sistema: una llamada, otra app que reproduce o
    // unos auriculares desconectados. Primero la posición: el plugin nativo
    // la reutiliza al cambiar de estado, y sin ella el progreso volvía al
    // principio al pausar.
    function anunciarEstado(estado) {
        updatePositionState();
        NativeMediaSession.setPlaybackState(estado);
    }

    addOptionalEventListener(audio, 'play', () => {
        anunciarEstado('playing');
        respirar(true);
    });

    addOptionalEventListener(audio, 'pause', () => {
        anunciarEstado('paused');
        respirar(false);
    });

    addOptionalEventListener(audio, 'seeked', () => updatePositionState());
    addOptionalEventListener(audio, 'ratechange', () => updatePositionState());

    addOptionalEventListener(playerPlay, 'click', (e) => { e.stopPropagation(); avisarHaptico('light'); togglePlay(); });
    addOptionalEventListener(playerPrev, 'click', (e) => { e.stopPropagation(); prev(); });
    addOptionalEventListener(playerNext, 'click', (e) => { e.stopPropagation(); next(); });
    addOptionalEventListener(playerShuffle, 'click', (e) => { e.stopPropagation(); toggleShuffle(); });
    addOptionalEventListener(playerRepeat, 'click', (e) => { e.stopPropagation(); toggleRepeat(); });

    addOptionalEventListener(playerBarFav, 'click', (e) => {
        e.stopPropagation();
        const q = getCurrentQueue();
        const currentSong = q[currentIndex];
        if (currentSong) {
            FavoritesModule.toggleFavorite(currentSong, playerBarFav).then(() => {
                updateFavBtn();
            });
        }
    });

    // Full Player listeners
    addOptionalEventListener(fullPlayerPlay, 'click', () => { avisarHaptico('light'); togglePlay(); });
    addOptionalEventListener(fullPlayerPrev, 'click', prev);
    addOptionalEventListener(fullPlayerNext, 'click', next);
    addOptionalEventListener(fullPlayerShuffle, 'click', toggleShuffle);
    addOptionalEventListener(fullPlayerRepeat, 'click', toggleRepeat);
    addOptionalEventListener(fullPlayerClose, 'click', hideFullPlayer);

    // Footer actions - Delegate to LyricsModule toggle
    addOptionalEventListener(fullPlayerLyrics, 'click', () => {
        document.getElementById('lyricsToggle')?.click();
    });

    // ── Hoja de la cola (queue-sheet.js) ──
    const { renderQueuePanel, openQueuePanel, closeQueuePanel } = createQueueSheet({
        cola: getCurrentQueue,
        siguientes: () => nextQueue,
        indice: () => currentIndex,
        fijarIndice: (i) => { currentIndex = i; },
        aleatorio: () => isShuffled,
        repeticion: () => repeatMode,
        play, toggleShuffle, toggleRepeat,
    });

    if (fullPlayerFav) {
        fullPlayerFav.addEventListener('click', (e) => {
            e.stopPropagation();
            const q = getCurrentQueue();
            const currentSong = q[currentIndex];
            if (currentSong) {
                FavoritesModule.toggleFavorite(currentSong, fullPlayerFav).then(() => {
                    updateFavBtn();
                });
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

    initBarras(audio);

    NavigationModule.registrarReproductor({ hideFullPlayer, closeQueuePanel });

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

/** Tocar la carátula o el título del mini reproductor abre la pantalla completa. */
export function enlazarMiniReproductor() {
    const fullPlayer = document.getElementById('fullPlayer');

    // Open full player when clicking mini player info/thumb
    const playerInfo = document.getElementById('playerInfo');
    const playerThumb = document.getElementById('playerThumb');

    if (playerInfo && fullPlayer) {
        playerInfo.addEventListener('click', () => {
            if (typeof PlayerModule.showFullPlayer === 'function') {
                PlayerModule.showFullPlayer();
            } else {
                fullPlayer.classList.remove('fp-hidden');
            }
        });
    }
    if (playerThumb && fullPlayer) {
        playerThumb.addEventListener('click', () => {
            if (typeof PlayerModule.showFullPlayer === 'function') {
                PlayerModule.showFullPlayer();
            } else {
                fullPlayer.classList.remove('fp-hidden');
            }
        });
    }
}
