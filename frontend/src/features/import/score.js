/**
 * Puntuar las candidatas de YouTube para una canción importada (plan 15, T3).
 *
 * Función pura: `puntuar(origen, candidata)` da de 0 a 100 y `mejor(origen,
 * candidatas)` elige. El peligro que evita es el de buscar a mano: que la
 * primera coincidencia sea un directo, una versión o un karaoke.
 *
 * `origen` es lo que sale de `parse.js`: { titulo, artista, artistas, duracionMs, isrc }.
 * Una candidata es lo que devuelve el servidor por cada resultado de YouTube:
 * { id, title, channel, duration (s), artist?, track?, porIsrc?, verificado? }.
 *
 * Las señales, con su peso (plan 15, §2.3):
 *
 * | Señal                                              | Peso |
 * |----------------------------------------------------|------|
 * | Título parecido (Jaro-Winkler, tras limpiarlo)     | 40   |
 * | El artista aparece en el canal o en el título      | 25   |
 * | Duración: ±3 s → 20; ±10 → 12; ±20 → 5; más → 0    | 20   |
 * | Canal oficial («- Topic», «VEVO», verificado)      | 10   |
 * | Coincidencia por ISRC                              | +30  |
 * | «live», «cover», «karaoke», «remix»… sin pedirlo   | −30 cada una |
 *
 * **Lo que no se sabe no cuenta ni a favor ni en contra.** Una lista pegada a
 * mano no trae duración: si esa señal contara como cero, ninguna canción de
 * texto podría ser nunca «segura». Así que la suma de las cuatro primeras se
 * escala sobre las señales que sí se pueden medir, y el máximo sigue siendo 95.
 */

import { limpiarCanal, limpiarTitulo, normalizarArtista } from '../../core/titles.js';

/** Umbrales de confianza. */
export const SEGURA = 80;
export const PROBABLE = 60;

const PESOS = { titulo: 40, artista: 25, duracion: 20, oficial: 10 };
const MAXIMO_SIN_ISRC = PESOS.titulo + PESOS.artista + PESOS.duracion + PESOS.oficial; // 95
const BONUS_ISRC = 30;
const PENALIZACION = 30;

/**
 * Lo que delata una versión que no es la original. Se busca en el título tal
 * como viene de YouTube, antes de limpiarlo: `limpiarTitulo` aparta «(Live)» o
 * «(Remix)» a un extra y, si se mirase el título limpio, no se verían.
 * Con límites de palabra: «live» no debe saltar con «Alive» ni «Oliver».
 */
const VERSIONES = [
    ['live', /\b(live|en vivo|en directo)\b/],
    ['cover', /\bcover\b/],
    ['karaoke', /\bkaraoke\b/],
    ['remix', /\b(remix|rmx)\b/],
    ['8d', /\b8d\b/],
    ['sped up', /\bsped[\s-]?up\b/],
    ['slowed', /\bslowed\b/],
    ['instrumental', /\binstrumental\b/],
    ['nightcore', /\bnightcore\b/],
];

// ========================================
// Utilidades de texto
// ========================================

/** Para comparar: sin mayúsculas, tildes ni signos, espacios unidos. */
export function normalizar(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * El título sin lo que cuelga: paréntesis, corchetes y lo que va tras « - ».
 * Spotify escribe las versiones así («Malamente - Cap.1: Augurio», «Song -
 * Remastered 2011») y YouTube las suele omitir.
 */
function base(titulo) {
    return String(titulo ?? '')
        .replace(/\s*[([【][^)\]】]*[)\]】]/g, ' ')
        .split(/\s+[-–—]\s+/)[0]
        .trim();
}

/**
 * Similitud de Jaro-Winkler entre dos textos, de 0 a 1. Premia el prefijo común,
 * que en títulos de canciones es justo lo que importa: «Bohemian Rhapsody» y
 * «Bohemian Rhapsody Remastered» se parecen mucho.
 */
export function jaroWinkler(a, b) {
    if (a === b) return a.length ? 1 : 0;
    if (!a.length || !b.length) return 0;
    const ventana = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const usadasA = new Array(a.length).fill(false);
    const usadasB = new Array(b.length).fill(false);
    let coincidencias = 0;
    for (let i = 0; i < a.length; i++) {
        const desde = Math.max(0, i - ventana);
        const hasta = Math.min(i + ventana + 1, b.length);
        for (let j = desde; j < hasta; j++) {
            if (usadasB[j] || a[i] !== b[j]) continue;
            usadasA[i] = usadasB[j] = true;
            coincidencias++;
            break;
        }
    }
    if (!coincidencias) return 0;
    let transposiciones = 0;
    let k = 0;
    for (let i = 0; i < a.length; i++) {
        if (!usadasA[i]) continue;
        while (!usadasB[k]) k++;
        if (a[i] !== b[k]) transposiciones++;
        k++;
    }
    const m = coincidencias;
    const jaro = (m / a.length + m / b.length + (m - transposiciones / 2) / m) / 3;
    let prefijo = 0;
    while (prefijo < 4 && prefijo < a.length && prefijo < b.length && a[prefijo] === b[prefijo]) prefijo++;
    return jaro + prefijo * 0.1 * (1 - jaro);
}

/** El título de la candidata que se compara: el de YouTube Music si lo hay, o el deducido. */
function tituloCandidata(c) {
    if (typeof c.track === 'string' && c.track.trim()) return c.track;
    return limpiarTitulo(c.title, c.channel).cancion;
}

/** Artistas del origen, normalizados y sin vacíos. */
function artistasOrigen(origen) {
    const lista = Array.isArray(origen.artistas) && origen.artistas.length ? origen.artistas : [origen.artista];
    return lista.map(normalizarArtista).filter(Boolean);
}

// ========================================
// Señales
// ========================================

/**
 * Parecido de títulos, de 0 a 1. Se toma el mayor entre comparar enteros y
 * comparar sin lo que cuelga. Por debajo de 0,6 no cuenta: Jaro-Winkler da
 * valores de 0,5 incluso entre títulos que no tienen nada que ver.
 */
export function parecidoTitulo(origen, candidata) {
    const o = origen.titulo;
    const c = tituloCandidata(candidata);
    const parecido = Math.max(
        jaroWinkler(normalizar(o), normalizar(c)),
        jaroWinkler(normalizar(base(o)), normalizar(base(c))),
    );
    return Math.max(0, (parecido - 0.6) / 0.4);
}

/** true si algún artista del origen sale en el canal, el artista de YouTube o el título. */
export function artistaPresente(origen, candidata) {
    const buscados = artistasOrigen(origen);
    if (!buscados.length) return null;   // no se puede medir
    const donde = [
        normalizarArtista(limpiarCanal(candidata.channel)),
        normalizarArtista(candidata.artist),
        normalizarArtista(candidata.title),
    ].map(normalizar).filter(Boolean);
    return buscados.some((a) => {
        const buscado = normalizar(a);
        return buscado && donde.some((d) => ` ${d} `.includes(` ${buscado} `));
    });
}

/** Puntos por duración, o null si falta alguna de las dos. */
export function puntosDuracion(origen, candidata) {
    const o = Number(origen.duracionMs);
    const c = Number(candidata.duration);
    if (!(o > 0) || !(c > 0)) return null;
    const diferencia = Math.abs(o / 1000 - c);
    if (diferencia <= 3) return 20;
    if (diferencia <= 10) return 12;
    if (diferencia <= 20) return 5;
    return 0;
}

/** Canal oficial: «Artista - Topic» de YouTube Music, VEVO o verificado. */
export function esOficial(candidata) {
    const canal = String(candidata.channel ?? '');
    return /\s-\s*topic$/i.test(canal) || /vevo/i.test(canal) || candidata.verificado === true;
}

/** Las marcas de versión que tiene la candidata y no el origen. */
export function versionesNoPedidas(origen, candidata) {
    const enOrigen = normalizar(`${origen.titulo} ${origen.album ?? ''}`);
    const enCandidata = normalizar(candidata.title);
    return VERSIONES
        .filter(([, re]) => re.test(enCandidata) && !re.test(enOrigen))
        .map(([nombre]) => nombre);
}

// ========================================
// Puntuación
// ========================================

/**
 * Puntuación de 0 a 100 y el desglose, para poder explicar por qué una
 * coincidencia es dudosa.
 */
export function puntuar(origen, candidata) {
    if (!origen || !candidata) return { puntos: 0, detalle: {} };

    const titulo = parecidoTitulo(origen, candidata) * PESOS.titulo;
    const artista = artistaPresente(origen, candidata);
    const duracion = puntosDuracion(origen, candidata);
    const oficial = esOficial(candidata) ? PESOS.oficial : 0;

    // Solo cuentan las señales que se pueden medir
    let obtenidos = titulo + oficial;
    let posibles = PESOS.titulo + PESOS.oficial;
    if (artista !== null) { obtenidos += artista ? PESOS.artista : 0; posibles += PESOS.artista; }
    if (duracion !== null) { obtenidos += duracion; posibles += PESOS.duracion; }
    let puntos = (obtenidos / posibles) * MAXIMO_SIN_ISRC;

    const isrc = Boolean(origen.isrc && candidata.porIsrc);
    if (isrc) puntos += BONUS_ISRC;

    const versiones = versionesNoPedidas(origen, candidata);
    puntos -= versiones.length * PENALIZACION;
    // Con los pesos del plan, una sola marca resta 30 y una coincidencia perfecta
    // en lo demás (95) se quedaría en 65, «probable». Pero un karaoke cuando se
    // pidió el original es justo el error que este plan existe para evitar (D2):
    // tiene que salir marcado para revisar, así que nunca pasa de «dudosa».
    if (versiones.length) puntos = Math.min(puntos, PROBABLE - 1);

    // Sin artista en el origen, el título solo es poca prueba: «Hello» puede ser
    // de Adele o de Lionel Richie. Nunca «segura», para que pase por la revisión.
    // El ISRC sí identifica la grabación exacta, y con él no hace falta el tope.
    if (artista === null && !isrc) puntos = Math.min(puntos, SEGURA - 1);

    return {
        puntos: Math.round(Math.max(0, Math.min(100, puntos))),
        detalle: { titulo: Math.round(titulo), artista, duracion, oficial: oficial > 0, isrc, versiones },
    };
}

/** segura, probable o dudosa. */
export function confianza(puntos) {
    if (puntos >= SEGURA) return 'segura';
    if (puntos >= PROBABLE) return 'probable';
    return 'dudosa';
}

/**
 * La mejor candidata y todas las demás, ordenadas.
 *
 * Si la misma vídeo llega dos veces (por el ISRC y por la búsqueda normal), se
 * junta en una conservando que vino por ISRC. A igualdad de puntos gana el canal
 * oficial y, si no, la que YouTube puso antes.
 *
 * @returns `{ elegida, puntos, confianza, candidatas }`. Sin candidatas,
 *   `elegida` es null y la confianza, 'ninguna'.
 */
export function mejor(origen, candidatas) {
    const unicas = new Map();
    (Array.isArray(candidatas) ? candidatas : []).forEach((c, orden) => {
        if (!c?.id) return;
        const previa = unicas.get(c.id);
        if (previa) previa.porIsrc = previa.porIsrc || c.porIsrc === true;
        else unicas.set(c.id, { ...c, porIsrc: c.porIsrc === true, orden });
    });

    const puntuadas = [...unicas.values()]
        .map((c) => {
            const { puntos, detalle } = puntuar(origen, c);
            return { ...c, puntos, detalle };
        })
        .sort((a, b) => b.puntos - a.puntos
            || Number(esOficial(b)) - Number(esOficial(a))
            || a.orden - b.orden);

    const elegida = puntuadas[0] ?? null;
    return {
        elegida,
        puntos: elegida?.puntos ?? 0,
        confianza: elegida ? confianza(elegida.puntos) : 'ninguna',
        candidatas: puntuadas,
    };
}
