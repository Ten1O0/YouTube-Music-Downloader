/**
 * Listas automáticas (plan 11, T7). Sin DOM: se prueba en Node.
 *
 * Tres listas que no se guardan: se calculan de la biblioteca y de los
 * contadores de escuchas cada vez que se pintan. Son de solo lectura (no hay un
 * orden propio que guardar) y una vacía no se muestra.
 */

import { claveEscucha } from '../player/listens.js';

export const PREFIJO_AUTO = 'auto:';
export const esAutomatica = (id) => typeof id === 'string' && id.startsWith(PREFIJO_AUTO);

const MAS_ESCUCHADAS = { maximo: 25, minimo: 2 };
const RECIENTES = { dias: 30, maximo: 50 };
const DIA = 24 * 60 * 60 * 1000;

/**
 * @param {object[]} biblioteca
 * @param {Record<string, { n: number, ultima?: string }>} contadores
 * @param {number} ahora  milisegundos (Date.now())
 * @returns {{ id: string, songs: object[] }[]} en el orden en que se muestran
 */
export function listasAutomaticas(biblioteca, contadores, ahora) {
    // Sin las que no tienen audio aquí: rotas o en la nube (plan 13)
    const canciones = (biblioteca ?? []).filter((s) => s && !s.unavailable && s.nube !== true);
    const veces = (s) => contadores?.[claveEscucha(s)]?.n ?? 0;
    const ultima = (s) => Date.parse(contadores?.[claveEscucha(s)]?.ultima ?? '') || 0;
    const anadida = (s) => Date.parse(s.addedAt ?? '') || 0;

    const top = canciones
        .filter((s) => veces(s) >= MAS_ESCUCHADAS.minimo)
        // Empate: la escuchada más recientemente primero
        .sort((a, b) => veces(b) - veces(a) || ultima(b) - ultima(a))
        .slice(0, MAS_ESCUCHADAS.maximo);

    const desde = ahora - RECIENTES.dias * DIA;
    const recientes = canciones
        .filter((s) => anadida(s) >= desde && anadida(s) <= ahora)
        .sort((a, b) => anadida(b) - anadida(a))
        .slice(0, RECIENTES.maximo);

    const sinEscuchar = canciones.filter((s) => veces(s) === 0);

    return [
        { id: 'auto:top', songs: top },
        { id: 'auto:recent', songs: recientes },
        { id: 'auto:unplayed', songs: sinEscuchar },
    ].filter((l) => l.songs.length > 0);
}

/** Clave de traducción del nombre y el icono de cada lista. */
export const PRESENTACION_AUTO = {
    'auto:top': { nombre: 'auto_top', icono: 'trending_up' },
    'auto:recent': { nombre: 'auto_recent', icono: 'schedule' },
    'auto:unplayed': { nombre: 'auto_unplayed', icono: 'explore' },
};
