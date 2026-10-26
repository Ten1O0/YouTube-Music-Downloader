/**
 * Qué es tuyo y qué suena desde la nube (plan 29, T7): el recuento de Ajustes,
 * «230 canciones tuyas · 45 desde la nube». Puro; tuyo.js lo pinta.
 */

import { esNube } from '../sync/fusion.js';
import { textoTuyo } from './textos-tuyo.js';

/**
 * Las tuyas (descargadas aquí) y las de la nube, sin repetir: las de la
 * biblioteca y las que solo están en una lista (una lista importada sin
 * descargar). Pura.
 */
export function recuento(biblioteca, listas) {
    const nube = new Map();
    const descargadas = new Set();
    let tuyas = 0;
    for (const s of biblioteca ?? []) {
        if (esNube(s)) nube.set(s.videoId || s.src, s);
        else {
            tuyas++;
            if (s.videoId) descargadas.add(s.videoId);
        }
    }
    // Una copia de una lista aún «en la nube» de una canción ya descargada es tuya:
    // las listas se ponen al día un momento después que la biblioteca
    for (const pl of listas ?? []) {
        for (const s of pl?.songs ?? []) {
            const clave = s?.videoId || s?.src;
            if (esNube(s) && !descargadas.has(s.videoId) && !nube.has(clave)) nube.set(clave, s);
        }
    }
    return { tuyas, nube: [...nube.values()] };
}

/** «230 canciones tuyas · 45 desde la nube»; sin nada en la nube, solo lo tuyo. Pura. */
export const textoRecuento = ({ tuyas, nube }, idioma) =>
    [textoTuyo(tuyas === 1 ? 'tuyasUna' : 'tuyas', { n: tuyas }, idioma),
        ...(nube.length ? [textoTuyo('desdeNube', { n: nube.length }, idioma)] : [])].join(' · ');
