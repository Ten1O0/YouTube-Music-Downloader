/**
 * Cuándo recordar que una canción se puede guardar (plan 29, T6). Puro: sin
 * DOM ni almacenamiento; tuyo.js lo guarda y lo enseña.
 *
 * Lo decidió el usuario:
 * - a las 3 escuchas enteras de una canción que suena desde la nube, y al darle
 *   a favorito, se propone guardarla;
 * - como mucho 2 recordatorios al día, sumando los dos;
 * - nunca la primera vez que suena una canción, salvo al darle a favorito
 *   (decidido el 2026-10-26: es una señal clara de que le gusta);
 * - si se descarta el de una canción, esa canción no se vuelve a proponer.
 *
 * El estado: { dia: 'AAAA-MM-DD', hoy, sonadas: { [id]: veces }, descartadas: { [id]: fecha } }.
 */

export const MAX_AL_DIA = 2;
export const ESCUCHAS_PARA_RECORDAR = 3;
/** Una escucha es entera si llega al 90 % de la canción (un fundido corta el final). */
export const FRACCION_ENTERA = 0.9;
/** Sin duración conocida, una escucha de verdad: lo que cuenta el reproductor. */
const ENTERA_SIN_DURACION = 30;

/** El día local de un instante. Pura. */
export function diaDe(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** El estado guardado, o uno vacío si no vale. Pura. */
export function leerEstado(guardado) {
    const e = esObjeto(guardado) ? guardado : {};
    return {
        dia: typeof e.dia === 'string' ? e.dia : '',
        hoy: Number.isInteger(e.hoy) && e.hoy > 0 ? e.hoy : 0,
        sonadas: esObjeto(e.sonadas) ? e.sonadas : {},
        descartadas: esObjeto(e.descartadas) ? e.descartadas : {},
    };
}

/** La identidad de una canción para los recordatorios: la misma que en el registro de escuchas. Pura. */
export const idDe = (song) => song?.videoId || song?.id || null;

/** Una vez más que suena desde la nube. Pura. */
export const anotarQueSuena = (estado, id) => ({ ...estado, sonadas: { ...estado.sonadas, [id]: (estado.sonadas[id] ?? 0) + 1 } });

/**
 * ¿Se puede proponer guardar esta canción ahora? Con `aunqueSeaLaPrimera` (el
 * favorito), también la primera vez que suena. Pura.
 */
export function puedeRecordar(estado, id, ahora, { aunqueSeaLaPrimera = false } = {}) {
    if (!id || estado.descartadas[id]) return false;
    // Nunca la primera vez que suena
    if (!aunqueSeaLaPrimera && (estado.sonadas[id] ?? 0) < 2) return false;
    return (estado.dia === diaDe(ahora) ? estado.hoy : 0) < MAX_AL_DIA;
}

/** Se ha enseñado un recordatorio: cuenta para los de hoy. Pura. */
export function anotarRecordatorio(estado, ahora) {
    const dia = diaDe(ahora);
    return { ...estado, dia, hoy: (estado.dia === dia ? estado.hoy : 0) + 1 };
}

/** No la quiso guardar: no se vuelve a proponer. Pura. */
export const descartar = (estado, id, ahora) => ({ ...estado, descartadas: { ...estado.descartadas, [id]: ahora } });

/** ¿Es entera una escucha de `segundos` en una canción de `duracion` segundos? Pura. */
export const esEntera = (segundos, duracion) => (duracion > 0 ? segundos >= duracion * FRACCION_ENTERA : segundos >= ENTERA_SIN_DURACION);

/** Las escuchas enteras de una canción en el registro de escuchas ({ videoId, segundos }). Pura. */
export const escuchasEnteras = (filas, id, duracion) =>
    (filas ?? []).filter((f) => f?.videoId === id && esEntera(Number(f.segundos) || 0, duracion)).length;
