/**
 * Panel de favoritos de la pantalla de inicio y su descarga en lote.
 */

import { estadoVacio } from '../../ui/empty-states.js';
import { html } from '../../core/html.js';
import { apiBase } from '../../config/env.js';
import { origenDescarga, urlYoutubeDe } from '../../core/utils.js';
import { downloadFromUrl, selectedAudioFormat, urlInput } from '../download/download.js';
import { apuntarPendiente, quitarPendiente } from '../download/pendientes.js';
import { streamProgress } from '../download/progress.js';
import { queueManager } from '../download/queue.js';
import { FavoritesModule } from './store.js';
import { addToHistory } from '../history.js';
import { LibraryModule } from '../library/library.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisarSistema, avisoDeLote } from '../../native/notifications.js';
import { showSuccessAnimation } from '../../ui/celebration.js';
import { hideProgress, setLoading, showProgress, showStatus, updateProgress } from '../../ui/status.js';

// Favorites Elements
export const favoritesToggle = document.getElementById('favoritesToggle');

const favoritesContent = document.getElementById('favoritesContent');

const favoritesList = document.getElementById('favoritesList');

const favoritesCount = document.getElementById('favoritesCount');

export const favSelectAllBtn = document.getElementById('favSelectAllBtn');

export const favDeselectAllBtn = document.getElementById('favDeselectAllBtn');

export const downloadFavoritesBtn = document.getElementById('downloadFavoritesBtn');

const favSelectedCount = document.getElementById('favSelectedCount');

// ========================================
// Favorites Management
// ========================================
export async function updateFavoriteItem(videoId, newData) {
    const changed = await FavoritesModule.updateFavorite(videoId, newData);
    if (changed) await renderFavorites();
}

export async function renderFavorites() {
    const favorites = await FavoritesModule.getFavorites();
    favoritesCount.textContent = favorites.length;

    if (favorites.length === 0) {
        favoritesList.replaceChildren(estadoVacio({ ilustracion: 'favoritos', titulo: 'empty_fav_t', texto: 'empty_fav_d', compacto: true }));
        if (downloadFavoritesBtn) downloadFavoritesBtn.disabled = true;
        if (favSelectedCount) favSelectedCount.textContent = '0';
        return;
    }

    favoritesList.innerHTML = '';

    favorites.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';

        div.innerHTML = html`
            <input type="checkbox" class="fav-checkbox playlist-checkbox" data-index="${index}" checked>
            <button class="favorite-btn active" data-id="${item.id}" title="Quitar de favoritos">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Checkbox change
        const checkbox = div.querySelector('.fav-checkbox');
        checkbox.addEventListener('change', () => {
            div.classList.toggle('selected', checkbox.checked);
            updateFavSelectedCount();
        });
        div.classList.add('selected');

        // Unfavorite click
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await FavoritesModule.toggleFavorite(item, favBtn);
        });

        // Download click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const origen = origenDescarga(item);
            if (!origen) return showStatus(i18n.t('dl_no_source'), 'error');
            urlInput.value = origen;
            await downloadFromUrl(origen, item);
        });

        // Item click (toggle selection)
        div.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input')) {
                const cb = div.querySelector('.fav-checkbox');
                if (cb) {
                    cb.checked = !cb.checked;
                    div.classList.toggle('selected', cb.checked);
                    updateFavSelectedCount();
                }

                // Set URL for quick download too
                urlInput.value = origenDescarga(item) ?? '';
            }
        });

        favoritesList.appendChild(div);
    });

    updateFavSelectedCount();
}

async function updateFavSelectedCount() {
    const checked = favoritesList ? favoritesList.querySelectorAll('.fav-checkbox:checked').length : 0;
    if (favSelectedCount) favSelectedCount.textContent = checked;
    if (downloadFavoritesBtn) {
        const favorites = await FavoritesModule.getFavorites();
        downloadFavoritesBtn.disabled = checked === 0 || favorites.length === 0;
    }
}

export function selectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.add('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = true;
    });
    updateFavSelectedCount();
}

export function deselectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = false;
    });
    updateFavSelectedCount();
}

// Bind Home Fav actions - Already handled via addEventListener above.
async function downloadFavoritesMobile(selectedVideos, total) {
    try {
        const CONCURRENCY_LIMIT = 5;
        let activeCount = 0;
        let completedCount = 0;
        let queueIndex = 0;
        const errors = [];

        updateProgress(5, `Iniciando descarga paralela (${selectedVideos.length} canciones)...`);

        const batchStartTime = Date.now();
        let lastCompletedCount = 0;
        let etaSeconds = null;

        const updateBatchStatus = () => {
            if (completedCount > lastCompletedCount) {
                const elapsed = (Date.now() - batchStartTime) / 1000;
                const avgTimePerItem = elapsed / completedCount;
                const remainingItems = total - completedCount;
                etaSeconds = Math.round(remainingItems * avgTimePerItem);
                lastCompletedCount = completedCount;
            } else if (etaSeconds !== null && etaSeconds > 0) {
                etaSeconds--;
            }

            const percent = Math.round((completedCount / total) * 100);
            let statusMsg = `Descargando: ${completedCount}/${total} (${percent}%)`;

            if (etaSeconds !== null && completedCount > 0) {
                const mins = Math.floor(etaSeconds / 60);
                const secs = etaSeconds % 60;
                const etaStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                statusMsg += ` - ETA: ${etaStr}`;
            }

            updateProgress(Math.max(5, percent), statusMsg);
        };

        const etaInterval = setInterval(updateBatchStatus, 1000);

        await new Promise((resolve) => {
            function processNext() {
                while (activeCount < CONCURRENCY_LIMIT && queueIndex < total) {
                    const video = selectedVideos[queueIndex++];
                    activeCount++;

                    downloadFromUrl(video.url, video)
                        .then((hecha) => { if (hecha === false) errors.push(video.title); })
                        .catch(err => {
                            console.error('Download error:', err);
                            errors.push(video.title);
                        })
                        .finally(() => {
                            activeCount--;
                            completedCount++;
                            updateBatchStatus();

                            if (completedCount === total) {
                                clearInterval(etaInterval);
                                resolve();
                            } else {
                                processNext();
                            }
                        });
                }
            }
            processNext();
        });

        setLoading(false);
        hideProgress();

        // Si la app no está a la vista, aviso del sistema al acabar (plan 14, T5)
        const aviso = avisoDeLote({ total, fallidas: errors.length }, (clave, p) => i18n.t(clave, p));
        if (aviso) avisarSistema(aviso);

        if (errors.length > 0) {
            showStatus(i18n.t('batch_partial', { count: errors.length }), 'warning');
        } else {
            showStatus(i18n.t('dl_complete_n', { count: total }), 'success');
            showSuccessAnimation();
        }

    } catch (error) {
        console.error('Mobile parallel batch error:', error);
        showStatus(i18n.t('dl_error_parallel'), 'error');
        hideProgress();
    } finally {
        setLoading(false);
    }
}

async function downloadFavoritesDesktop(selectedVideos, total) {
    try {
        updateProgress(5, i18n.t('initializing') || 'Iniciando descarga...');

        const format = selectedAudioFormat();
        const startResponse = await fetch(`${apiBase()}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, format })
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        const batchInfo = {
            id: download_id,
            title: `Descargando ${total} canciones...`,
            thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
            channel: 'Favoritos'
        };
        queueManager.add(download_id, batchInfo);
        // Si la app se cierra antes de terminar, el ZIP se entrega al volver (plan 14, T2)
        apuntarPendiente({ downloadId: download_id, tipo: 'zip', info: batchInfo, total });

        const finalProgressData = await streamProgress(download_id, total);
        quitarPendiente(download_id);

        if (finalProgressData.cancelled) {
            hideProgress();
            setLoading(false);
            showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
            return;
        }

        updateProgress(100, '¡Descarga completada!');

        setTimeout(() => {
            window.location.href = `${apiBase()}/api/download/${download_id}`;
            showSuccessAnimation();
            setTimeout(() => {
                hideProgress();
                showStatus(i18n.t('zip_complete', { n: total }) || `¡${total} canciones descargadas!`, 'success');
            }, 1000);
        }, 300);

        const songsToAdd = selectedVideos.map(video => ({
            title: video.title,
            channel: video.channel,
            thumbnail: video.thumbnail,
            videoId: video.id || video.videoId,
            src: urlYoutubeDe(video) || video.url, // Standard behavior for zip downloads
            addedAt: new Date().toISOString()
        }));
        await LibraryModule.addSongs(songsToAdd);

        selectedVideos.forEach((video) => {
            addToHistory({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                channel: video.channel,
                url: urlYoutubeDe(video),
                duration: video.duration
            });
        });

    } catch (error) {
        console.error('Favorites batch download error:', error);
        hideProgress();
        setLoading(false);
        showStatus(error.message || 'Error en la descarga', 'error');
    } finally {
        setLoading(false);
    }
}

export async function downloadSelectedFavorites() {
    const favorites = await FavoritesModule.getFavorites();
    const checkboxes = favoritesList.querySelectorAll('.fav-checkbox:checked');
    // Cada favorito con lo que se pide al servidor: su URL de YouTube o, si no
    // la tiene, su título como búsqueda (ver origenDescarga)
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const fav = favorites[Number.parseInt(cb.dataset.index)];
        return fav && { ...fav, url: origenDescarga(fav) };
    }).filter((v) => v?.url);

    if (selectedVideos.length === 0) {
        showStatus(i18n.t('select_at_least_one') || 'Selecciona al menos una canción', 'error');
        return;
    }

    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile && total > 2) {
        await downloadFavoritesMobile(selectedVideos, total);
    } else {
        await downloadFavoritesDesktop(selectedVideos, total);
    }
}

export function toggleFavorites() {
    favoritesToggle.classList.toggle('open');
    favoritesContent.classList.toggle('hidden');
}

export function initPanelFavoritos() {
    if (favSelectAllBtn) favSelectAllBtn.addEventListener('click', selectAllFavorites);
    if (favDeselectAllBtn) favDeselectAllBtn.addEventListener('click', deselectAllFavorites);
    if (downloadFavoritesBtn) downloadFavoritesBtn.addEventListener('click', downloadSelectedFavorites);
    if (favoritesToggle) favoritesToggle.addEventListener('click', toggleFavorites);
}
