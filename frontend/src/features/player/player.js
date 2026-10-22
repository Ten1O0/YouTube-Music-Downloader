/**
 * Reproductor: cola, reproducción, barra inferior y pantalla completa.
 */

import { crearRegistroEscuchas } from './listens.js';
import { gananciaSonoridad } from '../../core/loudness.js';
import { nombreDe } from '../../core/titles.js';
import { resolveNativeThumbnail, resolveStreamSrc } from '../../core/audio-store.js';
import { addOptionalEventListener, extractVideoId } from '../../core/utils.js';
import { i18n } from '../../i18n/language-manager.js';
import { NativeMediaSession } from '../../native/media-session.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { avisar } from '../../ui/toast.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { LyricsModule } from '../lyrics.js';
import { conectarRadio, consumir, esperarRadio, proximaDeRadio, radioActiva, revisarRadio, saltadaEnRadio, terminadaEnRadio, tomar } from '../radio/puente.js';
import { initBarras } from './controls.js';
import { createEngine } from './engine.js';
import { createFullPlayer } from './full-player.js';
import { createQueueSheet } from './queue-sheet.js';
import { ajustesReproduccion, alCambiarAjustes } from './settings.js';
import { createSesionSistema } from './system-session.js';
import { createTransiciones } from './transitions.js';
import { barajar, crearAvance, formatTime, pintarNombre, pintarPlayPause, ponerTexto, syncRepeatButtonState, toggleHeartButtonState, updatePlayerUI } from './ui.js';

let isTransitioning = false; // Prevents rapid clicks (400ms debounce)

// ========================================
// PlayerModule — MP3 Reproductor completo
// ========================================
export const PlayerModule = (() => {
    // Dos <audio> que se turnan (plan 12): `audio` habla siempre con el que suena
    const engine = createEngine({ a: document.getElementById('mainAudio'), b: document.getElementById('deckAudio') });
    const audio = engine.audio;
    // Escuchas: el contador de cada canción y el registro para «Tu año en música» (plan 11, T5)
    const escuchas = crearRegistroEscuchas(audio);
    const playerBar = document.getElementById('playerBar');
    const playerPlay = document.getElementById('playerPlay');
    const playerPrev = document.getElementById('playerPrev');
    const playerNext = document.getElementById('playerNext');
    const playerShuffle = document.getElementById('playerShuffle');
    const playerRepeat = document.getElementById('playerRepeat');
    const playerDuration = document.getElementById('playerDuration');
    const playerBarFav = document.getElementById('playerBarFav');

    // Selectores Full-Screen Player
    const fullPlayer = document.getElementById('fullPlayer');
    const fullPlayerClose = document.getElementById('fullPlayerClose');
    const fullPlayerPlay = document.getElementById('fullPlayerPlay');
    const fullPlayerPrev = document.getElementById('fullPlayerPrev');
    const fullPlayerNext = document.getElementById('fullPlayerNext');
    const fullPlayerShuffle = document.getElementById('fullPlayerShuffle');
    const fullPlayerRepeat = document.getElementById('fullPlayerRepeat');
    const fullPlayerDuration = document.getElementById('fullPlayerDuration');
    const fullPlayerFav = document.getElementById('fullPlayerFav');
    const fullPlayerLyrics = document.getElementById('fullPlayerLyrics');

    let queue = [];
    let nextQueue = []; // Spotify-style play next
    let currentIndex = 0;
    let isShuffled = false;
    let shuffledQueue = [];
    let repeatMode = 0; // 0=off, 1=all, 2=one

    // La barra y los tiempos, solo lo que se ve (plan 19, T13), y la letra al compás
    const updateSeekBar = crearAvance({ audio, fullPlayer, alTiempo: (t) => LyricsModule.updateActiveLine?.(t) });

    // ── Pantalla completa (full-player.js) ──
    const { showFullPlayer, hideFullPlayer, respirar } = createFullPlayer({
        cancionActual: () => getCurrentQueue()[currentIndex],
        engine,
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

    const updatePlayPauseBtn = (playing) => pintarPlayPause([playerPlay, fullPlayerPlay], playing);

    // ── Sesión del sistema (system-session.js) ──
    const { updateMediaSession, updatePositionState, revisarPosicion } = createSesionSistema({
        audio, resume, pause, prev, next, updatePlayPauseBtn,
    });

    function getCurrentQueue() {
        return isShuffled ? shuffledQueue : queue;
    }

    // ── Paso de una canción a otra: sin cortes o con fundido (plan 12, T3) ──
    const gananciaDe = (song) => (ajustesReproduccion().igualar ? gananciaSonoridad(song?.loudness) : 1);

    /** La que sonará al acabar esta, sin moverse de la actual. */
    function siguienteNatural() {
        if (nextQueue.length > 0) return nextQueue[0];
        const q = getCurrentQueue();
        if (!q.length) return null;
        if (currentIndex >= q.length - 1 && repeatMode !== 1) return proximaDeRadio();
        return q[(currentIndex + 1) % q.length];
    }

    const transiciones = createTransiciones({
        engine,
        fundido: () => ajustesReproduccion().fundido,
        repetirUna: () => repeatMode === 2,
        siguiente: siguienteNatural,
        resolver: resolveStreamSrc,
        ganancia: gananciaDe,
        alPasar: (song) => {
            if (nextQueue[0]?.src === song.src) nextQueue.shift();
            else {
                const i = getCurrentQueue().findIndex(s => s.src === song.src);
                if (i !== -1) currentIndex = i;
                else entrarDeRadio(song);
            }
            escuchas.nueva(song);
            mostrar(song);
            renderQueuePanel();
        },
    });
    alCambiarAjustes(() => {
        transiciones.replanificar();
        engine.mezclar(engine.actual(), { ganancia: gananciaDe(getCurrentQueue()[currentIndex]) });
    });

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

        transiciones.replanificar();
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

    // Una canción en la nube (plan 13) no tiene audio aquí: se pide su descarga
    let alPedirNube = null;

    async function play(song, queueList, startIndex) {
        if (!song?.src) return;
        if (song.nube) { alPedirNube?.(song); return; }
        // La cola no entra en las que están en la nube: nada se descarga solo
        if (queueList?.some(s => s?.nube)) {
            queueList = queueList.filter(s => !s?.nube);
            startIndex = Math.max(0, queueList.findIndex(s => s.src === song.src));
        }

        if (queueList) {
            const isSameQueue = queue.length === queueList.length && queue.every((s, i) => s.src === queueList[i].src);
            queue = queueList;
            // Una cola nueva: Listas apunta de qué lista sale para resaltarla (plan 25)
            document.dispatchEvent(new CustomEvent('cola-nueva'));
            currentIndex = startIndex ?? 0;

            if (isShuffled) {
                // Solo re-mezclamos si la lista base ha cambiado de verdad (nueva canción o playlist distinta)
                if (!isSameQueue || shuffledQueue.length === 0) shuffledQueue = barajar(queue);
                currentIndex = shuffledQueue.findIndex(s => s.src === song.src);
                if (currentIndex === -1) currentIndex = 0;
            }
        }

        const finalSrc = await resolveStreamSrc(song);

        // Sin fuente reproducible no se asigna nada: se avisa al usuario en vez
        // de dejar el fallo enterrado en el .catch() de audio.play().
        if (!finalSrc) {
            isTransitioning = false;
            showStatus(i18n.t('lib_audio_missing', { title: nombreDe(song).titulo }), 'error');
            return;
        }

        transiciones.olvidar();
        engine.mezclar(engine.actual(), { ganancia: gananciaDe(song) });
        audio.src = finalSrc;
        escuchas.nueva(song);
        audio.load();
        audio.play().catch(e => {
            console.warn('Audio play error:', e);
            isTransitioning = false;
        });
        await mostrar(song);
    }

    /** Lo que cambia con cada canción: barras, pantalla completa, sistema y letras. */
    async function mostrar(song) {
        avisarRadio(song);
        if (!document.getElementById('playbackQueueSheet')?.classList.contains('hidden')) renderQueuePanel();
        // Resolve Local Offline Thumbnail
        const { finalThumb, runtimeThumbnailNative } = await resolveNativeThumbnail(song);
        song._runtimeThumbnailNative = runtimeThumbnailNative;
        // La que se pinta, también la generada si no tiene carátula (plan 27): la usa la pantalla de bloqueo
        song._caratulaPintada = finalThumb;

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
            await LyricsModule.onTrackChange(song, () => audio.duration);
        } catch (e) {
            console.warn('[Player] Lyrics fetch error (non-fatal):', e);
        }
    }

    function updateFavBtn() {
        if (!playerBarFav) return;
        const q = getCurrentQueue();
        const currentSong = q[currentIndex];
        if (currentSong) {
            const videoId = currentSong.videoId || currentSong.id || extractVideoId(currentSong.src);
            if (!videoId) return;

            playerBarFav.dataset.id = videoId;
            if (fullPlayerFav) fullPlayerFav.dataset.id = videoId;

            const isFav = FavoritesModule.isFavorite(videoId);

            // Sync all favorite hearts cleanly using the helper
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

    function next(motivo) {
        if (isTransitioning) return;
        // Pasar a mano a la siguiente es un salto (la radio crece si se salta deprisa)
        if (motivo !== 'fin') saltadaEnRadio(getCurrentQueue()[currentIndex], audio.currentTime);

        // Priority sequence: manually added songs go first
        if (nextQueue.length > 0) {
            const song = nextQueue.shift();
            play(song);
            return;
        }

        const q = getCurrentQueue();
        if (!q.length) return;
        if (currentIndex >= q.length - 1 && repeatMode !== 1) { siguienteDeRadio(); return; }

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
        transiciones.replanificar();
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
        if (currentIndex === 0 && repeatMode !== 1) { audio.currentTime = 0; return; }
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
            shuffledQueue = barajar(queue);
            if (currentSong) currentIndex = shuffledQueue.findIndex(s => s.src === currentSong.src);
        } else if (currentSong) {
            currentIndex = queue.findIndex(s => s.src === currentSong.src);
        }

        if (currentIndex === -1) currentIndex = 0;
        transiciones.replanificar();
        showStatus(i18n.t(isShuffled ? 'shuffle_on' : 'shuffle_off'), 'info');
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

        transiciones.replanificar();
        const repeatMsgMap = ['repeat_off', 'repeat_all', 'repeat_one'];
        showStatus(i18n.t(repeatMsgMap[repeatMode] || 'repeat_off'), 'info');
        setTimeout(() => { isTransitioning = false; }, 400);
    }
    // ── Modo radio (plan 16): al acabar la cola, sigue con canciones parecidas ──
    const restantes = () => getCurrentQueue().length - 1 - currentIndex + nextQueue.length;
    function avisarRadio(song = getCurrentQueue()[currentIndex]) {
        if (song) revisarRadio({ restantes: restantes(), actual: song, repetir: repeatMode === 1 });
    }
    /** Una de la radio entra al final de la cola y pasa a ser la actual. */
    function entrarDeRadio(song) {
        consumir(song);
        queue.push(song);
        if (isShuffled) shuffledQueue.push(song);
        currentIndex = getCurrentQueue().length - 1;
    }
    /** Al acabar la cola: la siguiente de la radio que esté lista, o esperar a que llegue. */
    function siguienteDeRadio() {
        if (!radioActiva() || repeatMode === 1) return false;
        const s = tomar();
        if (!s) return esperarRadio(getCurrentQueue()[currentIndex]);
        entrarDeRadio(s);
        play(s);
        return true;
    }

    function setQueue(songs, startIndex = 0) {
        queue = songs;
        currentIndex = startIndex;
        if (isShuffled) {
            shuffledQueue = [...songs].sort(() => Math.random() - 0.5);
        }
        transiciones.replanificar();
    }
    // Event Listeners
    // Un solo latido (plan 19, T13): la barra y la letra, solo si se ven; la
    // sesión del sistema, solo si se ha desviado (T15)
    addOptionalEventListener(audio, 'timeupdate', () => {
        updateSeekBar();
        revisarPosicion();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') updateSeekBar();
    });

    addOptionalEventListener(audio, 'loadedmetadata', () => {
        if (playerDuration) playerDuration.textContent = formatTime(audio.duration);
        ponerTexto(fullPlayerDuration, formatTime(audio.duration));
        updatePositionState();
    });

    addOptionalEventListener(audio, 'ended', () => {
        updatePlayPauseBtn(false);
        terminadaEnRadio(getCurrentQueue()[currentIndex]);
        if (repeatMode === 2) {
            // Repeat one
            audio.currentTime = 0;
            audio.play();
            updatePlayPauseBtn(true);
        } else {
            const q = getCurrentQueue();
            const isLast = currentIndex >= q.length - 1;
            if (!isLast || repeatMode === 1) {
                if (!isTransitioning) next('fin');
            } else if (!siguienteDeRadio()) {
                hideBar();
            }
        }
    });

    // ── La carátula respira (plan 09, T9) ──
    // Crece con rebote al reproducir y encoge al pausar. Se escucha al propio
    // <audio>, así que también reacciona a la pantalla de bloqueo.
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

    addOptionalEventListener(playerPlay, 'click', (e) => { e.stopPropagation(); togglePlay(); });
    addOptionalEventListener(playerPrev, 'click', (e) => { e.stopPropagation(); prev(); });
    addOptionalEventListener(playerNext, 'click', (e) => { e.stopPropagation(); next(); });
    addOptionalEventListener(playerShuffle, 'click', (e) => { e.stopPropagation(); toggleShuffle(); });
    addOptionalEventListener(playerRepeat, 'click', (e) => { e.stopPropagation(); toggleRepeat(); });

    addOptionalEventListener(playerBarFav, 'click', (e) => {
        e.stopPropagation();
        alternarFavoritoActual(playerBarFav);
    });

    // Full Player listeners
    addOptionalEventListener(fullPlayerPlay, 'click', () => { togglePlay(); });
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
            alternarFavoritoActual();
        });
    }

    /** Favorito de lo que suena: el corazón de la pantalla completa y la tecla L. */
    function alternarFavoritoActual(boton = fullPlayerFav) {
        const currentSong = getCurrentQueue()[currentIndex];
        if (!currentSong) return;
        FavoritesModule.toggleFavorite(currentSong, boton).then(() => {
            updateFavBtn();
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

    const barras = initBarras(audio);

    NavigationModule.registrarReproductor({ hideFullPlayer, closeQueuePanel });

    /** Las copias en la cola y, si es la que suena, la barra, la pantalla completa y el sistema. */
    function actualizarCancion(src, nueva) {
        for (const lista of [queue, shuffledQueue, nextQueue]) {
            lista.forEach((s, i) => { if (s?.src === src) lista[i] = { ...s, ...nueva }; });
        }
        const actual = getCurrentQueue()[currentIndex];
        // Comparando también con el nuevo: al guardar una de la radio, su src cambia
        if (actual && (actual.src === src || actual.src === nueva?.src)) {
            pintarNombre(actual);
            updateMediaSession(actual);
            // Con otro artista o título, otra letra (plan 22, T4)
            LyricsModule.onTrackChange(actual, () => audio.duration).catch(() => {});
        }
        renderQueuePanel();
    }

    conectarRadio({
        reproducir: (s) => { if (s) { entrarDeRadio(s); play(s); } },
        saltar: () => next(),
        actual: () => getCurrentQueue()[currentIndex] ?? null,
        actualizarCancion,
        revisar: () => avisarRadio(),
        soloEsta: () => setQueue([getCurrentQueue()[currentIndex]].filter(Boolean), 0),
    });

    return {
        play, pause, resume, togglePlay, next, prev, setQueue, showBar, hideBar, removeSongFromQueue,
        toggleShuffle, toggleRepeat, addToNextQueue, showFullPlayer, hideFullPlayer, updateFavBtn,
        isShuffled: () => isShuffled,
        getRepeatMode: () => repeatMode,
        getQueueState: () => ({ queue: getCurrentQueue(), nextQueue, currentIndex }),
        renderQueuePanel, openQueuePanel, closeQueuePanel,
        seekTo: (time) => { if (audio) { audio.currentTime = time; } },
        // Atajos de teclado (plan 10, T4)
        seekBy: (segundos) => {
            if (!audio?.duration) return;
            audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + segundos));
        },
        hayCancion: () => Boolean(getCurrentQueue()[currentIndex]),
        pantallaCompletaAbierta: () => Boolean(fullPlayer && !fullPlayer.classList.contains('fp-hidden')),
        alternarFavoritoActual: () => alternarFavoritoActual(),
        cancionActual: () => getCurrentQueue()[currentIndex] ?? null,
        // Tras editar artista y canción (plan 11, T4): las copias en la cola y,
        // si es la que suena, lo que ven la barra, la pantalla completa y el sistema
        actualizarCancion,
        configurarNube: (fn) => { alPedirNube = fn; },
        cambiarVolumen: (delta) => barras.cambiarVolumen(delta),
        alternarSilencio: () => barras.alternarSilencio(),
    };
})();
