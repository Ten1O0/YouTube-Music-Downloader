/**
 * Cuándo y cómo se pasa de una canción a la siguiente (plan 12, T3). Sin DOM:
 * se prueba en Node.
 *
 * - **Sin cortes** (fundido 0): la siguiente se precarga con tiempo y arranca
 *   justo al acabar la actual. Se programa con un temporizador en cuanto
 *   quedan menos de VENTANA_SIN_CORTES segundos; si el temporizador llega
 *   tarde (Android los frena en segundo plano), el 'ended' de la actual la
 *   arranca igualmente, ya cargada.
 * - **Fundido** de N s: cuando quedan N s, la siguiente arranca a volumen 0 y
 *   se cruzan con curva de igual potencia. A mitad del cruce la siguiente pasa
 *   a ser la canción actual.
 *
 * Nunca hay transición con «Repetir una» ni con el elemento en bucle.
 */

export const FUNDIDOS = [0, 2, 4, 6, 8, 12];
export const PRECARGA = 20;
export const VENTANA_SIN_CORTES = 0.5;
/** Lo que tarda en sonar un elemento ya cargado: se adelanta el arranque sin cortes. */
export const LATENCIA_ARRANQUE = 0.03;

/** Igual potencia: sale² + entra² = 1, el volumen no se hunde a mitad del cruce. */
export function curvaIgualPotencia(x) {
    const t = Math.min(1, Math.max(0, x));
    return { sale: Math.cos(t * Math.PI / 2), entra: Math.sin(t * Math.PI / 2) };
}

/** El fundido no puede ocupar más de un tercio de una canción corta. */
export function fundidoEfectivo(fundido, duracion) {
    if (!(fundido > 0) || !(duracion > 0)) return 0;
    return Math.min(fundido, duracion / 3);
}

/**
 * Qué toca hacer en este instante.
 * @param {{ duracion: number, actual: number, fundido: number, repetir: boolean, haySiguiente: boolean }} estado
 * @returns {{ precargar: boolean, arrancarEn: number|null, cruce: number|null, cambiar: boolean }}
 *   arrancarEn: segundos desde ahora hasta arrancar la siguiente (0 = ya);
 *   cruce: progreso del fundido, 0-1, o null si no hay;
 *   cambiar: la siguiente ya debe ser la actual.
 */
export function planDeTransicion({ duracion, actual, fundido = 0, repetir = false, haySiguiente = true }) {
    const nada = { precargar: false, arrancarEn: null, cruce: null, cambiar: false };
    if (repetir || !haySiguiente || !Number.isFinite(duracion) || duracion <= 0) return nada;

    const quedan = Math.max(0, duracion - actual);
    const n = fundidoEfectivo(fundido, duracion);
    const precargar = quedan <= Math.max(PRECARGA, n + 2);

    if (n === 0) {
        if (quedan > VENTANA_SIN_CORTES) return { ...nada, precargar };
        return { precargar, arrancarEn: Math.max(0, quedan - LATENCIA_ARRANQUE), cruce: null, cambiar: true };
    }

    if (quedan > n) return { ...nada, precargar };
    const cruce = 1 - quedan / n;
    return { precargar, arrancarEn: 0, cruce, cambiar: cruce >= 0.5 };
}
