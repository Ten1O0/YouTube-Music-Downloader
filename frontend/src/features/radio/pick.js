/**
 * Modo radio: qué suena después y cuántas tener listas (plan 16, T2).
 *
 * Funciones puras, sin DOM ni red: las candidatas llegan de /api/radio (la
 * mezcla de YouTube de la semilla) y aquí solo se decide.
 */

import { completarMetadatos, limpiarTitulo, normalizarArtista } from '../../core/titles.js';

/** Fuera las mezclas y recopilatorios largos, y los cortes de menos de un minuto. */
export const DURACION_MIN = 60;
export const DURACION_MAX = 10 * 60;

/** Ventana normal y saltando deprisa (§2.3); con datos móviles, menos. */
export const VENTANA = { normal: 3, deprisa: 6, normalMovil: 2, deprisaMovil: 4 };
/** Dos saltos en este tiempo, o saltar antes de estos segundos de escucha: deprisa. */
export const SALTOS_SEGUIDOS_MS = 30_000;
export const ESCUCHA_MINIMA_S = 15;

const sinTildes = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * La misma canción en vídeo oficial, audio y letra da la misma clave: artista y
 * canción limpios (plan 11) y lo que la distingue de verdad («Live», «Remix»),
 * pero no el «feat.», que unas subidas llevan y otras no.
 */
export function claveDeTitulo(titulo, canal = '') {
    const { artista, cancion, extra } = limpiarTitulo(titulo, canal);
    const distingue = extra.split(' · ').filter((e) => e && !/^feat\. /i.test(e)).map(sinTildes).sort().join('|');
    return `${normalizarArtista(artista)}|${sinTildes(cancion)}|${distingue}`;
}

const duracionValida = (d) => typeof d !== 'number' || !Number.isFinite(d) || (d >= DURACION_MIN && d <= DURACION_MAX);

/**
 * Hasta `n` canciones para la cola, en el orden de la mezcla (§2.1):
 *
 * - Fuera las que ya sonaron en esta radio y las vetadas. Van por videoId, pero
 *   se descarta la canción entera: si sonó (o se vetó) el vídeo oficial, su
 *   versión con letra tampoco vuelve.
 * - Una sola por canción (título normalizado): la primera de la mezcla, salvo
 *   que otra versión esté descargada, que entonces gana esa.
 * - Fuera lo que se sabe que dura menos de 1 minuto o más de 10. Una duración
 *   desconocida no descarta.
 * - Si está en la biblioteca (descargada, no «en la nube»), el objeto de la
 *   biblioteca tal cual: suena al instante y no gasta datos. Si no,
 *   `{ radio: true, videoId, title, channel, duration, thumbnail }`.
 */
export function elegir(candidatas, { sonadas = new Set(), vetadas = new Set(), biblioteca = [], n = 3 } = {}) {
    const locales = new Map();
    for (const s of biblioteca ?? []) {
        if (s?.videoId && !s.nube && !s.unavailable && !locales.has(s.videoId)) locales.set(s.videoId, s);
    }

    // Agrupadas por canción, en el orden en que aparece cada una por primera vez
    const grupos = new Map();
    for (const c of candidatas ?? []) {
        if (!c || typeof c.id !== 'string' || !c.id) continue;
        const clave = claveDeTitulo(c.title, c.channel);
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(c);
    }

    const elegidas = [];
    for (const grupo of grupos.values()) {
        if (elegidas.length >= n) break;
        if (grupo.some((c) => sonadas.has(c.id) || vetadas.has(c.id))) continue;
        const c = grupo.find((x) => locales.has(x.id)) ?? grupo[0];
        if (!duracionValida(c.duration)) continue;
        // Con artista y canción separados, como la biblioteca (plan 22, T1)
        elegidas.push(locales.get(c.id) ?? completarMetadatos({
            radio: true,
            videoId: c.id,
            title: c.title ?? '',
            channel: c.channel ?? '',
            duration: typeof c.duration === 'number' ? c.duration : null,
            thumbnail: c.thumbnail ?? '',
        }));
    }
    return elegidas;
}

/**
 * Cuántas canciones tener listas por delante (§2.3). `saltos` son los de desde
 * la última canción escuchada entera, cada uno `{ en: ms, escuchado: s }`: al
 * volver a escuchar una entera, la lista se vacía y la ventana vuelve a 3.
 */
export function ventana({ saltos = [], ahora = Date.now(), redMovil = false } = {}) {
    const recientes = saltos.filter((s) => s.en > ahora - SALTOS_SEGUIDOS_MS).length;
    const ultimo = saltos.at(-1);
    const deprisa = recientes >= 2 || (ultimo != null && ultimo.escuchado < ESCUCHA_MINIMA_S);
    if (redMovil) return deprisa ? VENTANA.deprisaMovil : VENTANA.normalMovil;
    return deprisa ? VENTANA.deprisa : VENTANA.normal;
}
