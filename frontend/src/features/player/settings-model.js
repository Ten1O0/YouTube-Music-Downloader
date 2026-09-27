/**
 * Los ajustes de reproducción (plan 12, T8): valores por defecto y saneado de
 * lo guardado. Sin DOM: se prueba en Node.
 */

import { FUNDIDOS } from './crossfade.js';

export const AJUSTES_POR_DEFECTO = Object.freeze({ fundido: 0, igualar: true, visualizador: true });

/** Lo guardado, saneado: un valor raro vuelve al de por defecto. */
export function sanearAjustes(guardado) {
    const g = guardado && typeof guardado === 'object' ? guardado : {};
    return {
        fundido: FUNDIDOS.includes(g.fundido) ? g.fundido : AJUSTES_POR_DEFECTO.fundido,
        igualar: typeof g.igualar === 'boolean' ? g.igualar : AJUSTES_POR_DEFECTO.igualar,
        visualizador: typeof g.visualizador === 'boolean' ? g.visualizador : AJUSTES_POR_DEFECTO.visualizador,
    };
}
