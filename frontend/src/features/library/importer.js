/**
 * Importar audio del dispositivo a la biblioteca: en la APK, en la web y en el
 * ordenador (plan 20, T4; antes, solo en la APK).
 *
 * En la APK el fichero se copia al almacenamiento de la app; en la web, al del
 * navegador, como las descargas (`idb://`). Si el fichero lo descargó esta app
 * (lleva el enlace de YouTube en sus metadatos), se reconoce: una canción que
 * ya está descargada aquí no se duplica, y una que estaba en la nube pasa a
 * tener su audio (en la biblioteca y en las listas) y viaja a la cuenta.
 */

import { isNative } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { arrayBufferToBase64 } from '../../core/utils.js';
import { IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { claveDe, guardarMiniaturaNativa, miniaturaDeYoutube } from '../../core/miniaturas.js';
import { queueManager } from '../download/queue.js';
import { LibraryModule } from './library.js';
import { cabeEnElNavegador, esAudio, repartirImportacion, tituloDeFichero, videoIdDeMetadatos } from './importar-audio.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisar } from '../../ui/toast.js';
import { setupNativeSync } from './recovery.js';

const A_LA_VEZ = 4;
const nuevoId = () => Math.random().toString(36).substring(2, 10);

/** Título, artista, carátula y el videoId de YouTube si lo trae. Nunca falla: sin datos, null. */
function leerMetadatos(file) {
    const lectura = new Promise((resolve) => {
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
                    picture: coverBase64,
                    videoId: videoIdDeMetadatos(tag.tags),
                });
            },
            onError: () => resolve(null)
        });
    });
    return Promise.race([lectura, new Promise((resolve) => setTimeout(() => resolve(null), 5000))]);
}

/** Copia el fichero al almacenamiento de la app (APK) o del navegador (web). */
async function guardarFichero(file, id) {
    const fs = isNative() ? globalThis.Capacitor?.Plugins?.Filesystem : null;
    if (!fs) {
        // Clave propia: nunca la de una descarga (su videoId), para no pisar su audio
        const clave = `imp_${id}`;
        if (!await StorageModule.putBlob(clave, file)) throw new Error('sin espacio');
        return { src: `${IDB_SRC_PREFIX}${clave}` };
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const finalNativePath = `imported_${id}_${safeName}`;
    const CHUNK_SIZE = 2 * 1024 * 1024;
    let offset = 0;
    let isFirstChunk = true;
    while (offset < file.size) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const base64Chunk = arrayBufferToBase64(await chunk.arrayBuffer());
        if (isFirstChunk) {
            await fs.writeFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
            isFirstChunk = false;
        } else {
            await fs.appendFile({ path: finalNativePath, data: base64Chunk, directory: 'DATA' });
        }
        offset += CHUNK_SIZE;
    }
    const savedUri = await fs.getUri({ path: finalNativePath, directory: 'DATA' });
    return { src: globalThis.Capacitor.convertFileSrc(savedUri.uri), localPath: finalNativePath };
}

/**
 * La carátula de una canción importada, sin base64 dentro de la canción (plan
 * 19, T2): en la APK, la del fichero se guarda aparte; en la web, si se sabe
 * qué vídeo es, su enlace de YouTube. Solo un fichero sin enlace y en la web
 * se queda con su carátula en base64 (no hay otra forma de verla sin conexión).
 */
async function miniaturaDeImportada(picture, videoId, id) {
    if (picture) {
        try {
            const enFichero = await guardarMiniaturaNativa(claveDe({ videoId }, id), picture);
            if (enFichero) return enFichero;
        } catch (e) { console.warn('[Importar] Carátula:', e); }
    }
    const deYoutube = miniaturaDeYoutube(videoId);
    return { thumbnail: deYoutube || picture || '' };
}

/** De A_LA_VEZ en A_LA_VEZ, parando si se cancela. */
async function enTandas(lista, fn, cancelada) {
    const resultados = [];
    for (let i = 0; i < lista.length && !cancelada(); i += A_LA_VEZ) {
        resultados.push(...await Promise.all(lista.slice(i, i + A_LA_VEZ).map(fn)));
    }
    return resultados;
}

/** Importa estos ficheros a la biblioteca. Devuelve cuántos entraron. */
export async function importarFicheros(lista) {
    const files = Array.from(lista || []).filter(esAudio);
    if (!files.length) return 0;

    // En la web, antes de empezar: ¿cabe? Mejor avisar que fallar a medias
    if (!isNative()) {
        const estimacion = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
        const { cabe, faltanMB } = cabeEnElNavegador(estimacion, files.reduce((n, f) => n + f.size, 0));
        if (!cabe) { avisar(i18n.t('import_no_space', { mb: faltanMB })); return 0; }
    }

    // El progreso va en la isla (móvil) o en un banner (escritorio), como las descargas
    const tarea = `importacion-${Date.now()}`;
    let cancelada = false;
    let hechos = 0;
    const total = files.length;
    const avanzar = () => {
        hechos++;
        queueManager.update(tarea, Math.round((hechos / total) * 100), i18n.t('import_count', { done: hechos, total }));
    };
    queueManager.add(tarea, { title: i18n.t('import_title', { total }), verbo: i18n.t('importing') },
        { alCancelar: () => { cancelada = true; } });

    // 1. Qué es cada fichero; los que ya están descargados aquí no se importan
    const leidos = await enTandas(files, async (fichero) => {
        const meta = await leerMetadatos(fichero);
        return { fichero, meta, videoId: meta?.videoId ?? null };
    }, () => cancelada);
    const { importar, saltados } = repartirImportacion(leidos, await LibraryModule.getLibrary());
    for (let i = 0; i < saltados; i++) avanzar();

    // 2. Guardar el audio (en paralelo)
    const guardadas = (await enTandas(importar, async ({ fichero, meta, videoId }) => {
        try {
            const id = nuevoId();
            const guardado = await guardarFichero(fichero, id);
            const cancion = {
                ...guardado,
                title: meta?.title || tituloDeFichero(fichero.name),
                channel: meta?.artist || 'Importado localmente',
                ...await miniaturaDeImportada(meta?.picture, videoId, id),
                videoId: videoId || `lib_${id}`,
                addedAt: new Date().toISOString(),
            };
            return { cancion, conEnlace: Boolean(videoId) };
        } catch (err) {
            console.error('Failed to import:', fichero.name, err);
            return null;
        } finally {
            avanzar();
        }
    }, () => cancelada)).filter(Boolean);

    // 3. Darlas de alta, de una en una: addSong lee y guarda la biblioteca entera.
    //    Lo importado antes de cancelar se queda
    let entraron = 0;
    for (const { cancion } of guardadas.filter((g) => g.conEnlace)) {
        // Como una descarga: si estaba en la nube, la sustituye (también en las listas)
        if (await LibraryModule.addSong(cancion)) entraron++;
    }
    const sinEnlace = guardadas.filter((g) => !g.conEnlace).map((g) => g.cancion);
    if (sinEnlace.length) entraron += await LibraryModule.addSongs(sinEnlace);

    if (entraron > 0) queueManager.complete(tarea, { textoHecho: i18n.t('hud_imported', { count: entraron }) });
    else if (!cancelada && !saltados) queueManager.fail(tarea);
    else queueManager.remove(tarea);
    if (saltados) avisar(i18n.t('import_skipped', { n: saltados }));
    return entraron;
}

/** En el ordenador: soltar ficheros sobre la Biblioteca los importa. */
function initArrastrar() {
    const vista = document.getElementById('libraryView');
    if (!vista || isNative()) return;
    const conFicheros = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    let dentro = 0;
    const salir = () => { dentro = 0; vista.classList.remove('soltando'); };
    vista.addEventListener('dragenter', (e) => {
        if (!conFicheros(e)) return;
        e.preventDefault();
        dentro++;
        vista.dataset.soltar = i18n.t('import_drop');
        vista.classList.add('soltando');
    });
    vista.addEventListener('dragover', (e) => { if (conFicheros(e)) e.preventDefault(); });
    vista.addEventListener('dragleave', () => { if (--dentro <= 0) salir(); });
    vista.addEventListener('drop', (e) => {
        if (!conFicheros(e)) return;
        e.preventDefault();
        salir();
        importarFicheros(e.dataTransfer.files);
    });
}

export function setupNativeImporter() {
    const importBtn = document.getElementById('importAudioBtn');
    const importInput = document.getElementById('importAudioInput');
    if (importBtn === null || importInput === null) return;

    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        importInput.value = '';
        await importarFicheros(files);
    });
    initArrastrar();

    setupNativeSync();
}
