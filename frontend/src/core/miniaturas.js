/**
 * Miniaturas fuera de la canción (plan 19, T2).
 *
 * La APK guardaba cada miniatura en base64 dentro de la canción (~25-30 KB):
 * con 300 canciones, la biblioteca pesaba megas, se leía y se guardaba entera
 * en cada cambio, y la lista de la biblioteca llevaba 18 MB de HTML. Ahora es un
 * fichero (`DATA/miniaturas/<clave>.<ext>`) y la canción guarda su dirección,
 * como ya hace con el audio. Es la misma imagen: nada cambia a la vista, y sigue
 * funcionando sin conexión.
 *
 * En la web las miniaturas ya eran enlaces: no cambia.
 *
 * Dos tamaños (tras la 2.1.1): la carátula que trae un fichero importado es
 * grande (1280×720 en PNG de más de 1 MB, la que incrusta yt-dlp, o 1400 px), y
 * la Biblioteca la pintaba en 40 px. El móvil la descomprimía entera por cada
 * fila: en una traza del WebView, 20 s de scroll gastaban 1,1 s descomprimiendo
 * con las grandes y 27 ms con miniaturas pequeñas, y el scroll iba a tirones
 * hasta tenerlas todas. Ahora las listas usan una miniatura de LADO_MINIATURA
 * px y la original se queda como `caratula`, para el reproductor y la portada.
 */

import { isNative } from '../config/env.js';

export const CARPETA = 'miniaturas';
export const BANDERA = 'ytdl_miniaturas_v1';
/** La migración de las miniaturas pequeñas (tras la 2.1.1), hecha. */
export const BANDERA_PEQUENAS = 'ytdl_miniaturas_pequenas_v1';
const RE_VIDEO_ID = /^[\w-]{11}$/;

/** ¿Es una miniatura en base64 dentro de la canción? */
export const esIncrustada = (t) => typeof t === 'string' && t.startsWith('data:image/');

/** La miniatura de YouTube de un vídeo, o '' si el id no es de YouTube. */
export const miniaturaDeYoutube = (videoId) => (RE_VIDEO_ID.test(videoId ?? '') ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '');

/** La extensión del fichero según el tipo del base64. */
export function extensionDe(dataUrl) {
    const tipo = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(dataUrl ?? '')?.[1]?.toLowerCase();
    return { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' }[tipo] ?? 'jpg';
}

/** Un nombre de fichero seguro y estable para una miniatura. */
export function claveDe(song, extra = '') {
    const base = RE_VIDEO_ID.test(song?.videoId ?? '') ? song.videoId : `s${hash(String(song?.src ?? song?.title ?? ''))}`;
    return `${base}${extra ? `_${String(extra).replace(/[^\w-]/g, '')}` : ''}`;
}

function hash(texto) {
    let h = 5381;
    for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

/** La miniatura de un favorito: siempre el enlace de YouTube (viaja a la cuenta; nunca un base64 ni un fichero de este móvil). */
export function miniaturaDeFavorito(miniatura, videoId) {
    if (typeof miniatura === 'string' && miniatura.startsWith('https://') && miniatura.length <= 500) return miniatura;
    return miniaturaDeYoutube(videoId);
}

const fs = () => globalThis.Capacitor?.Plugins?.Filesystem ?? null;

/** El lado corto de la miniatura de las listas: 40-56 px en pantalla, ×3 en un móvil denso, y las tarjetas de las listas. */
export const LADO_MINIATURA = 240;
/** Hasta aquí (la mqdefault de YouTube, 320×180) una imagen se usa tal cual. */
const PIXELES_SIN_REDUCIR = 320 * 320;

/** Las medidas de la miniatura pequeña de una imagen, o null si ya es pequeña. Pura. */
export function medidasMiniatura(ancho, alto, lado = LADO_MINIATURA) {
    if (!(ancho > 0 && alto > 0) || ancho * alto <= PIXELES_SIN_REDUCIR) return null;
    const escala = lado / Math.min(ancho, alto);
    if (escala >= 1) return null;
    return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/** La miniatura pequeña de una imagen (base64 o dirección de la app), en JPEG; null si no hace falta. */
async function miniaturaPequena(origen) {
    const img = new Image();
    img.src = origen;
    await img.decode();
    const medidas = medidasMiniatura(img.naturalWidth, img.naturalHeight);
    if (!medidas) return null;
    const lienzo = document.createElement('canvas');
    lienzo.width = medidas.ancho;
    lienzo.height = medidas.alto;
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, medidas.ancho, medidas.alto);
    return lienzo.toDataURL('image/jpeg', 0.85);
}

/** Escribe un base64 en DATA, comprueba que no está vacío y da su dirección para el WebView. */
async function escribir(Filesystem, path, dataUrl) {
    try { await Filesystem.mkdir({ path: CARPETA, directory: 'DATA', recursive: true }); } catch { /* ya existe */ }
    await Filesystem.writeFile({ path, data: dataUrl.slice(dataUrl.indexOf(',') + 1), directory: 'DATA' });
    const info = await Filesystem.stat({ path, directory: 'DATA' });
    if (!(Number(info?.size) > 0)) throw new Error(`miniatura vacía: ${path}`);
    const { uri } = await Filesystem.getUri({ path, directory: 'DATA' });
    return globalThis.Capacitor.convertFileSrc(uri);
}

/** La ruta de la miniatura pequeña de una imagen guardada. */
export const rutaPequena = (path) => `${path.replace(/\.[a-z0-9]+$/i, '')}_m.jpg`;

/** La miniatura pequeña junto a una imagen ya guardada: los campos para la canción, o null si no hace falta. */
async function conPequena(Filesystem, path, origen, url) {
    const pequena = await miniaturaPequena(origen).catch((e) => { console.debug('[Miniaturas] Sin reducir:', e); return null; });
    if (!pequena) return null;
    const ruta = rutaPequena(path);
    return { thumbnail: await escribir(Filesystem, ruta, pequena), localThumbnailPath: ruta, caratula: url, localCaratulaPath: path };
}

/**
 * Guarda una miniatura (base64) como fichero de la APK. Devuelve
 * { thumbnail, localThumbnailPath } y, si la imagen es grande, también
 * { caratula, localCaratulaPath }: la original, mientras `thumbnail` pasa a
 * ser la pequeña. null fuera de la APK. Comprueba que cada fichero existe y no
 * está vacío antes de dar su dirección.
 */
export async function guardarMiniaturaNativa(clave, dataUrl) {
    const Filesystem = fs();
    if (!isNative() || !Filesystem || !esIncrustada(dataUrl)) return null;
    const path = `${CARPETA}/${clave}.${extensionDe(dataUrl)}`;
    const url = await escribir(Filesystem, path, dataUrl);
    return await conPequena(Filesystem, path, dataUrl, url) ?? { thumbnail: url, localThumbnailPath: path };
}

/**
 * A una canción con su carátula grande ya guardada (de antes de las dos
 * medidas) le hace la miniatura pequeña. Los campos nuevos, o null si su
 * imagen ya era pequeña o no está.
 */
export async function reducirMiniaturaGuardada(song) {
    const Filesystem = fs();
    const path = song?.localThumbnailPath;
    if (!isNative() || !Filesystem || typeof path !== 'string' || !path.startsWith(`${CARPETA}/`) || song.localCaratulaPath) return null;
    const { uri } = await Filesystem.getUri({ path, directory: 'DATA' });
    const url = globalThis.Capacitor.convertFileSrc(uri);
    return conPequena(Filesystem, path, url, url);
}

/** Cada cuántas miniaturas hechas se guarda la biblioteca durante la migración. */
const LOTE_PEQUENAS = 10;

/**
 * Hace las miniaturas que falten y las pone en la biblioteca y las listas.
 * Las dependencias se pasan: la biblioteca y las listas viven en features/,
 * y así se prueba sin la APK (features/library/miniaturas-pequenas.js la arranca).
 * @returns {Promise<{ hechas: number, fallos: number }>}
 */
export async function reducirMiniaturas({
    almacen, getLibrary, saveLibrary, leerListas, guardarListas, reducir = reducirMiniaturaGuardada, turno = async () => {},
}) {
    if (await almacen.get(BANDERA_PEQUENAS)) return { hechas: 0, fallos: 0 };

    // Se pone al día la biblioteca, y las copias de las listas, sobre lo que haya ahora
    const aplicar = async (hechas) => {
        if (!hechas.size) return;
        const pasar = (s) => (s && !s.localCaratulaPath && hechas.has(s.localThumbnailPath) ? { ...s, ...hechas.get(s.localThumbnailPath) } : s);
        await saveLibrary((await getLibrary()).map(pasar));
        const listas = await leerListas();
        if (listas.some((pl) => (pl.songs ?? []).some((s) => s && !s.localCaratulaPath && hechas.has(s.localThumbnailPath)))) {
            await guardarListas(listas.map((pl) => (Array.isArray(pl?.songs) ? { ...pl, songs: pl.songs.map(pasar) } : pl)));
        }
    };

    // Los ficheros, uno por carátula y cediendo el turno entre una y otra (lo
    // lento). Se guarda de LOTE_PEQUENAS en LOTE_PEQUENAS: si se cierra la app a
    // medias, lo hecho no se repite
    const rutas = new Set((await getLibrary()).filter((s) => s?.localThumbnailPath && !s.localCaratulaPath).map((s) => s.localThumbnailPath));
    let lote = new Map(); // ruta de la grande → campos nuevos
    let hechas = 0;
    let fallos = 0;
    for (const ruta of rutas) {
        await turno();
        try {
            const campos = await reducir({ localThumbnailPath: ruta });
            if (campos) { lote.set(ruta, campos); hechas++; }
        } catch (e) {
            console.warn('[Miniaturas] Sin reducir', ruta, e);
            fallos++;
        }
        if (lote.size >= LOTE_PEQUENAS) { await aplicar(lote); lote = new Map(); }
    }
    await aplicar(lote);
    if (!fallos) await almacen.set(BANDERA_PEQUENAS, new Date().toISOString());
    return { hechas, fallos };
}

/** Borra los ficheros de la miniatura y la carátula guardadas por la app (no hace nada con enlaces). */
export async function borrarMiniaturaNativa(song) {
    const Filesystem = fs();
    if (!Filesystem) return;
    for (const path of [song?.localThumbnailPath, song?.localCaratulaPath]) {
        if (typeof path !== 'string' || !path.startsWith(`${CARPETA}/`)) continue;
        try { await Filesystem.deleteFile({ path, directory: 'DATA' }); } catch { /* ya no estaba */ }
    }
}

/**
 * Migración única: los base64 de la biblioteca y de las listas pasan a fichero;
 * los de los favoritos, al enlace de YouTube. Un base64 se sustituye **solo**
 * si su fichero se escribió y existe; si alguno falla, se queda como estaba y
 * la migración se repite en el próximo arranque (sin la bandera). Volver a
 * ejecutarla no cambia nada.
 *
 * En dos fases: primero se escriben los ficheros (lo lento, segundos con
 * cientos de canciones) y después se vuelve a leer cada colección y se
 * sustituye de golpe. Así no se pisa lo que haya cambiado mientras tanto (una
 * descarga que termina, un favorito, la sincronización).
 *
 * @param {{ get, set }} almacen  StorageModule o un doble en las pruebas
 * @param {(clave, dataUrl) => Promise<{thumbnail, localThumbnailPath}|null>} guardar
 * @returns {Promise<{ hechas: number, fallos: number }>}
 */
export async function migrarMiniaturas(almacen, guardar = guardarMiniaturaNativa) {
    if (await almacen.get(BANDERA)) return { hechas: 0, fallos: 0 };

    // 1. Los ficheros, uno por canción: las copias de una canción en las listas
    //    comparten el suyo, pero dos canciones distintas nunca (borrar una no
    //    puede dejar a la otra sin miniatura, aunque la imagen fuera la misma)
    const pendientes = new Map(); // clave → base64
    const apuntar = (song) => {
        if (esIncrustada(song?.thumbnail) && !pendientes.has(claveDe(song))) pendientes.set(claveDe(song), song.thumbnail);
    };
    ((await almacen.get('ytdl_library')) || []).forEach(apuntar);
    ((await almacen.get('ytdl_playlists')) || []).forEach((pl) => (pl?.songs ?? []).forEach(apuntar));
    const hechos = new Map(); // clave → { thumbnail, localThumbnailPath }
    let fallos = 0;
    for (const [clave, datos] of pendientes) {
        try {
            const r = await guardar(clave, datos);
            if (r) hechos.set(clave, r); else fallos++;
        } catch (e) {
            console.warn('[Miniaturas]', e);
            fallos++;
        }
    }

    // 2. Sustituir, sobre lo que haya ahora
    const pasar = (song) => (esIncrustada(song?.thumbnail) && hechos.has(claveDe(song)) ? { ...song, ...hechos.get(claveDe(song)) } : song);
    if (hechos.size) {
        const biblioteca = (await almacen.get('ytdl_library')) || [];
        await almacen.set('ytdl_library', biblioteca.map(pasar));
        const listas = (await almacen.get('ytdl_playlists')) || [];
        await almacen.set('ytdl_playlists', listas.map((pl) => (Array.isArray(pl?.songs) ? { ...pl, songs: pl.songs.map(pasar) } : pl)));
    }
    const favoritos = (await almacen.get('favorites')) || [];
    if (favoritos.some((f) => esIncrustada(f?.thumbnail))) {
        await almacen.set('favorites', favoritos.map((f) => (esIncrustada(f?.thumbnail)
            ? { ...f, thumbnail: miniaturaDeFavorito(null, f.videoId ?? f.id) } : f)));
    }
    if (!fallos) await almacen.set(BANDERA, new Date().toISOString());
    return { hechas: hechos.size, fallos };
}

/** Al arrancar la APK: la migración, sin bloquear el primer pintado. En la web no hace nada. */
export async function migrarMiniaturasAlArrancar(almacen) {
    if (!isNative() || !fs()) return { hechas: 0, fallos: 0 };
    return migrarMiniaturas(almacen);
}
