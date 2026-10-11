/**
 * Modo radio y recomendadas: qué suena después y cuántas tener listas (plan 16,
 * T2), repartido entre artistas (plan 25).
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

/** Como mucho estas canciones de un mismo artista por tanda (plan 25, lo decidió el usuario). */
export const POR_ARTISTA = 2;

const SEPARA_ARTISTAS = /\s*(?:,|&|\bx\b|\by\b|\band\b|\bwith\b|\bcon\b)\s*/i;

/** Los artistas de una canción, normalizados: el principal primero y luego los «feat.». Pura. */
export function artistasDe(cancion) {
    const { artist, extra } = completarMetadatos({ title: cancion?.title ?? '', channel: cancion?.channel ?? '', artist: cancion?.artist, extra: cancion?.extra });
    const feats = String(extra ?? '').split(' · ').filter((e) => /^feat\. /i.test(e)).map((e) => e.replace(/^feat\. /i, ''));
    const todos = [artist || cancion?.channel || '', ...feats]
        .flatMap((a) => String(a).split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i))
        .flatMap((a) => a.split(SEPARA_ARTISTAS))
        .map(normalizarArtista)
        .filter(Boolean);
    return [...new Set(todos)];
}

/** La clave del artista principal de una canción: la que cuenta para el reparto. Pura. */
export const claveArtista = (cancion) => artistasDe(cancion)[0] ?? '';

/**
 * Junta las mezclas de varias semillas (plan 25, R3): una sola lista sin
 * repetidos, con `veces` (en cuántas mezclas salió cada una) y ordenada por su
 * mejor puesto en cualquiera de ellas. Pura.
 */
export function juntarMezclas(listas) {
    const porId = new Map();
    for (const lista of listas ?? []) {
        (lista ?? []).forEach((c, puesto) => {
            if (!c || typeof c.id !== 'string' || !c.id) return;
            const ya = porId.get(c.id);
            if (ya) {
                ya.veces += 1;
                ya.puesto = Math.min(ya.puesto, puesto);
            } else {
                porId.set(c.id, { c, veces: 1, puesto });
            }
        });
    }
    return [...porId.values()]
        .sort((a, b) => a.puesto - b.puesto || b.veces - a.veces)
        .map(({ c, veces }) => ({ ...c, veces }));
}

/**
 * Hasta `n` canciones para la cola o las recomendadas (§2.1 del plan 16 y
 * plan 25):
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
 *
 * Y repartidas entre artistas (plan 25): en las mezclas de un artista de nicho
 * casi todo era suyo.
 * - Como mucho `porArtista` (2) de un mismo artista, contando lo de `recientes`
 *   (claves de artista de lo que ha sonado hace poco o ya está listo). Solo si no
 *   hay bastantes artistas distintos se pasa de ahí.
 * - Con `conocidos` (los artistas de la lista o de la radio), más o menos la
 *   mitad de esos y la mitad de otros nuevos.
 * - Pesan a favor salir antes en la mezcla, salir en varias mezclas (`veces`) y
 *   colaborar con un artista conocido. El que acaba de sonar no va el primero.
 */
export function elegir(candidatas, {
    sonadas = new Set(), vetadas = new Set(), biblioteca = [], n = 3,
    porArtista = POR_ARTISTA, recientes = [], conocidos = new Set(),
} = {}) {
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

    const total = Math.max(1, grupos.size);
    const opciones = [];
    [...grupos.values()].forEach((grupo, puesto) => {
        if (grupo.some((c) => sonadas.has(c.id) || vetadas.has(c.id))) return;
        const c = grupo.find((x) => locales.has(x.id)) ?? grupo[0];
        if (!duracionValida(c.duration)) return;
        const artistas = artistasDe(c);
        const artista = artistas[0] ?? '';
        const conocido = conocidos.has(artista);
        const colabora = artistas.slice(1).some((a) => conocidos.has(a)) || (!conocido && artistas.some((a) => conocidos.has(a)));
        const veces = Math.max(...grupo.map((x) => (Number.isFinite(x.veces) ? x.veces : 1)));
        opciones.push({
            c, artista, conocido,
            puntos: (1 - puesto / total) + 0.6 * (veces - 1) + (colabora ? 0.3 : 0),
        });
    });

    const cuenta = new Map();
    for (const a of recientes ?? []) if (a) cuenta.set(a, (cuenta.get(a) ?? 0) + 1);
    let anterior = (recientes ?? []).at(-1) ?? null;
    const elegidas = [];
    let deConocidos = 0;
    let deNuevos = 0;
    const libres = new Set(opciones);

    const mejor = (filtro) => {
        let m = null;
        for (const o of libres) if (filtro(o) && (!m || o.puntos > m.puntos)) m = o;
        return m;
    };

    while (elegidas.length < n && libres.size) {
        const cabe = (o) => (cuenta.get(o.artista) ?? 0) < porArtista && o.artista !== anterior;
        // Mitad y mitad: le toca al grupo que va por detrás
        const tocaConocido = conocidos.size ? deConocidos <= deNuevos : null;
        const o = (tocaConocido == null ? null : mejor((x) => cabe(x) && x.conocido === tocaConocido))
            ?? mejor(cabe)
            // Sin más artistas distintos: se repite antes que quedarse corto
            ?? mejor((x) => (cuenta.get(x.artista) ?? 0) < porArtista)
            ?? mejor(() => true);
        libres.delete(o);
        cuenta.set(o.artista, (cuenta.get(o.artista) ?? 0) + 1);
        anterior = o.artista;
        if (o.conocido) deConocidos++; else deNuevos++;
        const { c } = o;
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
