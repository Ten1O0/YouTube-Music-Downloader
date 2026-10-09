/**
 * La caché de la radio, lo que se puede probar sin navegador (plan 16, §2.4):
 * qué sobra al pasar el tope y cómo es la canción de radio para la cola.
 */

import { medidaSonoridad } from '../../core/loudness.js';
import { completarMetadatos } from '../../core/titles.js';

export const TOPE_CANCIONES = 10;
export const TOPE_BYTES = 150 * 1024 * 1024;
/** Prefijo de la clave del audio en IndexedDB. */
export const PREFIJO = 'radio:';
/** El mismo que IDB_SRC_PREFIX de core/audio-store.js (un test lo vigila). */
const IDB = 'idb://';

/**
 * Qué entradas sobran para volver al tope, de la más antigua a la más nueva.
 * Las ya guardadas en la biblioteca salen primero (su audio ya está allí), y
 * las protegidas (la que suena) nunca. Pura, para poder probarla.
 */
export function sobrantes(entradas, { tope = TOPE_CANCIONES, topeBytes = TOPE_BYTES, proteger = new Set() } = {}) {
    const libres = entradas.filter((e) => !proteger.has(e.videoId));
    const fuera = libres.filter((e) => e.guardada);
    const vivas = entradas.filter((e) => !e.guardada);
    let n = vivas.length;
    let bytes = vivas.reduce((s, e) => s + (e.bytes || 0), 0);
    for (const e of libres.filter((x) => !x.guardada).sort((a, b) => a.en - b.en)) {
        if (n <= tope && bytes <= topeBytes) break;
        fuera.push(e);
        n--;
        bytes -= e.bytes || 0;
    }
    return fuera;
}

/**
 * La canción de la radio, lista para la cola del reproductor. Con artista y
 * canción separados, como la biblioteca (plan 22, T1): si YouTube no los da,
 * salen del título. Si no, el artista se repetía en el título, y era lo que
 * se buscaba en las letras.
 */
export function cancionDeRadio(entrada) {
    const { videoInfo = {}, finalProgressData = {} } = entrada.meta ?? {};
    const cancion = {
        src: `${IDB}${PREFIJO}${entrada.videoId}`,
        ...(entrada.ruta ? { localPath: entrada.ruta } : {}),
        radio: true,
        videoId: entrada.videoId,
        title: finalProgressData.title || videoInfo.title || '',
        channel: finalProgressData.channel || videoInfo.channel || '',
        ...(finalProgressData.artist ? { artist: finalProgressData.artist } : {}),
        ...(finalProgressData.track ? { track: finalProgressData.track } : {}),
        thumbnail: finalProgressData.thumbnail || videoInfo.thumbnail || '',
        duration: videoInfo.duration ?? null,
    };
    // La misma medida que una descarga normal (plan 12, T4): suena igualada
    const loudness = medidaSonoridad(finalProgressData.loudness, 'servidor');
    if (loudness) cancion.loudness = loudness;
    return completarMetadatos(cancion);
}
