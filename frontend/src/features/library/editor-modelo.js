/**
 * Lo que guarda «Editar» de una canción (editor.js), sin DOM: el artista y la
 * canción, y la portada elegida (plan 27: gen:0 … gen:7, o la suya).
 */

import { varianteDe } from '../../core/portada-generada.js';
import { editarCancion, nombreDe } from '../../core/titles.js';

/** La canción con la portada `portada` ('' es la suya). Pura. */
export function conPortada(song, portada) {
    const nueva = { ...song };
    if (varianteDe(portada) === null) delete nueva.portada;
    else nueva.portada = portada;
    return nueva;
}

const normalizar = (texto) => String(texto ?? '').replace(/\s+/g, ' ').trim();

/**
 * Lo que se guarda: el artista y la canción si cambiaron (y entonces quedan
 * editados) y la portada. Solo con otra portada, el nombre sigue siendo el
 * automático. null si el nombre no vale. Pura.
 */
export function cancionEditada(song, { artista, cancion, portada }) {
    const nombre = nombreDe(song);
    const mismos = normalizar(artista) === nombre.artista && normalizar(cancion) === nombre.titulo;
    const base = mismos ? song : editarCancion(song, { artista, cancion });
    return base && conPortada(base, portada);
}
