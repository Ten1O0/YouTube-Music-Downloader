/**
 * Leer una lista traída de otro servicio (plan 15, T1).
 *
 * Dos entradas, las dos puras y sin red: un CSV exportado (Exportify,
 * TuneMyMusic, Soundiiz, Apple Music…) y texto pegado, una canción por línea.
 * Las dos devuelven lo mismo:
 *
 *     [{ titulo, artista, artistas, duracionMs, isrc, album }]
 *
 * - `artista` es el principal, el que va en la búsqueda.
 * - `artistas` son todos, para puntuar (plan 15, §2.3): basta con que aparezca
 *   cualquiera de ellos en el canal o en el título.
 * - `duracionMs` e `isrc` son `null` cuando no se saben, para que la puntuación
 *   no los cuente en vez de contarlos como un fallo.
 *
 * Lo que llega de un fichero es dato externo (plan 15, §3): cada campo sale sin
 * caracteres de control y recortado a 200 caracteres. El fichero no sale del
 * dispositivo; al servidor solo irán título, artista, duración e ISRC.
 */

/** Tope de tamaño del fichero (plan 15, §3). */
export const MAX_BYTES = 2 * 1024 * 1024;

/** Tope de canciones por importación: cada una es una búsqueda en el servidor. */
export const MAX_CANCIONES = 500;

/** Tope de cada campo de texto. */
export const MAX_CAMPO = 200;

/** Error con un código traducible, para que la interfaz sepa qué decir. */
export class ErrorImportacion extends Error {
    constructor(codigo, detalle = '') {
        super(detalle || codigo);
        this.name = 'ErrorImportacion';
        this.codigo = codigo;
    }
}

// ========================================
// Limpieza de campos
// ========================================

/** Texto limpio: sin caracteres de control, espacios unidos, recortado. */
export function limpiarCampo(valor, maximo = MAX_CAMPO) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximo)
        .trim();
}

/**
 * ISRC: dos letras de país, tres de registrante, dos del año y cinco de número.
 * Algunas exportaciones lo traen con guiones o en minúsculas. Lo que no encaje
 * se descarta: un ISRC falso haría que la búsqueda exacta fallase sin motivo.
 */
export function limpiarIsrc(valor) {
    const isrc = String(valor ?? '').replace(/[-\s]/g, '').toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : null;
}

/**
 * Duración en milisegundos.
 *
 * - Si la columna dice que va en milisegundos («Duration (ms)»), se toma tal cual.
 * - «3:45» o «1:02:03» se leen como reloj.
 * - Un número suelto es ambiguo: por encima de 36.000 se toma por milisegundos
 *   (serían 10 horas en segundos, que no es una canción) y por debajo, segundos.
 */
export function leerDuracion(valor, { enMs = false } = {}) {
    const texto = String(valor ?? '').trim();
    if (!texto) return null;
    if (texto.includes(':')) {
        const partes = texto.split(':').map((p) => Number(p));
        if (partes.some((p) => !Number.isFinite(p) || p < 0) || partes.length > 3) return null;
        const segundos = partes.reduce((total, p) => total * 60 + p, 0);
        return segundos > 0 ? Math.round(segundos * 1000) : null;
    }
    const n = Number(texto.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    if (enMs || n > 36_000) return Math.round(n);
    return Math.round(n * 1000);
}

/**
 * Separa varios artistas. `;` separa siempre. La coma solo separa si no la sigue
 * un espacio: así se parten las listas de Exportify («Bad Bunny,Drake») sin
 * romper nombres que llevan coma («Tyler, The Creator», «Earth, Wind & Fire»).
 */
export function separarArtistas(valor) {
    return limpiarCampo(valor)
        .split(/\s*;\s*|,(?!\s)/)
        .map((a) => a.trim())
        .filter(Boolean);
}

/** Una canción con todos sus campos limpios, o null si no tiene título. */
function cancion({ titulo, artistas, duracionMs = null, isrc = null, album = '' }) {
    const t = limpiarCampo(titulo);
    if (!t) return null;
    const lista = (artistas ?? []).map((a) => limpiarCampo(a)).filter(Boolean);
    return {
        titulo: t,
        artista: lista[0] ?? '',
        artistas: lista,
        duracionMs: Number.isFinite(duracionMs) && duracionMs > 0 ? duracionMs : null,
        isrc: isrc ? limpiarIsrc(isrc) : null,
        album: limpiarCampo(album),
    };
}

// ========================================
// CSV (RFC 4180)
// ========================================

const SEPARADORES = [',', ';', '\t'];

/**
 * El separador del CSV, mirando la primera línea sin contar lo que va entre
 * comillas. Excel en castellano exporta con `;`; algunas herramientas, con
 * tabuladores.
 */
export function detectarSeparador(texto) {
    const cuenta = { ',': 0, ';': 0, '\t': 0 };
    let entreComillas = false;
    for (const c of texto) {
        if (c === '"') entreComillas = !entreComillas;
        else if (!entreComillas && (c === '\n' || c === '\r')) break;
        else if (!entreComillas && c in cuenta) cuenta[c]++;
    }
    return SEPARADORES.reduce((mejor, s) => (cuenta[s] > cuenta[mejor] ? s : mejor), ',');
}

/**
 * Parte un CSV en filas y campos según RFC 4180: campos entre comillas con
 * comas, saltos de línea y comillas dobladas (`""`) dentro, y finales de línea
 * CRLF, LF o CR. Una comilla sin cerrar se toma como texto hasta el final, en
 * vez de perder el resto del fichero.
 */
export function partirCsv(texto, separador = detectarSeparador(texto)) {
    const filas = [];
    let fila = [];
    let campo = '';
    let entreComillas = false;
    let i = 0;
    const n = texto.length;

    const cerrarCampo = () => { fila.push(campo); campo = ''; };
    const cerrarFila = () => {
        cerrarCampo();
        // Una línea vacía (sin nada ni separadores) no es una fila
        if (!(fila.length === 1 && fila[0] === '')) filas.push(fila);
        fila = [];
    };

    while (i < n) {
        const c = texto[i];
        if (entreComillas) {
            if (c === '"') {
                if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
                entreComillas = false;
            } else {
                campo += c;
            }
            i++;
            continue;
        }
        if (c === '"' && campo === '') { entreComillas = true; i++; continue; }
        if (c === separador) { cerrarCampo(); i++; continue; }
        if (c === '\r' || c === '\n') {
            cerrarFila();
            i += c === '\r' && texto[i + 1] === '\n' ? 2 : 1;
            continue;
        }
        campo += c;
        i++;
    }
    if (campo !== '' || fila.length) cerrarFila();
    return filas;
}

/** Nombre de columna comparable: sin mayúsculas, sin tildes y solo letras y números. */
const normalizarColumna = (nombre) => String(nombre ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * Columnas que se reconocen, por orden de preferencia. La comparación es
 * **exacta** tras normalizar, no «contiene»: «Album Artist Name(s)» no debe
 * tomarse por el artista, ni «Artist URI(s)» tampoco.
 */
const COLUMNAS = {
    titulo: ['trackname', 'tracktitle', 'songname', 'title', 'name', 'song', 'track', 'cancion', 'titulo', 'nombre'],
    artista: ['artistnames', 'artistname', 'artists', 'artist', 'artistas', 'artista', 'interprete'],
    duracion: ['trackdurationms', 'durationms', 'duration', 'time', 'length', 'duracion', 'tiempo'],
    isrc: ['isrc'],
    album: ['albumname', 'album'],
};

/** Qué columna es cada campo. -1 si no está. */
export function reconocerColumnas(cabecera) {
    const nombres = cabecera.map(normalizarColumna);
    const indices = {};
    for (const [campo, alias] of Object.entries(COLUMNAS)) {
        indices[campo] = -1;
        for (const a of alias) {
            const i = nombres.indexOf(a);
            if (i !== -1) { indices[campo] = i; break; }
        }
    }
    // La duración va en milisegundos si el nombre lo dice («Duration (ms)»)
    indices.duracionEnMs = indices.duracion !== -1 && /ms$/.test(nombres[indices.duracion]);
    return indices;
}

/** Quita la marca BOM que añaden Excel y algunas exportaciones al principio. */
const sinBom = (texto) => (texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto);

function comprobarTamano(texto) {
    if (typeof texto !== 'string') throw new ErrorImportacion('vacio');
    // Un carácter puede ocupar varios bytes, pero para un tope de 2 MB basta
    if (texto.length > MAX_BYTES) throw new ErrorImportacion('demasiado_grande');
}

/**
 * Las canciones de un CSV exportado.
 * Lanza ErrorImportacion si no hay cabecera o no hay columna de título.
 */
export function leerCsv(texto) {
    comprobarTamano(texto);
    const filas = partirCsv(sinBom(texto));
    if (!filas.length) throw new ErrorImportacion('vacio');

    const col = reconocerColumnas(filas[0]);
    if (col.titulo === -1) throw new ErrorImportacion('sin_titulo');

    const campo = (fila, i) => (i >= 0 && i < fila.length ? fila[i] : '');
    return filas.slice(1)
        .map((fila) => cancion({
            titulo: campo(fila, col.titulo),
            artistas: separarArtistas(campo(fila, col.artista)),
            duracionMs: leerDuracion(campo(fila, col.duracion), { enMs: col.duracionEnMs }),
            isrc: campo(fila, col.isrc),
            album: campo(fila, col.album),
        }))
        .filter(Boolean);
}

// ========================================
// Texto pegado
// ========================================

/** «Artista - Canción», con guion, semirraya o raya, siempre con espacios alrededor. */
const SEPARADOR_TEXTO = /\s+[-–—]\s+/;

/**
 * Numeración inicial: «1. », «01) », «12.». Solo con punto o paréntesis: con
 * guion no, porque «311 - Amber» es el grupo 311, no la canción número 311.
 * Tampoco un número suelto: «10 Years - Wasteland» es un grupo.
 */
const NUMERACION = /^\s*\d{1,4}[.)]\s+/;

/**
 * Las canciones de un texto pegado, una por línea: «Artista - Canción».
 * Se parte por el primer separador, así que «Queen - Bohemian Rhapsody -
 * Remastered 2011» es de Queen. Una línea sin separador es solo título.
 */
export function leerTexto(texto) {
    comprobarTamano(texto);
    return sinBom(texto)
        .split(/\r\n|\r|\n/)
        .map((linea) => linea.replace(NUMERACION, '').trim())
        .filter(Boolean)
        .map((linea) => {
            const partes = linea.split(SEPARADOR_TEXTO);
            if (partes.length < 2) return cancion({ titulo: linea, artistas: [] });
            return cancion({ titulo: partes.slice(1).join(' - '), artistas: separarArtistas(partes[0]) });
        })
        .filter(Boolean);
}

/**
 * Deja una importación dentro del tope de canciones.
 * @returns `{ canciones, sobran }`, para poder avisar de cuántas se quedan fuera.
 */
export function recortarImportacion(canciones, maximo = MAX_CANCIONES) {
    const lista = Array.isArray(canciones) ? canciones : [];
    return { canciones: lista.slice(0, maximo), sobran: Math.max(0, lista.length - maximo) };
}

/** Nombre para la lista a partir del fichero: sin extensión y sin guiones bajos. */
export function nombreDesdeFichero(nombre) {
    const base = String(nombre ?? '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
    return limpiarCampo(base, 80);
}
