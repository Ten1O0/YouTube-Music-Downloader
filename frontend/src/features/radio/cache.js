/**
 * La caché de la radio (plan 16, §2.4 y §2.5).
 *
 * Las canciones de radio se descargan por el camino de siempre, pero su audio
 * viene aquí, no a la biblioteca ni al historial: en la web, un blob de
 * IndexedDB con la clave `radio:<videoId>`; en la APK, un fichero de
 * `DATA/radio/`, privado de la app. Como mucho 10 canciones o 150 MB: al
 * pasarse, sale la más antigua (nunca la que suena).
 *
 * «Guardar» la lleva a la biblioteca sin volver a descargarla: el audio ya
 * está aquí, solo cambia de sitio, y la canción queda idéntica a una
 * descargada a mano (misma entrada de biblioteca, historial, sonoridad).
 */

import { apiBase, isNative } from '../../config/env.js';
import { IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { claveDe, guardarMiniaturaNativa } from '../../core/miniaturas.js';
import { StorageModule } from '../../core/storage.js';
import { esIdYoutube, extractVideoId, sanitizeFilename } from '../../core/utils.js';
import { downloadOfflineThumbnail, writeBlobToNativeFilesystem } from '../../native/filesystem.js';
import { buildHistoryEntry, entradaDeBiblioteca } from '../download/download.js';
import { bajarAudio, entregarFichero } from '../download/save.js';
import { addToHistory } from '../history.js';
import { LibraryModule } from '../library/library.js';
import { PREFIJO, cancionDeRadio, sobrantes } from './cache-modelo.js';

export const CLAVE_CACHE_RADIO = 'radio_cache';
const CARPETA = 'radio';

const fs = () => globalThis.Capacitor?.Plugins?.Filesystem ?? null;
const enLaApk = () => isNative() && Boolean(fs());

// Las escrituras del índice, de una en una: la radio baja tres canciones a la vez
let turno = Promise.resolve();
function enOrden(fn) {
    const hecho = turno.then(fn, fn);
    turno = hecho.catch(() => {});
    return hecho;
}
const leer = async () => (await StorageModule.get(CLAVE_CACHE_RADIO)) || [];
const escribir = (lista) => StorageModule.set(CLAVE_CACHE_RADIO, lista);

// Lo que no se puede borrar ahora (lo que suena): lo decide la radio
let protegidas = () => new Set();
export function protegerCon(fn) {
    protegidas = fn;
}

async function borrarAudio(entrada) {
    try {
        if (entrada.ruta && fs()) await fs().deleteFile({ path: entrada.ruta, directory: 'DATA' });
        else await StorageModule.deleteBlob(`${PREFIJO}${entrada.videoId}`);
    } catch { /* ya no estaba */ }
}

/** Deja la caché en su tope. */
export function recortarCache() {
    return enOrden(async () => {
        const lista = await leer();
        const fuera = sobrantes(lista, { proteger: protegidas() });
        if (!fuera.length) return 0;
        for (const e of fuera) await borrarAudio(e);
        await escribir(lista.filter((e) => !fuera.includes(e)));
        return fuera.length;
    });
}

/** Al apagar la radio: todo fuera, menos lo que suena. */
export function vaciarCache() {
    return enOrden(async () => {
        const lista = await leer();
        const proteger = protegidas();
        const fuera = lista.filter((e) => !proteger.has(e.videoId));
        for (const e of fuera) await borrarAudio(e);
        await escribir(lista.filter((e) => proteger.has(e.videoId)));
    });
}

/** Las canciones que hay en la caché (sin las ya guardadas), de la más antigua a la más nueva. */
export async function enCache() {
    return (await leer()).filter((e) => !e.guardada).sort((a, b) => a.en - b.en).map(cancionDeRadio);
}

/**
 * Recoge una descarga terminada de la radio: baja el audio y lo deja en la
 * caché. Es el `recoger` que la radio da a la descarga en silencio y a los
 * lotes. Devuelve la canción lista para la cola.
 */
export async function guardarEnCache({ download_id, url, videoInfo = {}, finalProgressData = {} }) {
    const videoId = [videoInfo.videoId, videoInfo.id, finalProgressData.video_id, extractVideoId(url)].find(esIdYoutube);
    if (!videoId) throw new Error('Canción de radio sin id de YouTube');
    const { blob, extension } = await bajarAudio(`${apiBase()}/api/download/${download_id}`);
    let ruta = null;
    if (enLaApk()) {
        ruta = `${CARPETA}/${videoId}${extension}`;
        try { await fs().mkdir({ path: CARPETA, directory: 'DATA', recursive: true }); } catch { /* ya existe */ }
        await writeBlobToNativeFilesystem(fs(), ruta, null, blob);
        fetch(`${apiBase()}/api/download/${download_id}`, { method: 'DELETE' }).catch(() => {});
    } else if (!await StorageModule.putBlob(`${PREFIJO}${videoId}`, blob)) {
        throw new Error('Sin espacio para la radio');
    }
    // Lo justo para reproducirla y, si gusta, guardarla igual que una descarga normal
    const meta = {
        url,
        videoInfo: { videoId, title: videoInfo.title, channel: videoInfo.channel, thumbnail: videoInfo.thumbnail, duration: videoInfo.duration ?? null },
        finalProgressData: pick(finalProgressData, ['title', 'channel', 'artist', 'track', 'thumbnail', 'loudness', 'video_id']),
    };
    const entrada = { videoId, bytes: blob.size, extension, en: Date.now(), ...(ruta ? { ruta } : {}), meta };
    await enOrden(async () => {
        const lista = (await leer()).filter((e) => e.videoId !== videoId);
        await escribir([...lista, entrada]);
    });
    await recortarCache();
    return cancionDeRadio(entrada);
}

function pick(obj, claves) {
    return Object.fromEntries(claves.filter((k) => obj?.[k] !== undefined && obj[k] !== null).map((k) => [k, obj[k]]));
}

/**
 * «Guardar»: de la caché a la biblioteca, sin volver a descargar (§2.5). En la
 * web, el blob pasa a la clave de la biblioteca y se entrega el fichero, como
 * en una descarga normal; en la APK, el fichero se copia a DATA con el nombre
 * de las descargas y, como ellas, a Documentos/YTMusic (se copia y no se
 * mueve: puede estar sonando). Devuelve la canción de la biblioteca, o null si
 * ya no estaba en la caché.
 */
export async function aBiblioteca(videoId) {
    const entrada = (await leer()).find((e) => e.videoId === videoId && !e.guardada);
    if (!entrada) return null;
    const { url, videoInfo, finalProgressData } = entrada.meta;
    const nombre = `${sanitizeFilename(finalProgressData.title || videoInfo.title || 'audio')}${entrada.extension}`;
    let streamUrl;
    let localPath = null;
    let miniatura = null;

    if (entrada.ruta && enLaApk()) {
        localPath = `imported_radio_${videoId}_${nombre}`;
        await fs().copy({ from: entrada.ruta, directory: 'DATA', to: localPath, toDirectory: 'DATA' });
        try {
            await fs().mkdir({ path: 'YTMusic', directory: 'DOCUMENTS', recursive: true });
        } catch { /* ya existe */ }
        try {
            await fs().copy({ from: entrada.ruta, directory: 'DATA', to: `YTMusic/${nombre}`, toDirectory: 'DOCUMENTS' });
        } catch (e) { console.debug('[Radio] Sin copia pública en Documentos:', e); }
        streamUrl = globalThis.Capacitor.convertFileSrc((await fs().getUri({ path: localPath, directory: 'DATA' })).uri);
        // La carátula, en fichero como las demás (plan 19, T2)
        try {
            const dataUrl = await downloadOfflineThumbnail(finalProgressData.thumbnail || videoInfo.thumbnail);
            miniatura = await guardarMiniaturaNativa(claveDe({ videoId }, 'radio'), dataUrl);
        } catch (e) { console.warn('[Radio] Sin miniatura en fichero:', e); }
    } else {
        const blob = await StorageModule.getBlob(`${PREFIJO}${videoId}`);
        if (!blob || !await StorageModule.putBlob(videoId, blob)) return null;
        streamUrl = `${IDB_SRC_PREFIX}${videoId}`;
        entregarFichero(blob, nombre);
    }

    addToHistory(buildHistoryEntry(url, videoInfo, finalProgressData));
    const anadida = await LibraryModule.addSong(entradaDeBiblioteca({ streamUrl, localPath, miniatura, url, videoInfo, finalProgressData }));

    // Fuera de la caché: en la web ya; en la APK, el fichero al recortar (puede estar sonando)
    await enOrden(async () => {
        const lista = await leer();
        const i = lista.findIndex((e) => e.videoId === videoId);
        if (i < 0) return;
        if (entrada.ruta) lista[i] = { ...lista[i], guardada: true };
        else {
            await StorageModule.deleteBlob(`${PREFIJO}${videoId}`).catch(() => {});
            lista.splice(i, 1);
        }
        await escribir(lista);
    });
    return anadida ?? null;
}
