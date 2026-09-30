/**
 * Escritura de ficheros en el almacenamiento de la APK.
 */

import { arrayBufferToBase64 } from '../core/utils.js';

/** Escribe un blob en DATA y, si se da `publicDocsPath`, también una copia pública en Documentos. */
export async function writeBlobToNativeFilesystem(fs, internalNativePath, publicDocsPath, blob) {
    const CHUNK_SIZE = 2 * 1024 * 1024;
    let offset = 0;
    let isFirstChunk = true;
    while (offset < blob.size) {
        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
        const base64Chunk = arrayBufferToBase64(await chunk.arrayBuffer());
        if (isFirstChunk) {
            await fs.writeFile({ path: internalNativePath, data: base64Chunk, directory: 'DATA' });
            if (publicDocsPath) try { await fs.writeFile({ path: publicDocsPath, data: base64Chunk, directory: 'DOCUMENTS' }); } catch (err) { console.debug('[Filesystem] writeFile documents ignored:', err); }
            isFirstChunk = false;
        } else {
            await fs.appendFile({ path: internalNativePath, data: base64Chunk, directory: 'DATA' });
            if (publicDocsPath) try { await fs.appendFile({ path: publicDocsPath, data: base64Chunk, directory: 'DOCUMENTS' }); } catch (err) { console.debug('[Filesystem] appendFile documents ignored:', err); }
        }
        offset += CHUNK_SIZE;
    }
}

export async function downloadOfflineThumbnail(thumbUrl) {
    if (!thumbUrl) return null;
    try {
        let bestThumb = thumbUrl;
        if (bestThumb.includes('i.ytimg.com')) {
            bestThumb = bestThumb.replace('maxresdefault.jpg', 'mqdefault.jpg').replace('hqdefault.jpg', 'mqdefault.jpg');
        }

        const thumbRes = await fetch(bestThumb);
        if (thumbRes.ok) {
            const thumbBlob = await thumbRes.blob();
            const thumbReader = new FileReader();
            thumbReader.readAsDataURL(thumbBlob);
            await new Promise(r => { thumbReader.onloadend = r; });
            return thumbReader.result;
        }
    } catch (e) { console.warn('Failed to save offline thumbnail', e); }
    return null;
}

