/**
 * Artista y canción a partir de lo que YouTube llama a un vídeo (plan 11, T2).
 *
 *     limpiarTitulo('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)', 'RickAstleyVEVO')
 *     → { artista: 'Rick Astley', cancion: 'Never Gonna Give You Up', extra: '' }
 *
 * Reglas, no magia: quita el ruido que no describe la canción («Official
 * Video», «[Lyrics]», «HD»…), conserva lo que sí («feat.», «Live», «Remix»),
 * separa por el guion y, si no lo hay, toma el canal como artista. Nunca pierde
 * información: si algo queda vacío, vuelve al original. Lo que falle en casos
 * raros se corrige a mano con el editor (T4).
 */

/**
 * Palabras que no describen la canción. Un paréntesis es ruido si todas sus
 * palabras lo son: así «(Official Music Video)» se va y «(Eclipse)» se queda.
 */
const PALABRAS_RUIDO = new Set([
    'official', 'oficial', 'officiel', 'officielle', 'ufficiale', 'offizielles', 'offizielle',
    'music', 'musik', 'musica', 'música', 'lyric', 'lyrics', 'letra', 'letras', 'paroles', 'testo', 'songtext', 'legendado',
    'video', 'vídeo', 'videoclip', 'clip', 'audio', 'visualizer', 'visualiser', 'full', 'hd', 'hq', '4k', '8k', 'uhd',
    '1080p', '720p', 'mv', 'm/v', 'remaster', 'remastered', 'remasterizado', 'remasterizada', 'explicit', 'clean',
    'musikvideo', 'lyricvideo', 'videoclipe', 'clipe', '官方', '官方mv', '完整版', '高清',
]);

/** Conectores: no bastan para que un paréntesis sea ruido, pero tampoco lo impiden («Con Letra»). */
const CONECTORES = new Set(['with', 'con', 'the', 'de', 'del', 'en', 'in', 'y', 'and', 'et', 'und', 'e']);

/** Lo que describe la canción y se conserva como «extra». */
const CONSERVAR = /\b(live|en\s*directo|en\s*vivo|ac[uú]stic[oa]?|acoustic|remix|mix|cover|versi[oó]n|version|edit|unplugged|instrumental|demo|reprise|sped\s*up|slowed)\b/i;

const palabras = (texto) => texto.toLowerCase().split(/[\s_.,:;!/|+&-]+/).filter(Boolean);

function soloRuido(texto) {
    const lista = palabras(texto);
    return lista.some((w) => PALABRAS_RUIDO.has(w))
        && lista.every((w) => PALABRAS_RUIDO.has(w) || CONECTORES.has(w) || /^\d{4}$/.test(w));
}

const sinRuido = (texto) => texto.split(/\s+/).filter((w) => !PALABRAS_RUIDO.has(w.toLowerCase())).join(' ').trim();

/** feat., ft., featuring, with → «feat.». */
const FEAT = /\b(feat\.?|ft\.?|featuring|with)\s+/i;

const SEPARADOR = /\s+[-–—]\s+/;

/** Limpia el nombre de un canal para usarlo como artista. */
export function limpiarCanal(canal) {
    const original = String(canal ?? '').trim();
    const limpio = original
        .replace(/\s*-\s*topic$/i, '')
        .replace(/vevo$/i, '')
        .replace(/\s+(official|oficial|officiel)(\s+(channel|canal))?$/i, '')
        .replace(/\s+(music|records|tv)$/i, '')
        .trim();
    return limpio || original;
}

/** Quita los paréntesis y corchetes de ruido y aparta los que describen la canción. */
function separarParentesis(texto) {
    const extras = [];
    const limpio = texto.replace(/\s*[([【「]([^)\]】」]*)[)\]】」]/g, (entero, dentro) => {
        const d = dentro.trim();
        if (!d) return '';
        if (FEAT.test(d)) { extras.push(d.replace(FEAT, 'feat. ')); return ''; }
        if (soloRuido(d)) return '';
        if (CONSERVAR.test(d)) { extras.push(sinRuido(d)); return ''; }
        return entero; // un paréntesis que no reconocemos («Part 2», «Eclipse») se queda
    });
    return { limpio: limpio.replace(/\s{2,}/g, ' ').trim(), extras };
}

/** Quita comillas envolventes y ruido suelto al final («… Official Video», «… | Lyrics»). */
function recortar(texto) {
    return texto
        .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
        .replace(/\s+(official\s*(music\s*)?video|official\s*audio|video\s*oficial|audio\s*oficial|lyric\s*video|lyrics?)$/i, '')
        .replace(/\s*[|/]\s*$/, '')
        .trim();
}

/**
 * @returns {{ artista: string, cancion: string, extra: string }}
 */
export function limpiarTitulo(titulo, canal = '') {
    const original = String(titulo ?? '').trim();
    const canalLimpio = limpiarCanal(canal);
    if (!original) return { artista: canalLimpio, cancion: '', extra: '' };

    const { limpio: sinParentesis, extras } = separarParentesis(original);
    // «… | Lyrics», «… | Official Video»: los tramos tras «|» que son solo ruido
    const limpio = sinParentesis.split(/\s+\|\s+/).filter((t, i) => i === 0 || !soloRuido(t)).join(' | ');
    let artista = '';
    let cancion = limpio;

    const partes = limpio.split(SEPARADOR);
    if (partes.length >= 2) {
        artista = partes[0];
        cancion = partes.slice(1).join(' - ');
        // «Canción - Artista»: solo se sabe si el canal es el del artista
        const delCanal = normalizarArtista(canalLimpio);
        const derecha = normalizarArtista(recortar(partes.at(-1)));
        const izquierda = normalizarArtista(recortar(partes[0]));
        if (delCanal && derecha && delCanal.includes(derecha) && !delCanal.includes(izquierda)) {
            artista = partes.at(-1);
            cancion = partes.slice(0, -1).join(' - ');
        }
    }

    // «Canción | Artista» o «Canción | Lyrics»: lo de después del | suele ser ruido
    cancion = recortar(cancion.replace(/\s+\|\s+.*$/, ''));
    artista = recortar(artista);

    // feat. dentro del título sin paréntesis: «Canción ft. X» → extra
    const feat = cancion.match(/\s+(feat\.?|ft\.?|featuring)\s+(.+)$/i);
    if (feat) {
        extras.unshift(`feat. ${feat[2].trim()}`);
        cancion = cancion.slice(0, feat.index).trim();
    }
    const featArtista = artista.match(/\s+(feat\.?|ft\.?|featuring)\s+(.+)$/i);
    if (featArtista) {
        extras.unshift(`feat. ${featArtista[2].trim()}`);
        artista = artista.slice(0, featArtista.index).trim();
    }

    if (!artista) artista = canalLimpio;
    if (!cancion) cancion = original;
    return { artista: artista || canalLimpio, cancion, extra: [...new Set(extras)].join(' · ') };
}

/**
 * Artista para agrupar: sin mayúsculas, sin tildes y sin lo que va tras «feat.».
 * No se corta por «&» ni por comas: «Simon & Garfunkel» y «Tyler, The Creator»
 * son un solo artista.
 */
export function normalizarArtista(artista) {
    return String(artista ?? '')
        .split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Rellena artista y canción de una canción de la biblioteca (plan 11, T3).
 * Prioridad: lo editado a mano (no se toca) > lo que dio YouTube (song.artist /
 * song.track ya presentes) > lo deducido del título. Conserva title y channel
 * originales. Idempotente: completar dos veces no cambia nada.
 */
export function completarMetadatos(song) {
    if (!song || typeof song !== 'object' || song.editado) return song;
    const deducido = limpiarTitulo(song.title, song.channel);
    const artist = (typeof song.artist === 'string' && song.artist.trim()) || deducido.artista;
    const track = (typeof song.track === 'string' && song.track.trim()) || deducido.cancion;
    const extra = typeof song.extra === 'string' ? song.extra : deducido.extra;
    const completa = { ...song, artist, track };
    if (extra) completa.extra = extra; else delete completa.extra;
    return completa;
}

/** Lo que se muestra de una canción: con respaldo a title y channel si aún no está completada. */
export function nombreDe(song) {
    return {
        titulo: song?.track || song?.title || 'Sin título',
        artista: song?.artist || song?.channel || '',
        extra: song?.extra || '',
    };
}

export const MAX_NOMBRE = 120;

/**
 * Aplica lo escrito en el editor (plan 11, T4). Devuelve la canción editada, o
 * null si algo no vale: vacío o más de MAX_NOMBRE caracteres.
 */
export function editarCancion(song, { artista, cancion }) {
    const a = String(artista ?? '').replace(/\s+/g, ' ').trim();
    const c = String(cancion ?? '').replace(/\s+/g, ' ').trim();
    if (!a || !c || a.length > MAX_NOMBRE || c.length > MAX_NOMBRE) return null;
    return { ...song, artist: a, track: c, editado: true };
}

/** Vuelve a lo automático: lo deducido del título y el canal de YouTube. */
export function restaurarCancion(song) {
    const resto = { ...song };
    for (const campo of ['artist', 'track', 'extra', 'editado']) delete resto[campo];
    return completarMetadatos(resto);
}

