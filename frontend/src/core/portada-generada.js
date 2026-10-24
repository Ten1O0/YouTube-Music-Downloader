/**
 * La portada de lo que no tiene carátula (plan 27), sin cargar el generador en
 * el arranque (presupuesto del plan 19).
 *
 * Con el generador (core/portadas-generadas.js) ya cargado, da su portada al
 * momento. Si no, lo pide y, mientras llega, devuelve el icono de siempre con
 * una marca (`#gen=…`, que el navegador no tiene en cuenta al cargarlo): al
 * llegar, cada imagen marcada pasa a su portada.
 */

let generador = null;
let pedido = null;

/** Carga el generador (una vez) y pone su portada a las imágenes que esperaban. */
export const cargarPortadas = () => (pedido ??= import('./portadas-generadas.js').then((m) => {
    generador = m;
    for (const img of globalThis.document?.querySelectorAll('img[src*="#gen="]') ?? []) img.src = m.desdeMarca(img.getAttribute('src'));
    return m;
}));

const marca = (texto) => {
    cargarPortadas();
    return `favicon.png#gen=${encodeURIComponent(texto)}`;
};

/**
 * La carátula de una canción o, si no tiene, su portada generada: del color de
 * su artista. Si en «Editar» se eligió una generada (`portada`: gen:0 … gen:7),
 * esa, como en las listas.
 */
export function caratulaDe(song) {
    const variante = varianteDe(song?.portada);
    if (variante === null && song?.thumbnail) return song.thumbnail;
    const artista = song?.artist || song?.channel || '';
    const id = song?.videoId || song?.src || song?.title || '';
    if (variante !== null) return portadaDeListaGenerada(id, variante);
    return generador ? generador.portadaDeCancion(artista, id).src : marca(`c\n${artista}\n${id}`);
}

/** La portada generada de una lista: la automática de su id, o la variante elegida. */
export function portadaDeListaGenerada(id, variante = null) {
    return generador ? generador.portadaGenerada(id, variante).src : marca(`l\n${id}\n${variante ?? ''}`);
}

/** `gen:3` → 3; cualquier otra cosa → null. */
export const varianteDe = (portada) => (/^gen:[0-7]$/.test(portada ?? '') ? Number(portada.slice(4)) : null);

/** Como caratulaDe, pero esperando al generador si hace falta: para el reproductor y la pantalla de bloqueo. */
export async function caratulaSegura(song) {
    if (!song?.thumbnail || song.portada) await cargarPortadas().catch(() => {});
    return caratulaDe(song);
}
