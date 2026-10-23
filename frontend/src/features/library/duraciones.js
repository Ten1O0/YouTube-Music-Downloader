/**
 * La duración de lo que se descargó antes del plan 22 (plan 23).
 *
 * Hasta el plan 22 la app no guardaba la duración de las canciones, así que la
 * cabecera de una lista decía «5 canciones» sin cuánto duran. Se rellena de su
 * propio audio: solo los metadatos, sin decodificarlo, una canción cada vez y
 * con el navegador desocupado, como la sonoridad (player/loudness-backfill.js).
 * Y cuando suena una canción sin duración, se guarda la del reproductor.
 *
 * Se guarda en la biblioteca y en las copias de las listas, que no se ponen al
 * día solas: sin cuenta no hay sincronización que las iguale.
 */

import { isNative } from '../../config/env.js';
import { IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { segundosDe } from '../../core/duracion.js';
import { StorageModule } from '../../core/storage.js';
import { esperarTurno, PRIORIDAD } from '../../ui/tareas.js';
import { queueManager } from '../download/queue.js';
import { PlayerModule } from '../player/player.js';
import { textoDeLista } from '../playlists/orden.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { LibraryModule } from './library.js';

const CLAVE_FALLOS = 'ytdl_duracion_fallos';
/** Un fichero que no da su duración se deja tras dos intentos. */
export const MAX_INTENTOS_DURACION = 2;
/** Entre canción y canción: cada una guarda la biblioteca y las listas enteras. */
const PAUSA = 4_000;
const ESPERA_SIN_TRABAJO = 5 * 60_000;
const TIEMPO_MAXIMO = 15_000;

/** La primera canción del dispositivo sin duración, o null. Pura. */
export function siguienteSinDuracion(biblioteca, fallos = {}) {
    return (biblioteca ?? []).find((s) => s?.src && !segundosDe(s) && !s.nube && !s.unavailable
        && (fallos?.[s.src] ?? 0) < MAX_INTENTOS_DURACION) ?? null;
}

/** Segundos enteros de lo que dice un <audio>, o null si no es una duración. Pura. */
export function segundosDeAudio(duracion) {
    return Number.isFinite(duracion) && duracion > 0 ? Math.max(1, Math.round(duracion)) : null;
}

/**
 * Las canciones con ese `src` reciben la duración, en la biblioteca o en las
 * listas, si no la tenían. Devuelve cuántas ha tocado. Cambia las canciones.
 */
export function ponerDuracion(canciones, src, segundos) {
    let tocadas = 0;
    for (const s of canciones ?? []) {
        if (s?.src === src && !segundosDe(s)) { s.duration = segundos; tocadas++; }
    }
    return tocadas;
}

/** Dónde se puede leer el audio de la canción, y cómo soltarlo después. null si no está en el dispositivo. */
async function urlDelAudio(song) {
    if (song.src.startsWith(IDB_SRC_PREFIX)) {
        const blob = await StorageModule.getBlob(song.src.slice(IDB_SRC_PREFIX.length));
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        return { url, soltar: () => URL.revokeObjectURL(url) };
    }
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (isNative() && fs && song.localPath) {
        const directory = song.localPath.startsWith('imported_') ? 'DATA' : 'DOCUMENTS';
        const { uri } = await fs.getUri({ path: song.localPath, directory });
        return { url: globalThis.Capacitor.convertFileSrc(uri), soltar: () => {} };
    }
    // En el servidor o en una URL: ya la dirá el reproductor cuando suene
    return null;
}

/** La duración del fichero, leyendo solo sus metadatos. */
function leerMetadatos(url) {
    return new Promise((ok) => {
        const audio = new Audio();
        const terminar = (segundos) => {
            clearTimeout(reloj);
            audio.onloadedmetadata = audio.onerror = null;
            audio.removeAttribute('src');
            audio.load();
            ok(segundos);
        };
        const reloj = setTimeout(() => terminar(null), TIEMPO_MAXIMO);
        audio.preload = 'metadata';
        audio.muted = true;
        audio.onloadedmetadata = () => terminar(segundosDeAudio(audio.duration));
        audio.onerror = () => terminar(null);
        audio.src = url;
    });
}

async function medir(song) {
    const audio = await urlDelAudio(song);
    if (!audio) return null;
    try {
        return await leerMetadatos(audio.url);
    } finally {
        audio.soltar();
    }
}

/** Guarda la duración en la biblioteca y en las listas, y repinta la cabecera de la lista abierta. */
export async function guardarDuracion(src, segundos) {
    if (!src || !segundos) return;
    const biblioteca = await LibraryModule.getLibrary();
    if (ponerDuracion(biblioteca, src, segundos)) await LibraryModule.saveLibrary(biblioteca);

    const listas = await getPlaylists();
    if (!ponerDuracion(listas.flatMap((pl) => pl.songs ?? []), src, segundos)) return;
    await savePlaylists(listas);
    const abierta = listas.find((pl) => pl.id === PlaylistModule.currentPlaylistId);
    const cabecera = document.getElementById('playlistDetailCount');
    if (abierta && cabecera && abierta.songs.some((s) => s.src === src)) cabecera.textContent = textoDeLista(abierta.songs);
}

async function puedeTrabajar() {
    return document.visibilityState === 'visible' && !queueManager.hayActivas();
}

let temporizador = null;

function programar(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => esperarTurno(PRIORIDAD.baja).then(turno), ms);
}

async function turno() {
    if (!(await puedeTrabajar())) return programar(30_000);
    const [biblioteca, fallos] = await Promise.all([LibraryModule.getLibrary(), StorageModule.get(CLAVE_FALLOS).catch(() => null)]);
    const song = siguienteSinDuracion(biblioteca, fallos || {});
    if (!song) return programar(ESPERA_SIN_TRABAJO);

    let segundos = null;
    try {
        segundos = await medir(song);
    } catch (e) {
        console.debug('[Duración] No se pudo leer', song.title, e);
    }
    if (segundos) {
        await guardarDuracion(song.src, segundos);
    } else {
        const f = fallos || {};
        f[song.src] = (f[song.src] ?? 0) + 1;
        await StorageModule.set(CLAVE_FALLOS, f).catch(() => {});
    }
    programar(PAUSA);
}

/** Arranca el relleno en segundo plano y guarda la duración de lo que suene sin ella. */
export function iniciarRellenoDuraciones() {
    document.getElementById('mainAudio')?.addEventListener('loadedmetadata', (e) => {
        const song = PlayerModule.cancionActual();
        const segundos = segundosDeAudio(e.target.duration);
        if (song?.src && !song.nube && !segundosDe(song) && segundos) {
            song.duration = segundos;
            guardarDuracion(song.src, segundos).catch((err) => console.debug('[Duración]', err));
        }
    });
    programar(20_000);
}
