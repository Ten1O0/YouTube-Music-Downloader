/**
 * Recuperar la carátula real de las canciones que no tienen (plan 27, T4): lo
 * puro. Lo que busca y guarda está en caratulas-recuperadas.js.
 *
 * - Quién está pendiente: sin carátula, con su id de YouTube y sin intentar.
 * - Del buscador, el vídeo que es esa canción: el título exacto (como siempre),
 *   y además el artista y la duración cuando la canción los sabe. Nunca se
 *   adivina: sin coincidencia segura, la canción se queda como estaba.
 */

import { limpiarCanal, normalizarArtista } from '../../core/titles.js';
import { esVideoId, normalizarTitulo } from '../sync/validar.js';

/** Lo que pone el importador cuando el fichero no dice el artista: no es un artista. */
const SIN_ARTISTA = 'importado localmente';
/** Diferencia de duración que se admite entre el fichero y el vídeo. */
export const MARGEN_DURACION = 5;

/** ¿Tiene la canción alguna carátula guardada? La generada (T3) se pinta al vuelo y no cuenta. */
export const tieneCaratula = (song) => Boolean(song?.thumbnail || song?.caratula);

/** Las canciones del dispositivo sin carátula que ya tienen su id de YouTube y aún no se han intentado. Pura. */
export function pendientesDeCaratula(biblioteca, intentadas = {}) {
    return (biblioteca ?? []).filter((s) => s?.src && !s.nube && !tieneCaratula(s)
        && esVideoId(s.videoId) && !intentadas?.[s.src]);
}

/**
 * Pone los campos de la carátula a las canciones con ese `src` (la de la
 * biblioteca o sus copias en las listas) que siguen sin carátula. Cambia las
 * canciones; devuelve cuántas ha tocado.
 */
export function ponerCaratula(canciones, src, campos) {
    let tocadas = 0;
    for (const s of canciones ?? []) {
        if (s?.src === src && !tieneCaratula(s)) { Object.assign(s, campos); tocadas++; }
    }
    return tocadas;
}

/** Para comparar nombres: sin tildes, mayúsculas, espacios ni signos. */
const compacto = (texto) => normalizarArtista(texto).replace(/[^\p{L}\p{N}]/gu, '');

/** Lo que la canción sabe de sí misma para reconocer su vídeo: su artista y su duración, si los tiene. Pura. */
export function datosParaCoincidir(song) {
    const candidatos = [song?.editado ? song.artist : null, song?.channel, song?.artist];
    const artista = candidatos.map((a) => compacto(limpiarCanal(a))).find((a) => a.length >= 2 && a !== compacto(SIN_ARTISTA)) ?? '';
    const segundos = Number.isFinite(song?.duration) && song.duration > 0 ? song.duration : 0;
    return { artista, segundos };
}

/** ¿Es este resultado del buscador del artista y de la duración de la canción? Lo que la canción no sabe no se comprueba. Pura. */
export function coincide(resultado, { artista = '', segundos = 0 } = {}) {
    if (artista) {
        const canal = compacto(limpiarCanal(resultado?.channel));
        const delCanal = canal.length >= 2 && (canal.includes(artista) || artista.includes(canal));
        if (!delCanal && !compacto(resultado?.title).includes(artista)) return false;
    }
    if (segundos) {
        const suya = Number(resultado?.duration);
        if (!(suya > 0) || Math.abs(suya - segundos) > MARGEN_DURACION) return false;
    }
    return true;
}

/**
 * Del buscador, el id del vídeo que es esa canción, o null: el título exacto,
 * el artista y la duración (lo que se sepa), y un único vídeo que cumpla.
 * Pura.
 */
export function idDeResultados(titulo, resultados, datos = {}) {
    const clave = normalizarTitulo(titulo);
    const buenos = (resultados ?? []).filter((r) => esVideoId(r?.id) && normalizarTitulo(r.title) === clave && coincide(r, datos));
    return new Set(buenos.map((r) => r.id)).size === 1 ? buenos[0].id : null;
}
