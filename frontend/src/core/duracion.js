/**
 * Duraciones legibles (plan 23): la de una canción («3:05») y la de varias
 * juntas («47 min», «1 h 12 min»). Las usan el selector de canciones y la
 * cabecera de una lista.
 */

import { i18n } from '../i18n/language-manager.js';

/** Segundos válidos de una canción, o 0 si no se sabe. */
export const segundosDe = (song) => (Number.isFinite(song?.duration) && song.duration > 0 ? song.duration : 0);

/** «3:05». Vacío si no hay duración. */
export function duracionCorta(segundos) {
    if (!Number.isFinite(segundos) || segundos <= 0) return '';
    const s = Math.round(segundos);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * «47 min» o «1 h 12 min», redondeando al minuto. Algo de duración nunca se
 * queda en «0 min»: por debajo de un minuto dice «1 min». Vacío si no hay nada.
 */
export function duracionTotal(segundos) {
    if (!Number.isFinite(segundos) || segundos <= 0) return '';
    const minutos = Math.max(1, Math.round(segundos / 60));
    if (minutos < 60) return i18n.t('dur_min', { m: minutos });
    const h = Math.floor(minutos / 60), m = minutos % 60;
    return m ? i18n.t('dur_h_min', { h, m }) : i18n.t('dur_h', { h });
}
