/**
 * Escuchar antes una canción (búsqueda, selección de YouTube, recomendadas).
 *
 * Primero, con el reproductor incrustado de YouTube: suena al instante y no
 * gasta descargas. Si YouTube no deja incrustarlo (errores 101 y 150, casi todos
 * los vídeos oficiales) o su API no carga, se baja en silencio a la caché de la
 * radio y suena desde ahí (escucha-cache.js, plan 24): tarda unos segundos, pero
 * después añadirla es instantáneo.
 *
 * La API del reproductor se carga la primera vez que hace falta (plan 19): se
 * precarga en reposo al aparecer resultados y, si se toca antes de que esté,
 * la vista previa empieza sola en cuanto lo está.
 *
 * Quien pinta botones que se repintan se apunta con `alCambiarEscucha` y marca
 * por `videoId`: { videoId, estado: 'cargando' | 'sonando' | 'parada' }.
 */

import { i18n } from '../i18n/language-manager.js';
import { showStatus } from '../ui/status.js';
import { PlayerModule } from './player/player.js';
import { PRIORIDAD, tarea } from '../ui/tareas.js';

// ========================================
// Audio Preview (YouTube IFrame API)
// ========================================
let ytPlayer = null;

let ytPlayerReady = false;

/** La que se escucha: { videoId, boton, cancion, via: 'youtube' | 'cache', audio, estado } */
let actual = null;

// La carga de la API (una sola vez; se reintenta si falló) y lo que se pidió antes de tenerla
let carga = null;
let alEstarListo = null;

const oyentes = new Set();

/** Avisa de cada cambio: { videoId, estado }. Devuelve cómo dejar de escuchar. */
export function alCambiarEscucha(fn) {
    oyentes.add(fn);
    return () => oyentes.delete(fn);
}

function ponerEstado(estado) {
    if (!actual) return;
    actual.estado = estado;
    updatePlayingUI(actual.boton, estado);
    for (const fn of oyentes) fn({ videoId: actual.videoId, estado });
}

/** Carga la API de YouTube y crea el reproductor. Promete que está listo. */
export function prepararVistaPrevia() {
    carga ??= new Promise((ok, ko) => {
        alEstarListo = ok;
        window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => {
            script.remove();
            carga = null;
            ko(new Error('No se pudo cargar la API de YouTube'));
        };
        document.head.append(script);
    });
    return carga;
}

/** Al aparecer resultados: la API, en reposo, para que el primer toque no espere. */
export function precargarVistaPrevia() {
    tarea(prepararVistaPrevia, { prioridad: PRIORIDAD.baja }).catch(() => { /* se intentará al tocar */ });
}

// Called automatically by YouTube IFrame API when ready
export function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API loaded, creating player...');
    ytPlayer = new globalThis.YT.Player('youtubePlayer', {
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

function onPlayerReady() {
    ytPlayerReady = true;
    alEstarListo?.();
    // Lo que se tocó mientras cargaba empieza ahora
    if (actual?.via === 'youtube' && actual.estado === 'cargando') porYoutube();
}

function onPlayerError(event) {
    console.warn('YouTube Player error:', event.data);
    // Error codes: https://developers.google.com/youtube/iframe_api_reference#onError
    // 101 y 150: el dueño no deja incrustarlo. Se escucha por la caché
    if ((event.data === 150 || event.data === 101) && actual?.via === 'youtube') {
        porLaCache();
        return;
    }
    showStatus(i18n.t(event.data === 100 ? 'preview_error_not_found' : 'preview_error_generic'), 'error');
    stopPreview();
}

function onPlayerStateChange(event) {
    if (actual?.via !== 'youtube') return;
    // YT.PlayerState: 1 sonando, 0 terminada
    if (event.data === 1) ponerEstado('sonando');
    else if (event.data === 0) stopPreview();
}

/** Lo que suena en el reproductor de la app se pausa: no se pisan. */
function pausarReproductor() {
    const principal = document.getElementById('mainAudio');
    if (principal && !principal.paused) PlayerModule.pause();
}

function porYoutube() {
    if (!ytPlayerReady || !ytPlayer?.loadVideoById) {
        prepararVistaPrevia().catch(() => porLaCache());
        return;
    }
    pausarReproductor();
    ytPlayer.loadVideoById(actual.videoId);
    ytPlayer.unMute();
    ytPlayer.setVolume(100);
    ytPlayer.playVideo();
    // Sonando ya: si YouTube no la deja, su error la pasa a la caché
    ponerEstado('sonando');
}

async function porLaCache() {
    const yo = actual;
    if (!yo) return;
    try { ytPlayer?.stopVideo?.(); } catch { /* sin reproductor */ }
    yo.via = 'cache';
    ponerEstado('cargando');
    try {
        const { audioParaEscuchar } = await import('./escucha-cache.js');
        const src = await audioParaEscuchar(yo.cancion);
        if (actual !== yo) return;
        if (!src) throw new Error('Sin audio');
        pausarReproductor();
        yo.audio = new Audio(src);
        yo.audio.onended = () => { if (actual === yo) stopPreview(); };
        await yo.audio.play();
        if (actual !== yo) { yo.audio.pause(); return; }
        ponerEstado('sonando');
    } catch (e) {
        if (actual !== yo) return;
        console.warn('[Escuchar antes] Tampoco por la caché:', e);
        showStatus(e?.code && e.message ? e.message : i18n.t('preview_error_restricted'), 'error');
        stopPreview();
    }
}

/**
 * Escucha antes la canción, o la para si ya sonaba. `cancion` (título, canal,
 * carátula y duración) hace falta si hay que bajarla a la caché.
 */
export function togglePreview(videoId, boton, cancion = {}) {
    if (!videoId) return;
    if (actual?.videoId === videoId) {
        stopPreview();
        return;
    }
    stopPreview();
    actual = { videoId, boton, cancion: { ...cancion, videoId }, via: 'youtube', audio: null, estado: null };
    ponerEstado('cargando');
    porYoutube();
}

/** Lo mismo, con la canción: { videoId, title, channel, thumbnail, duration }. */
export const escucharAntes = (cancion, boton) => togglePreview(cancion?.videoId, boton, cancion);

export function stopPreview() {
    const antes = actual;
    if (!antes) return;
    ponerEstado('parada');
    actual = null;
    if (antes.via === 'youtube') {
        try { ytPlayer?.stopVideo?.(); } catch { /* sin reproductor */ }
    } else if (antes.audio) {
        antes.audio.pause();
        antes.audio.removeAttribute('src');
    }
}

// Si empieza a sonar el reproductor de la app, la escucha previa se calla
document.getElementById('mainAudio')?.addEventListener('play', () => stopPreview());

function updatePlayingUI(boton, estado) {
    if (!boton) return;
    const sonando = estado === 'sonando';
    boton.classList.toggle('playing', sonando);
    boton.classList.toggle('cargando', estado === 'cargando');
    boton.setAttribute('aria-busy', String(estado === 'cargando'));
    const musicIcon = boton.querySelector('.music-icon');
    const pauseIcon = boton.querySelector('.pause-icon');
    if (musicIcon) musicIcon.style.display = sonando ? 'none' : 'block';
    if (pauseIcon) pauseIcon.style.display = sonando ? 'block' : 'none';
}
