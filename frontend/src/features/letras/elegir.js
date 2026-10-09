/**
 * Qué preguntar a LRCLIB y qué respuesta aceptar (plan 22, T2).
 *
 * Puro: sin DOM ni red. lyrics.js hace las consultas en el orden que da
 * `consultasDeLetra` y se queda con la primera que `elegirLetra` acepta.
 *
 * La regla de fondo: es mejor no enseñar letra que enseñar la de otra canción
 * o la de otra versión desacompasada. Por eso cada candidata tiene que ser la
 * misma canción (título), del mismo artista, y de la duración del audio:
 *
 * - ±3 s: esa versión. La letra sincronizada sirve.
 * - de 3 a 15 s: la canción, pero no esa versión (un videoclip con intro). Se
 *   enseña sin sincronizar, para no ir desacompasada.
 * - más de 15 s: otra versión (en directo, extendida…). Fuera.
 * - sin duración en la canción: deciden el título y el artista.
 */

import { limpiarCanal, limpiarTitulo, normalizarArtista } from '../../core/titles.js';

export const MISMA_VERSION_S = 3;
export const MISMA_CANCION_S = 15;
/** La cascada nunca pasa de aquí (§2.2 del plan): LRCLIB va justo de capacidad. */
export const MAX_CONSULTAS_LETRA = 5;

const SEPARADOR = /\s+[-–—]\s+/;

/** Sin tildes, minúsculas, sin signos ni espacios de más. */
function plano(texto) {
    return String(texto ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/** Un título para comparar: limpio de ruido, sin paréntesis ni «feat.». */
function tituloPlano(titulo) {
    const sinParentesis = String(titulo ?? '').replace(/\s*[([【「][^)\]】」]*[)\]】」]/g, ' ');
    const sinFeat = sinParentesis.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0];
    return plano(limpiarTitulo(sinFeat).cancion || sinFeat);
}

/** El primer artista: «KAROL G, Shakira» → «KAROL G». «Simon & Garfunkel» no se parte. */
function primerArtista(artista) {
    return String(artista ?? '').split(/\s*,\s*|\s+(?:feat\.?|ft\.?|featuring|x)\s+/i)[0].trim();
}

/** Artista y título de la canción, de lo que tenga: los separados, o del título de YouTube. */
function nombreDeLaCancion(song) {
    const track = typeof song?.track === 'string' ? song.track.trim() : '';
    const artist = typeof song?.artist === 'string' ? song.artist.trim() : '';
    if (track && artist) return { titulo: track, artista: artist };
    const deducido = limpiarTitulo(song?.title, song?.channel);
    return { titulo: track || deducido.cancion, artista: artist || deducido.artista };
}

/**
 * La canción tal como se compara en cada paso: en el 3 se preguntó al revés
 * («Yellow - Coldplay (Lyrics)»: Coldplay de artista), así que se compara igual.
 */
function nombreEnElPaso(song, paso) {
    const nombre = nombreDeLaCancion(song);
    if (paso !== 3) return nombre;
    return { titulo: nombre.artista, artista: nombre.titulo };
}

/**
 * Las consultas de la cascada (§2.3), de la más precisa a la más suelta, sin
 * repetidas y como mucho cinco:
 * 1. título y artista;
 * 2. título y solo el primer artista;
 * 3. al revés, si el título de YouTube era «A - B» (B artista, A título);
 * 4. búsqueda libre de «título primer-artista»;
 * 5. solo el título (y entonces `elegirLetra` exige la duración).
 */
export function consultasDeLetra(song) {
    const { titulo, artista } = nombreDeLaCancion(song);
    const primero = primerArtista(artista);
    const pasos = [];
    if (titulo && artista) pasos.push([1, { track_name: titulo, artist_name: artista }]);
    if (titulo && primero) pasos.push([2, { track_name: titulo, artist_name: primero }]);

    const original = String(song?.title ?? '');
    if (original.split(SEPARADOR).length === 2) {
        // Lo que se dedujo del título, ya limpio («| Letra», «(Lyrics)»…), pero al revés
        const deducido = limpiarTitulo(original, song?.channel);
        if (deducido.cancion && deducido.artista) pasos.push([3, { track_name: deducido.artista, artist_name: deducido.cancion }]);
    }
    if (titulo && primero) pasos.push([4, { q: `${titulo} ${primero}` }]);
    if (titulo) pasos.push([5, { q: titulo }]);

    const vistas = new Set();
    const salida = [];
    for (const [paso, params] of pasos) {
        const clave = JSON.stringify(Object.entries(params).map(([k, v]) => [k, plano(v)]));
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        salida.push({ paso, params });
    }
    return salida.slice(0, MAX_CONSULTAS_LETRA);
}

/** ¿Es el mismo título? Igual una vez normalizado, o tras quitarle «Artista - » delante. */
function mismoTitulo(candidata, titulo, artista) {
    const buscado = tituloPlano(titulo);
    if (!buscado) return false;
    const suyo = String(candidata ?? '');
    if (tituloPlano(suyo) === buscado) return true;
    // «Coldplay - Yellow (Official Video)»: el artista delante, como en YouTube
    const partes = suyo.split(SEPARADOR);
    if (partes.length >= 2 && mismoArtista(partes[0], artista)) return tituloPlano(partes.slice(1).join(' - ')) === buscado;
    return false;
}

/** ¿Es el mismo artista? El suyo contiene al primero de la canción, o al revés. */
function mismoArtista(suyo, artista) {
    const a = plano(normalizarArtista(limpiarCanal(suyo)));
    const b = plano(normalizarArtista(primerArtista(artista)));
    if (!a || !b) return false;
    const contiene = (x, y) => ` ${x} `.includes(` ${y} `);
    return contiene(a, b) || contiene(b, a);
}

/** Restos de un nombre de fichero en la ficha («Yellow(MP3_160K)», «tema.mp3»): datos de mala calidad. */
const BASURA = /\bmp3\b|_\d{2,3}k\b|\.(?:mp3|m4a|flac|wav|ogg)\b/i;
const esBasura = (candidata) => BASURA.test(String(candidata?.trackName ?? '')) || BASURA.test(String(candidata?.artistName ?? ''));

/**
 * El artista de una ficha, para contarlo: el primero, sin «- Topic», «VEVO»,
 * tildes ni signos. «Luis Fonsi (feat. Daddy Yankee)» y «Luis Fonsi & Daddy
 * Yankee» cuentan como el mismo.
 */
const claveArtista = (artista) => plano(normalizarArtista(primerArtista(limpiarCanal(artista)).split(/\s+&\s+|\s*\(/)[0]));

/**
 * En el paso 5 (solo el título) el artista de la canción no sirve: suele ser
 * el canal que la subió. Pero una versión de otro (Marc Martel cantando
 * «Bohemian Rhapsody») o una coincidencia (otra «Gasolina» de la misma
 * duración) pasarían por buenas. Así que solo vale el artista que más fichas
 * tiene de esa canción con una duración parecida: el original casi siempre
 * tiene muchas, las versiones una o dos. Si hay empate, ninguno.
 */
function artistaDominante(resultados, song) {
    const { titulo, artista } = nombreEnElPaso(song, 5);
    const duracion = Number.isFinite(song?.duration) && song.duration > 0 ? song.duration : null;
    const cuenta = new Map();
    for (const c of resultados) {
        if (!c || esBasura(c) || !mismoTitulo(c.trackName, titulo, artista)) continue;
        if (duracion != null && !(Number.isFinite(c.duration) && Math.abs(c.duration - duracion) <= MISMA_CANCION_S)) continue;
        const clave = claveArtista(c.artistName);
        if (clave) cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    }
    const orden = [...cuenta].sort((a, b) => b[1] - a[1]);
    if (!orden.length || (orden[1] && orden[1][1] === orden[0][1])) return null;
    return orden[0][0];
}

/** La letra sincronizada sin sus marcas de tiempo. */
function sinMarcas(sincronizada) {
    return String(sincronizada ?? '')
        .split('\n')
        .map((linea) => linea.replace(/^(\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\])+\s?/, ''))
        .join('\n')
        .trim();
}

/**
 * Qué se puede hacer con una candidata. Pura.
 * @returns {{ valida: boolean, tipo?: 'synced'|'plain', diferencia: number|null, titulo: boolean, artista: boolean, motivo?: string }}
 */
export function puntuarLetra(candidata, song, { paso = 1, dominante = null } = {}) {
    const { titulo, artista } = nombreEnElPaso(song, paso);
    const sincronizada = typeof candidata?.syncedLyrics === 'string' && candidata.syncedLyrics.trim() ? candidata.syncedLyrics : '';
    const simple = typeof candidata?.plainLyrics === 'string' && candidata.plainLyrics.trim() ? candidata.plainLyrics : '';
    const duracion = Number.isFinite(song?.duration) && song.duration > 0 ? song.duration : null;
    const suya = Number.isFinite(candidata?.duration) && candidata.duration > 0 ? candidata.duration : null;
    const diferencia = duracion != null && suya != null ? Math.abs(duracion - suya) : null;
    const tituloOk = mismoTitulo(candidata?.trackName, titulo, artista);
    const artistaOk = mismoArtista(candidata?.artistName, artista);
    const base = { valida: false, diferencia, titulo: tituloOk, artista: artistaOk };

    if (candidata?.instrumental || (!sincronizada && !simple)) return { ...base, motivo: 'sin letra' };
    if (esBasura(candidata)) return { ...base, motivo: 'ficha basura' };
    if (!tituloOk) return { ...base, motivo: 'otro título' };
    if (paso >= 5) {
        // Solo el título: el artista puede ser el canal que la subió, así que
        // lo que dice que es esa canción es la duración, y tiene que coincidir
        if (diferencia == null || diferencia > MISMA_VERSION_S) return { ...base, motivo: 'sin duración que lo confirme' };
        if (!artistaOk && claveArtista(candidata?.artistName) !== dominante) return { ...base, motivo: 'otro artista, no el de la canción' };
    } else if (!artistaOk) {
        return { ...base, motivo: 'otro artista' };
    }
    if (diferencia != null && diferencia > MISMA_CANCION_S) return { ...base, motivo: 'otra versión' };

    const exacta = diferencia == null || diferencia <= MISMA_VERSION_S;
    if (exacta && sincronizada) return { ...base, valida: true, tipo: 'synced' };
    return { ...base, valida: true, tipo: 'plain' };
}

/**
 * La mejor letra de una respuesta de LRCLIB (`/api/search`), o null si
 * ninguna es de esa canción. Entre las válidas gana la sincronizada y, después,
 * la de duración más parecida.
 * @returns {{ tipo: 'synced'|'plain', texto: string, duracion: number|null } | null}
 */
export function elegirLetra(resultados, song, paso = 1) {
    let mejor = null;
    const lista = Array.isArray(resultados) ? resultados : [];
    const dominante = paso >= 5 ? artistaDominante(lista, song) : null;
    for (const candidata of lista) {
        const p = puntuarLetra(candidata, song, { paso, dominante });
        if (!p.valida) continue;
        const rango = [p.tipo === 'synced' ? 0 : 1, p.diferencia ?? 0];
        if (!mejor || rango[0] < mejor.rango[0] || (rango[0] === mejor.rango[0] && rango[1] < mejor.rango[1])) {
            mejor = { rango, candidata, tipo: p.tipo };
        }
    }
    if (!mejor) return null;
    const { candidata, tipo } = mejor;
    const texto = tipo === 'synced'
        ? candidata.syncedLyrics
        : (candidata.plainLyrics?.trim() ? candidata.plainLyrics : sinMarcas(candidata.syncedLyrics));
    return { tipo, texto, duracion: Number.isFinite(candidata.duration) ? candidata.duration : null };
}
