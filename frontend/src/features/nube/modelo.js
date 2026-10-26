/**
 * Escuchar desde la nube (plan 29): lo que comparten la reproducción (T1-T3)
 * y lo que anima a descargar (T5-T7), sin DOM.
 *
 * Una canción «suena desde la nube» cuando no está descargada en el
 * dispositivo:
 *
 * - `nube`: en la nube, en una lista o en la biblioteca (plan 13 y 15), sin
 *   audio aquí;
 * - `radio`: de la radio, en su caché temporal (plan 16);
 * - `desdeNube`: una de la nube ya preparada para sonar, en esa misma caché
 *   (T1).
 *
 * Al guardarla (`Guardar`), pasa a la biblioteca y deja de serlo.
 */

/** ¿Suena desde la nube (no está descargada aquí)? Pura. */
export const suenaDesdeLaNube = (song) => Boolean(song?.nube || song?.radio || song?.desdeNube);

/**
 * Qué canciones de la nube preparar por delante de la que suena (T1): las que
 * hay en las `cuantas` posiciones siguientes de la cola, no más allá (en una
 * lista larga, las de dentro de veinte canciones quizá no suenen nunca). Con
 * `repetir` (repetir todo), la cola da la vuelta. Pura.
 */
export function prepararPorDelante(cola, indice, { cuantas = 3, repetir = false } = {}) {
    const n = cola?.length ?? 0;
    const fuera = [];
    for (let paso = 1; paso <= cuantas && paso < n + (repetir ? 0 : 1); paso++) {
        const i = indice + paso;
        if (i >= n && !repetir) break;
        const song = cola[i % n];
        if (song?.nube && song.videoId && !fuera.includes(song)) fuera.push(song);
    }
    return fuera;
}
