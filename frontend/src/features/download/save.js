/**
 * Guardar el audio descargado: en IndexedDB en el navegador, como fichero en la
 * APK.
 */

import { apiBase } from '../../config/env.js';
import { IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { generateSongId } from '../../core/songs.js';
import { StorageModule } from '../../core/storage.js';
import { claveDe, guardarMiniaturaNativa } from '../../core/miniaturas.js';
import { extFromResponse, sanitizeFilename } from '../../core/utils.js';
import { i18n } from '../../i18n/language-manager.js';
import { downloadOfflineThumbnail, writeBlobToNativeFilesystem } from '../../native/filesystem.js';
import { showStatus, updateProgress } from '../../ui/status.js';

export async function saveDownloadToApp(download_id, videoInfo, downloadUrl, finalProgressData) {
    let streamUrl = `${apiBase()}/api/stream/${download_id}`;
    let localPath = null;
    let miniatura = null; // { thumbnail, localThumbnailPath } en la APK (plan 19, T2)

    if (globalThis.Capacitor?.isNative && globalThis.Capacitor?.Plugins?.Filesystem) {
        updateProgress(100, 'Guardando en la app...');
        try {
            const res = await saveToNativeCapacitor(download_id, videoInfo, downloadUrl, finalProgressData);
            streamUrl = res.streamUrl;
            localPath = res.localPath;
            miniatura = res.miniatura;
        } catch (err) {
            console.error("Error en modo offline:", err);
            showStatus(i18n.t('dl_offline_fallback'), 'error');
        }
    } else {
        // Camino web. Antes hacía `location.href = downloadUrl`, y eso tenía dos
        // problemas encadenados: el `src` de la biblioteca quedaba apuntando a
        // /api/stream/<id>, y al recoger el fichero el servidor borra esa carpeta.
        // Resultado: toda canción descargada desde navegador quedaba muerta casi
        // al instante. Ahora se persiste el audio en IndexedDB y se entrega el
        // fichero desde el mismo blob, que son dos cosas distintas.
        const guardado = await saveDownloadToBrowser(download_id, videoInfo, downloadUrl);
        if (guardado.streamUrl) streamUrl = guardado.streamUrl;
    }
    return { streamUrl, localPath, miniatura };
}

/**
 * Guarda el audio descargado para reproducción offline en navegador y entrega
 * el fichero al usuario.
 *
 * Devuelve `streamUrl` con el prefijo idb:// si se pudo persistir. Si no, lo
 * deja en null para que el llamante conserve la URL de streaming del servidor,
 * que al menos funciona mientras la descarga siga viva.
 */
async function saveDownloadToBrowser(download_id, videoInfo, downloadUrl) {
    const songId = videoInfo?.id || videoInfo?.videoId || download_id || generateSongId();

    let blob;
    let extension = '.m4a';
    try {
        const respuesta = await fetch(downloadUrl);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        // La extensión sale de lo que el servidor devuelve de verdad, no de lo
        // que se pidió: si la conversión a mp3 falló, yt-dlp cae al original.
        extension = extFromResponse(respuesta);
        blob = await respuesta.blob();
    } catch (err) {
        console.error('[Descarga] No se pudo recuperar el fichero:', err);
        // Respaldo: el navegador lo descarga por su cuenta
        setTimeout(() => { globalThis.location.href = downloadUrl; }, 500);
        return { streamUrl: null };
    }

    // a) Persistencia para poder reproducirlo más tarde
    const guardado = await StorageModule.putBlob(songId, blob);

    // b) Entrega al disco del usuario, con una URL temporal que se revoca ya
    entregarFichero(blob, `${sanitizeFilename(videoInfo?.title || 'audio')}${extension}`);

    // La miniatura NO se descarga aquí a propósito. En navegador la URL remota
    // se carga sola cuando hace falta, y copiarla a base64 solo tiene sentido
    // en el camino nativo, que sí necesita funcionar sin conexión. Hacerlo aquí
    // bloqueaba la descarga entera si i.ytimg.com no respondía.
    if (!guardado) {
        showStatus(i18n.t('lib_not_saved'), 'error');
        return { streamUrl: null };
    }

    return { streamUrl: `${IDB_SRC_PREFIX}${songId}` };
}

/** Entrega un blob como descarga del navegador, revocando la URL al momento. */
export function entregarFichero(blob, nombre) {
    const urlTemporal = globalThis.URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = urlTemporal;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        globalThis.URL.revokeObjectURL(urlTemporal);
    }
}

async function saveToNativeCapacitor(download_id, videoInfo, downloadUrl, finalProgressData) {
    const fs = globalThis.Capacitor.Plugins.Filesystem;
    const sanitizedTitle = sanitizeFilename(videoInfo.title || 'audio');

    // La extensión real la dice el servidor (mp3, o m4a si la conversión
    // falló), así que primero se descarga y después se nombra el fichero
    const response = await fetch(downloadUrl);
    const blob = await response.blob();
    const fileName = `${sanitizedTitle}${extFromResponse(response)}`;
    const folderName = 'YTMusic';
    const publicDocsPath = `${folderName}/${fileName}`;

    const uuid = download_id || Math.random().toString(36).substring(2, 10);
    const internalNativePath = `imported_${uuid}_${fileName}`;

    // Ensure public folder exists
    try {
        await fs.mkdir({
            path: folderName,
            directory: 'DOCUMENTS',
            recursive: true
        });
    } catch (e) { console.debug('[Filesystem] mkdir documents ignored:', e); }

    // Download to App's isolated DATA sandbox
    await writeBlobToNativeFilesystem(fs, internalNativePath, publicDocsPath, blob);

    const writeResult = await fs.getUri({ path: internalNativePath, directory: 'DATA' });
    const streamUrl = globalThis.Capacitor.convertFileSrc(writeResult.uri);

    // La miniatura, para verla sin conexión: un fichero (plan 19, T2). Antes
    // iba en base64 dentro de la canción, y la biblioteca pesaba megas. La
    // clave lleva el id de la descarga: nunca pisa la de otra copia del vídeo
    const thumbUrl = videoInfo.thumbnail || finalProgressData?.thumbnail;
    let miniatura = null;
    try {
        const dataUrl = await downloadOfflineThumbnail(thumbUrl);
        miniatura = await guardarMiniaturaNativa(claveDe({ videoId: videoInfo.videoId || videoInfo.id }, download_id), dataUrl);
    } catch (e) { console.warn('[Miniaturas] No se pudo guardar la miniatura:', e); }

    fetch(`${apiBase()}/api/download/${download_id}`, { method: 'DELETE' }).catch(() => { });

    return { streamUrl, localPath: internalNativePath, miniatura };
}
