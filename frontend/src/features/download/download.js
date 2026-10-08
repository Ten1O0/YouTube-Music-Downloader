/**
 * Descargar una canción desde la pantalla de inicio: el campo, el botón y el
 * recorrido completo de una descarga.
 */

import { medidaSonoridad } from '../../core/loudness.js';
import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { esIdYoutube, extractVideoId, getErrorMessage, isPlaylistUrl, isUrl, isValidInput } from '../../core/utils.js';
import { apuntarPendiente, decidirPendiente, leerPendientes, quitarPendiente, sumarIntento } from './pendientes.js';
import { mensajeDelServidor, resolveProgressText, streamProgress } from './progress.js';
import { queueManager } from './queue.js';
import { saveDownloadToApp } from './save.js';
import { addToHistory } from '../history.js';
import { LibraryModule } from '../library/library.js';
import { hideSearchResults, searchAndShowResults } from '../search.js';
import { fetchAndShowPlaylist, hidePlaylistSelector } from '../youtube-playlist.js';
import { i18n } from '../../i18n/language-manager.js';
import { showSuccessAnimation } from '../../ui/celebration.js';
import { avisar } from '../../ui/toast.js';
import { hideProgress, hideStatus, setLoading, showProgress, showStatus, statusMessage, updateProgress } from '../../ui/status.js';

// ========================================
// DOM Elements
// ========================================
export const urlInput = document.getElementById('youtubeUrl');

export const downloadBtn = document.getElementById('downloadBtn');

const btnText = downloadBtn.querySelector('span');

/** El botón dice el formato elegido, en el idioma actual. */
export function pintarBotonDescarga() {
    if (!btnText) return;
    const format = (selectedAudioFormat() || 'm4a').toUpperCase();
    btnText.dataset.i18nParams = JSON.stringify({ format });
    // i18n se crea más abajo: en el primer pintado todavía no existe, y
    // setLanguage() lo repinta con los parámetros al arrancar.
    try { btnText.textContent = i18n.t('download_btn', { format }); }
    catch { btnText.textContent = `Descargar ${format}`; }
}

export const clearBtn = document.getElementById('clearBtn');

const formatSelect = document.getElementById('formatSelect');

/** Formato elegido, con respaldo si el selector no está en el DOM. */
export function selectedAudioFormat() {
    return formatSelect?.value || 'm4a';
}

export const AUDIO_FORMAT_KEY = 'audio_format';

// ========================================
// Main Download Function
// ========================================
export async function handleDownload() {
    const input = urlInput.value.trim();

    if (!input) {
        showStatus(i18n.t('url_error'), 'error');
        urlInput.focus();
        return;
    }

    if (!isValidInput(input)) {
        showStatus(i18n.t('input_error'), 'error');
        urlInput.focus();
        return;
    }

    hideStatus();
    hideSearchResults();
    hidePlaylistSelector();

    // Check if it's a playlist URL first
    if (isPlaylistUrl(input)) {
        await fetchAndShowPlaylist(input);
    } else if (isUrl(input)) {
        await downloadFromUrl(input);
    } else {
        await searchAndShowResults(input);
    }
}

function disableUIElement(uiElements) {
    if (!uiElements?.item) return;
    uiElements.item.style.opacity = '0.7';
    uiElements.item.style.pointerEvents = 'none';
}

function resetUIElement(uiElements, borderColor = '') {
    if (!uiElements?.item) return;
    uiElements.item.style.opacity = '1';
    uiElements.item.style.pointerEvents = 'auto';
    if (borderColor) uiElements.item.style.borderColor = borderColor;
}

export function buildHistoryEntry(url, videoInfo, finalProgressData) {
    const videoId = extractVideoId(url) || finalProgressData.video_id;
    const fallbackThumb = 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png';
    const title = finalProgressData.title
        || (videoInfo?.title !== 'YouTube Video' ? videoInfo.title : null)
        || 'Descarga';
    return {
        id: videoId || videoInfo?.id,
        title,
        url,
        thumbnail: finalProgressData.thumbnail || videoInfo?.thumbnail || fallbackThumb,
        channel: videoInfo?.channel || 'YouTube',
        downloadedAt: new Date().toISOString()
    };
}

function handleDownloadCancel(isBackground, uiElements) {
    if (!isBackground) hideProgress();
    resetUIElement(uiElements);
    setLoading(false);
}

function handleDownloadSuccess(isBackground, uiElements, videoInfo) {
    if (!isBackground) {
        showSuccessAnimation();
        setTimeout(() => { showStatus(i18n.t('download_complete'), 'success'); hideProgress(); }, 1000);
    } else {
        showStatus(i18n.t('dl_done', { title: videoInfo?.title || 'Audio' }), 'success');
        resetUIElement(uiElements, 'var(--success-color)');
    }
}

function handleDownloadError(error, isBackground, uiElements) {
    console.error('Download error:', error);
    if (!isBackground) hideProgress();
    resetUIElement(uiElements, 'var(--error-color)');
    showStatus(getErrorMessage(error), 'error');
}

function ensureVideoInfo(videoInfo, download_id, title, thumbnail) {
    if (videoInfo?.title && videoInfo.title !== 'YouTube Video') return videoInfo;

    let realTitle = title || 'YouTube Video';
    let realChannel = 'YouTube';

    // Try to infer the channel from "Artist - Song" title patterns
    if (realTitle.includes(' - ')) {
        const parts = realTitle.split(' - ');
        realChannel = parts[0].trim();
        realTitle = parts.slice(1).join(' - ').trim();
    }

    return {
        id: download_id,
        title: realTitle,
        thumbnail: thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
        channel: realChannel
    };
}

export async function downloadFromUrl(url, videoInfo = null, uiElements = null) {
    const isBackground = !!uiElements;
    let descargaEnCurso = null;
    setLoading(true);

    if (!isBackground) {
        showProgress();
        updateProgress(5, i18n.t('connecting'));
    } else {
        showStatus(`${i18n.t('initializing')}: ${videoInfo?.title || 'Download'}`, 'info');
        disableUIElement(uiElements);
    }

    try {
        const format = selectedAudioFormat();
        const startResponse = await fetch(`${apiBase()}/api/start-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, format }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw Object.assign(new Error(mensajeDelServidor(errorData)), { status: startResponse.status, code: errorData.code });
        }

        const { download_id, total, title, thumbnail } = await startResponse.json();
        videoInfo = ensureVideoInfo(videoInfo, download_id, title, thumbnail);
        descargaEnCurso = download_id;

        queueManager.add(download_id, videoInfo);
        // Si la app se cierra antes de terminar, se recoge al volver (plan 14, T2)
        apuntarPendiente({ downloadId: download_id, url, info: videoInfo, total });

        if (!isBackground) {
            updateProgress(10, total > 1 ? i18n.t('progress_preparing_n', { n: total }) : i18n.t('downloading'));
        }

        const finalProgressData = await streamProgress(download_id, total);

        if (finalProgressData.cancelled) {
            quitarPendiente(download_id);
            handleDownloadCancel(isBackground, uiElements);
            return;
        }

        if (!isBackground) updateProgress(100, i18n.t('download_complete'));

        const anadida = await guardarDescarga({ download_id, total, url, videoInfo, finalProgressData });

        handleDownloadSuccess(isBackground, uiElements, videoInfo);
        // La canción ya en la biblioteca: quien descarga desde la nube la reproduce (plan 13)
        return anadida ?? null;

    } catch (error) {
        // Sin red, se queda apuntada para recogerla después; si falló de verdad, no
        if (descargaEnCurso && globalThis.navigator?.onLine !== false && !(error instanceof TypeError)) quitarPendiente(descargaEnCurso);
        handleDownloadError(error, isBackground, uiElements);
        // false: falló (undefined es cancelada; null, ya estaba en la biblioteca)
        return false;
    } finally {
        setLoading(false);
    }
}

/**
 * Lo que se hace con una descarga terminada: bajar el fichero, guardarlo en el
 * dispositivo y añadirlo a la biblioteca. Lo usan la descarga normal y la
 * recogida al volver a abrir la app.
 */
export async function guardarDescarga({ download_id, total, url, videoInfo, finalProgressData }) {
    const downloadUrl = `${apiBase()}/api/download/${download_id}`;
    const { streamUrl, localPath, miniatura } = await saveDownloadToApp(download_id, videoInfo, downloadUrl, finalProgressData);

    if (total === 1) addToHistory(buildHistoryEntry(url, videoInfo, finalProgressData));

    const anadida = await LibraryModule.addSong(entradaDeBiblioteca({ streamUrl, localPath, miniatura, url, videoInfo, finalProgressData }));
    await quitarPendiente(download_id);
    return anadida;
}

/**
 * La canción de la biblioteca de una descarga terminada, con lo que se sabe de
 * ella. La usan la descarga normal y «Guardar» desde la radio (plan 16), que
 * así quedan idénticas.
 */
export function entradaDeBiblioteca({ streamUrl, localPath, miniatura, url, videoInfo, finalProgressData }) {
    const libEntry = {
        src: streamUrl,
        localPath: localPath,
        title: finalProgressData?.title || videoInfo?.title || 'Sin título',
        channel: finalProgressData?.channel || videoInfo?.channel || videoInfo?.uploader || 'Artista desconocido',
        thumbnail: miniatura?.thumbnail || finalProgressData?.thumbnail || videoInfo?.thumbnail || '',
        ...(miniatura?.localThumbnailPath ? { localThumbnailPath: miniatura.localThumbnailPath } : {}),
        // El id de YouTube, nunca el de la descarga: con él se vuelve a
        // descargar un favorito y se reconocen las escuchas en otro dispositivo
        videoId: [videoInfo?.videoId, videoInfo?.id, finalProgressData?.video_id, extractVideoId(url)].find(esIdYoutube) || '',
        downloadedAt: new Date().toISOString(),
        // Si YouTube los sabe (plan 11, T1); si no, la biblioteca los deduce
        ...(finalProgressData?.artist ? { artist: finalProgressData.artist } : {}),
        ...(finalProgressData?.track ? { track: finalProgressData.track } : {}),
    };
    // Medida por el servidor al terminar (plan 12, T4); si no llega, la mide el cliente
    const loudness = medidaSonoridad(finalProgressData?.loudness, 'servidor');
    if (loudness) libEntry.loudness = loudness;
    return libEntry;
}

/** Lo que dice el servidor de una descarga: su progreso, null si ya no la tiene, undefined si no contesta. */
export async function progresoDe(downloadId) {
    try {
        const res = await fetch(`${apiBase()}/api/progress/${encodeURIComponent(downloadId)}`, { cache: 'no-store' });
        if (res.ok) return await res.json();
        return res.status === 404 ? null : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Una descarga sin interfaz (plan 16, la radio): ni la barra de Inicio, ni la
 * isla, ni avisos, ni pendientes, para no pisar lo que el usuario esté
 * descargando a la vez. El mismo servidor, el mismo formato y el mismo
 * progreso; qué se hace con el fichero lo decide quien la pide. Resuelve con
 * `{ download_id, finalProgressData }` al terminar; lanza si falla (`status`
 * lleva el código HTTP si el servidor la rechazó, 429 por el límite).
 */
export async function descargarEnSilencio(url, { intervaloMs = 1000, maxMs = 5 * 60_000 } = {}) {
    const res = await fetch(`${apiBase()}/api/start-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: selectedAudioFormat() }),
    });
    const datos = await res.json().catch(() => ({}));
    // Con su código (youtube_limit, server_busy): la radio decide qué decir (plan 21, T7)
    if (!res.ok) throw Object.assign(new Error(mensajeDelServidor(datos)), { status: res.status, code: datos.code });
    const { download_id } = datos;
    for (const hasta = Date.now() + maxMs; Date.now() < hasta;) {
        await new Promise((r) => setTimeout(r, intervaloMs));
        const progreso = await progresoDe(download_id);
        if (progreso === null) throw new Error('El servidor ya no tiene la descarga');
        if (progreso?.status === 'complete') return { download_id, finalProgressData: progreso };
        if (progreso?.status === 'error' || progreso?.status === 'cancelled') {
            throw Object.assign(new Error(resolveProgressText(progreso) || progreso.status), { code: progreso.code });
        }
    }
    throw new Error('La descarga tardó demasiado');
}

/** Una descarga de lote (ZIP) terminada: se entrega el fichero, como habría pasado. */
function entregarZip(downloadId) {
    const a = document.createElement('a');
    a.href = `${apiBase()}/api/download/${downloadId}`;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
}

/**
 * Al abrir la app, lo que quedó a medias o sin recoger (plan 14, T2): lo
 * terminado se guarda como si no te hubieras ido; lo que sigue en marcha, se
 * sigue; lo que el servidor ya no tiene, se avisa. No se vuelve a lanzar nada:
 * si se perdió, el usuario decide.
 */
export async function recogerPendientes() {
    // Los lotes (plan 20) los recoge su gestor, en download/lotes.js
    const pendientes = (await leerPendientes()).filter((p) => p.tipo !== 'lote');
    if (!pendientes.length) return { recogidas: 0, perdidas: 0 };
    let recogidas = 0;
    const perdidas = [];
    const enMarcha = [];

    for (const p of pendientes) {
        const progreso = await progresoDe(p.downloadId);
        if (progreso === undefined) continue; // servidor sin contestar: en el próximo arranque
        const que = decidirPendiente(progreso, p);
        if (que === 'descartar') {
            await quitarPendiente(p.downloadId);
            perdidas.push(p.info?.title || '');
            continue;
        }
        queueManager.add(p.downloadId, p.info);
        const terminar = async () => {
            const final = que === 'recoger' ? progreso : await streamProgress(p.downloadId, p.total);
            if (final?.cancelled) { await quitarPendiente(p.downloadId); return; }
            if (que === 'recoger') queueManager.complete(p.downloadId);
            if (p.tipo === 'zip') { entregarZip(p.downloadId); await quitarPendiente(p.downloadId); }
            else await guardarDescarga({ download_id: p.downloadId, total: p.total, url: p.url, videoInfo: p.info, finalProgressData: final });
            recogidas++;
        };
        const intento = terminar().catch(async (e) => {
            console.warn('[Pendientes] No se pudo recoger', p.downloadId, e);
            queueManager.fail(p.downloadId);
            await sumarIntento(p.downloadId);
        });
        if (que === 'seguir') enMarcha.push(intento); else await intento;
    }
    await Promise.all(enMarcha);

    if (recogidas) avisar(i18n.t('dl_recovered', { n: recogidas }));
    if (perdidas.length === 1) avisar(i18n.t('dl_lost', { title: perdidas[0] || '—' }));
    else if (perdidas.length > 1) avisar(i18n.t('dl_lost_n', { n: perdidas.length }));
    return { recogidas, perdidas: perdidas.length };
}

/** Enlaza el campo, el botón de descargar y el de borrar. */
export function initFormularioDescarga() {
    pintarBotonDescarga();

    downloadBtn.addEventListener('click', handleDownload);

    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleDownload();
        }
    });

    urlInput.addEventListener('input', () => {
        if (statusMessage.classList.contains('visible')) {
            hideStatus();
        }
    });

    // Clear button functionality
    clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        hideStatus();
        hidePlaylistSelector();
        urlInput.focus();
    });
}

/** El desplegable de formato (M4A o MP3), que recuerda la elección. */
export function initSelectorFormato() {
    const customSelectWrapper = document.querySelector('.custom-select-wrapper');
    const customSelect = document.getElementById('customFormatSelect');
    const customOptionsContainer = document.getElementById('customFormatOptions');
    const nativeSelect = document.getElementById('formatSelect');

    if (customSelect && customOptionsContainer && nativeSelect) {
        // Recordar la elección entre sesiones: antes había que reelegirla en
        // cada descarga, y ahora la elección tiene consecuencias visibles.
        StorageModule.get(AUDIO_FORMAT_KEY).then((guardado) => {
            if (!guardado || guardado === nativeSelect.value) return;

            const opcion = customOptionsContainer.querySelector(`.custom-option[data-value="${guardado}"]`);
            if (!opcion) return;

            nativeSelect.value = guardado;
            customOptionsContainer.querySelectorAll('.custom-option')
                .forEach(o => o.classList.toggle('selected', o === opcion));

            const trigger = customSelect.querySelector('.custom-select-trigger');
            if (trigger) {
                trigger.textContent = opcion.textContent;
                if (opcion.dataset.i18n) trigger.dataset.i18n = opcion.dataset.i18n;
            }
        }).catch(e => console.debug('[Formato] No se pudo leer la preferencia:', e));

        nativeSelect.addEventListener('change', () => {
            pintarBotonDescarga();
            StorageModule.set(AUDIO_FORMAT_KEY, nativeSelect.value)
                .catch(e => console.debug('[Formato] No se pudo guardar la preferencia:', e));

            // mp3 re-codifica y tarda más: avisar gestiona la expectativa, que
            // si no el usuario creerá que la aplicación va lenta.
            if (nativeSelect.value === 'mp3') {
                showStatus(i18n.t('format_mp3_notice'), 'info');
            }
        });

        // Alternar menú de opciones
        customSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            customSelectWrapper.classList.toggle('open');
        });

        // Manejar selección de opción
        customOptionsContainer.querySelectorAll('.custom-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const triggerText = option.textContent;
                const i18nKey = option.dataset.i18n;

                // Actualizar texto y atributo i18n del disparador
                const trigger = customSelect.querySelector('.custom-select-trigger');
                if (trigger) {
                    trigger.textContent = triggerText;
                    if (i18nKey) trigger.dataset.i18n = i18nKey;
                    else delete trigger.dataset.i18n;
                }

                // Resaltar opción seleccionada
                customOptionsContainer.querySelectorAll('.custom-option').forEach(opt => {
                    opt.classList.toggle('selected', opt === option);
                });

                // Sincronizar select nativo oculto y disparar evento de cambio
                nativeSelect.value = value;
                nativeSelect.dispatchEvent(new Event('change'));

                // Cerrar desplegable
                customSelectWrapper.classList.remove('open');
            });
        });

        // Cerrar menú si se hace clic en cualquier otra parte
        document.addEventListener('click', () => {
            customSelectWrapper.classList.remove('open');
        });
    }
}
