/**
 * Escuchar antes una canción que YouTube no deja incrustar (plan 24): se baja en
 * silencio a la caché de la radio y suena desde ahí. Tarda unos segundos, pero
 * después, añadirla a la biblioteca es instantáneo (`aBiblioteca` de la radio).
 *
 * Se carga solo cuando hace falta: el reproductor incrustado es el camino normal.
 */

import { resolveStreamSrc } from '../core/audio-store.js';
import { descargarEnSilencio } from './download/download.js';
import { LibraryModule } from './library/library.js';
import { enCache, guardarEnCache } from './radio/cache.js';

/**
 * La dirección del audio de la canción en el dispositivo: si ya está en la
 * biblioteca, la suya; si está en la caché de la radio, la de ahí; si no, se
 * baja a la caché. Lanza si no se puede (sin red, YouTube limitando…).
 * @param {{ videoId: string, title?: string, channel?: string, thumbnail?: string, duration?: number }} cancion
 */
export async function audioParaEscuchar(cancion) {
    const { videoId } = cancion;
    const enBiblioteca = (await LibraryModule.getLibrary()).find((s) => s.videoId === videoId && s.src && !s.nube);
    if (enBiblioteca) return resolveStreamSrc(enBiblioteca);
    const enLaCache = (await enCache()).find((c) => c.videoId === videoId);
    if (enLaCache) return resolveStreamSrc(enLaCache);
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const { download_id, finalProgressData } = await descargarEnSilencio(url);
    const videoInfo = {
        videoId, title: cancion.title, channel: cancion.channel, thumbnail: cancion.thumbnail, duration: cancion.duration,
    };
    return resolveStreamSrc(await guardarEnCache({ download_id, url, videoInfo, finalProgressData }));
}
