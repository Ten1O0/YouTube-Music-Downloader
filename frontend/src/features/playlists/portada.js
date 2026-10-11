/**
 * La portada elegida de una lista (plan 24, P11).
 *
 * Se guarda como el videoId de una de sus canciones (`pl.portada`), así que
 * viaja con la cuenta sin subir imágenes. Si esa canción sale de la lista o no
 * tiene carátula, la portada vuelve a ser la automática (el mosaico).
 */

/** La carátula elegida para la lista, o null si es la automática. Pura. */
export function caratulaElegida(pl) {
    if (!pl?.portada) return null;
    const cancion = (pl.songs ?? []).find((s) => s?.videoId === pl.portada && s.thumbnail);
    return cancion?.thumbnail ?? null;
}
