/**
 * Los ajustes de reproducción (plan 12, T8): valores por defecto y saneado de
 * lo guardado. Sin DOM: se prueba en Node.
 */

import { FUNDIDOS } from './crossfade.js';

// radio y radioSoloWifi (plan 16): de cada dispositivo, no viajan a la cuenta
// fondo (plan 25): el fondo con los colores de la carátula, también de cada dispositivo
export const AJUSTES_POR_DEFECTO = Object.freeze({ fundido: 0, igualar: true, visualizador: true, radio: false, radioSoloWifi: true, fondo: true });

/** Lo guardado, saneado: un valor raro vuelve al de por defecto. */
export function sanearAjustes(guardado) {
    const g = guardado && typeof guardado === 'object' ? guardado : {};
    return {
        fundido: FUNDIDOS.includes(g.fundido) ? g.fundido : AJUSTES_POR_DEFECTO.fundido,
        igualar: typeof g.igualar === 'boolean' ? g.igualar : AJUSTES_POR_DEFECTO.igualar,
        visualizador: typeof g.visualizador === 'boolean' ? g.visualizador : AJUSTES_POR_DEFECTO.visualizador,
        radio: typeof g.radio === 'boolean' ? g.radio : AJUSTES_POR_DEFECTO.radio,
        radioSoloWifi: typeof g.radioSoloWifi === 'boolean' ? g.radioSoloWifi : AJUSTES_POR_DEFECTO.radioSoloWifi,
        fondo: typeof g.fondo === 'boolean' ? g.fondo : AJUSTES_POR_DEFECTO.fondo,
    };
}
