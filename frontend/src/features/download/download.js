/**
 * Descargar una canción desde la pantalla de inicio: el campo, el botón y el
 * recorrido completo de una descarga.
 */

import { medidaSonoridad } from '../../core/loudness.js';
import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { esIdYoutube, extractVideoId, getErrorMessage, isPlaylistUrl, isUrl, isValidInput } from '../../core/utils.js';
import { streamProgress } from './progress.js';
import { queueManager } from './queue.js';
import { saveDownloadToApp } from './save.js';
import { addToHistory } from '../history.js';
import { LibraryModule } from '../library/library.js';
import { hideSearchResults, searchAndShowResults } from '../search.js';
import { fetchAndShowPlaylist, hidePlaylistSelector } from '../youtube-playlist.js';
import { i18n } from '../../i18n/language-manager.js';
import { showSuccessAnimation } from '../../ui/celebration.js';
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

function buildHistoryEntry(url, videoInfo, finalProgressData) {
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
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id, total, title, thumbnail } = await startResponse.json();
        videoInfo = ensureVideoInfo(videoInfo, download_id, title, thumbnail);

        queueManager.add(download_id, videoInfo);

        if (!isBackground) {
            updateProgress(10, total > 1 ? `Preparando descarga de ${total} canciones...` : 'Descargando...');
        }

        const finalProgressData = await streamProgress(download_id, total);

        if (finalProgressData.cancelled) {
            handleDownloadCancel(isBackground, uiElements);
            return;
        }

        if (!isBackground) updateProgress(100, '¡Descarga completada!');

        const downloadUrl = `${apiBase()}/api/download/${download_id}`;
        const { streamUrl, localPath, offlineBase64Thumb } = await saveDownloadToApp(download_id, videoInfo, downloadUrl, finalProgressData);

        if (total === 1) addToHistory(buildHistoryEntry(url, videoInfo, finalProgressData));

        const libEntry = {
            src: streamUrl,
            localPath: localPath,
            title: finalProgressData?.title || videoInfo?.title || 'Sin título',
            channel: finalProgressData?.channel || videoInfo?.channel || videoInfo?.uploader || 'Artista desconocido',
            thumbnail: typeof offlineBase64Thumb === 'string' ? offlineBase64Thumb : (finalProgressData?.thumbnail || videoInfo?.thumbnail || ''),
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
        const anadida = await LibraryModule.addSong(libEntry);

        handleDownloadSuccess(isBackground, uiElements, videoInfo);
        // La canción ya en la biblioteca: quien descarga desde la nube la reproduce (plan 13)
        return anadida ?? null;

    } catch (error) {
        handleDownloadError(error, isBackground, uiElements);
    } finally {
        setLoading(false);
    }
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
