/**
 * La portada elegida de una lista (plan 24, P11).
 *
 * Se guarda como el videoId de una de sus canciones (`pl.portada`), así que
 * viaja con la cuenta sin subir imágenes. Si esa canción sale de la lista o no
 * tiene carátula, la portada vuelve a ser la automática (el mosaico).
 *
 * También puede ser una portada generada (plan 27): `gen:0` … `gen:7`.
 */

import { portadaDeListaGenerada, varianteDe } from '../../core/portada-generada.js';

/** La carátula elegida para la lista, o null si es la automática: la grande, si la canción tiene una aparte de su miniatura; o la generada elegida. */
export function caratulaElegida(pl) {
    if (!pl?.portada) return null;
    const variante = varianteDe(pl.portada);
    if (variante !== null) return portadaDeListaGenerada(pl.id, variante);
    const cancion = (pl.songs ?? []).find((s) => s?.videoId === pl.portada && s.thumbnail);
    return cancion ? (cancion.caratula || cancion.thumbnail) : null;
}
