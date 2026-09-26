/**
 * Importar audio del dispositivo a la biblioteca.
 */

import { isNative } from '../../config/env.js';
import { arrayBufferToBase64 } from '../../core/utils.js';
import { queueManager } from '../download/queue.js';
import { LibraryModule } from './library.js';
import { i18n } from '../../i18n/language-manager.js';
import { setupNativeSync } from './recovery.js';

function readJsMediaTags(file) {
    return new Promise((resolve) => {
        if (typeof jsmediatags === 'undefined') return resolve(null);
        jsmediatags.read(file, {
            onSuccess: (tag) => {
                let coverBase64 = '';
                if (tag.tags?.picture) {
                    const { data, format } = tag.tags.picture;
                    let base64String = "";
                    const chunkSize = 8192;
                    for (let i = 0; i < data.length; i += chunkSize) {
                        base64String += String.fromCodePoint.apply(null, data.slice(i, i + chunkSize));
                    }
                    coverBase64 = `data:${format};base64,${globalThis.btoa(base64String)}`;
                }
                resolve({
                    title: tag.tags.title || null,
                    artist: tag.tags.artist || null,
                    picture: coverBase64
                });
            },
            onError: () => resolve(null)
        });
    });
}

export function setupNativeImporter() {
    const importBtn = document.getElementById('importAudioBtn');
    const importInput = document.getElementById('importAudioInput');
    if (importBtn === null || importInput === null) return;

    importBtn.addEventListener('click', () => importInput.click());

    importInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        if (!isNative() || globalThis.Capacitor?.Plugins?.Filesystem === undefined) {
            alert('Esta función "Bóveda Oculta" es exclusiva de la App Nativa.');
            importInput.value = '';
            return;
        }

        const fs = globalThis.Capacitor.Plugins.Filesystem;
        let successCount = 0;

        // El progreso va en la isla (móvil) o en un banner (escritorio), como
        // las descargas: antes solo se veía en la tarjeta de Inicio
        const tarea = `importacion-${Date.now()}`;
        let cancelada = false;
        queueManager.add(tarea, {
            title: i18n.t('import_title', { total: files.length }),
            verbo: i18n.t('importing'),
        }, { alCancelar: () => { cancelada = true; } });

        const CONCURRENCY_LIMIT = 4;
        let processedCount = 0;

        const processFile = async (file) => {
            if (file.size > 100 * 1024 * 1024) {
                console.warn('Archivo demasiado grande:', file.name);
                return null;
            }

            try {
                const metadata = await Promise.race([
                    readJsMediaTags(file),
                    new Promise(resolve => setTimeout(() => resolve(null), 5000))
                ]);

                const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                const uuid = Math.random().toString(36).substring(2, 10);
                const finalNativePath = `imported_${uuid}_${safeName}`;
                const CHUNK_SIZE = 2 * 1024 * 1024;
                let offset = 0;
                let isFirstChunk = true;

                while (offset < file.size) {
                    const chunk = file.slice(offset, offset + CHUNK_SIZE);
                    const arrayBuffer = await chunk.arrayBuffer();
                    const base64Chunk = arrayBufferToBase64(arrayBuffer);

                    if (isFirstChunk) {
                        await fs.writeFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
                        isFirstChunk = false;
                    } else {
                        await fs.appendFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
                    }
                    offset += CHUNK_SIZE;
                }

                // Resolve the file to a playable URL
                const savedUri = await fs.getUri({ path: finalNativePath, directory: 'DATA' });
                const playableUrl = globalThis.Capacitor.convertFileSrc(savedUri.uri);

                return {
                    src: playableUrl,
                    localPath: finalNativePath,
                    title: metadata?.title || file.name.replace(/\.[^/.]+$/, ""),
                    channel: metadata?.artist || 'Importado localmente',
                    thumbnail: metadata?.picture || '',
                    videoId: `lib_${uuid}`,
                    addedAt: new Date().toISOString()
                };
            } catch (err) {
                console.error('Failed to import:', file.name, err);
                return null;
            } finally {
                processedCount++;
                queueManager.update(tarea, Math.round((processedCount / files.length) * 100),
                    i18n.t('import_count', { done: processedCount, total: files.length }));
            }
        };

        // LOOP DE PROCESAMIENTO (Restaurado)
        const importedSongs = [];
        for (let i = 0; i < files.length && !cancelada; i += CONCURRENCY_LIMIT) {
            const batch = files.slice(i, i + CONCURRENCY_LIMIT);
            const results = await Promise.all(batch.map(f => processFile(f)));
            for (const res of results) {
                if (res) importedSongs.push(res);
            }
        }

        // Lo importado antes de cancelar se queda
        if (importedSongs.length > 0) {
            successCount = await LibraryModule.addSongs(importedSongs);
        }

        if (successCount > 0) queueManager.complete(tarea, { textoHecho: i18n.t('hud_imported', { count: successCount }) });
        else if (!cancelada) queueManager.fail(tarea);
        importInput.value = '';
    });

    setupNativeSync();
}
