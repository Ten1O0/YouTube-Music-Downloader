/**
 * Descargar una lista de YouTube: elegir canciones y descargarlas en lote.
 */

import { apiBase } from '../config/env.js';
import { formatDuration } from '../core/utils.js';
import { downloadFromUrl, selectedAudioFormat, urlInput } from './download/download.js';
import { streamProgress } from './download/progress.js';
import { queueManager } from './download/queue.js';
import { FavoritesModule } from './favorites/store.js';
import { addToHistory } from './history.js';
import { togglePreview } from './preview.js';
import { i18n } from '../i18n/language-manager.js';
import { showSuccessAnimation } from '../ui/celebration.js';
import { hideProgress, setLoading, showProgress, showStatus, updateProgress } from '../ui/status.js';

// Playlist Selector Elements
const playlistSelector = document.getElementById('playlistSelector');

const playlistList = document.getElementById('playlistList');

const playlistCount = document.getElementById('playlistCount');

const selectedCount = document.getElementById('selectedCount');

export const selectAllBtn = document.getElementById('selectAllBtn');

export const deselectAllBtn = document.getElementById('deselectAllBtn');

export const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

// Store playlist videos for selection
// Store playlist videos for selection
let currentPlaylistVideos = [];

function showPlaylistSelector() {
    playlistSelector.classList.remove('hidden');
}

export function hidePlaylistSelector() {
    playlistSelector.classList.add('hidden');
    playlistList.innerHTML = '';
    currentPlaylistVideos = [];
}

// ========================================
// Playlist Selector Functions
// ========================================
export async function fetchAndShowPlaylist(url) {
    setLoading(true);
    showProgress();
    updateProgress(30, 'Obteniendo canciones de la playlist...');

    try {
        const response = await fetch(`${apiBase()}/api/playlist-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al obtener la playlist');
        }

        const { videos } = await response.json();
        hideProgress();
        renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al obtener la playlist');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistList.innerHTML = '';
    playlistCount.textContent = videos.length;

    videos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item selected';
        item.dataset.index = index;

        const isFav = FavoritesModule.isFavorite(video.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = `
            <input type="checkbox" class="playlist-checkbox" data-index="${index}" checked>
            <button class="preview-btn" data-video-id="${video.id}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${video.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="playlist-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="playlist-info">
                <div class="playlist-item-title">${video.title}</div>
                <div class="playlist-meta">
                    <span class="playlist-channel">${video.channel}</span>
                    ${video.duration ? `<span class="playlist-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview button click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(video.id, previewBtn);
        });

        // Favorite button click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(video, favBtn);
        });

        // Toggle selection on click (but not on checkbox or preview button)
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.preview-btn')) {
                const checkbox = item.querySelector('.playlist-checkbox');
                checkbox.checked = !checkbox.checked;
            }
            item.classList.toggle('selected', item.querySelector('.playlist-checkbox').checked);
            updateSelectedCount();
        });

        playlistList.appendChild(item);
    });

    updateSelectedCount();
    showPlaylistSelector();
}

function updateSelectedCount() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const count = checkboxes.length;
    selectedCount.textContent = count;
    downloadSelectedBtn.disabled = count === 0;
}

export function selectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.add('selected');
        item.querySelector('.playlist-checkbox').checked = true;
    });
    updateSelectedCount();
}

export function deselectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.remove('selected');
        item.querySelector('.playlist-checkbox').checked = false;
    });
    updateSelectedCount();
}

export async function downloadSelectedPlaylistVideos() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = Number.parseInt(cb.dataset.index);
        return currentPlaylistVideos[index];
    });

    if (selectedVideos.length === 0) {
        showStatus(i18n.t('dl_select_one'), 'error');
        return;
    }

    hidePlaylistSelector();
    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    // If only one song, use regular single download
    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Check for Mobile/Tablet
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Mobile specific: If > 2 songs, download individually to avoid huge ZIPs
    if (isMobile && total > 2) {
        try {
            // Processing Queue with Concurrency Limit
            const CONCURRENCY_LIMIT = 5;
            let activeCount = 0;
            let completedCount = 0;
            let queueIndex = 0;
            const errors = [];

            updateProgress(5, `Iniciando descarga paralela (${selectedVideos.length} canciones)...`);

            await new Promise((resolve) => {
                function processNext() {
                    while (activeCount < CONCURRENCY_LIMIT && queueIndex < total) {
                        const video = selectedVideos[queueIndex++];
                        activeCount++;

                        // Use M4A optimized single download endpoint
                        downloadFromUrl(video.url, video)
                            .catch(err => {
                                console.error('Download error:', err);
                                errors.push(video.title);
                            })
                            .finally(() => {
                                activeCount--;
                                completedCount++;
                                const percent = Math.round((completedCount / total) * 100);
                                updateProgress(percent, `Descargando: ${completedCount}/${total} (${percent}%)`);

                                if (completedCount === total) {
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

            if (errors.length > 0) {
                showStatus(i18n.t('batch_partial', { count: errors.length }), 'warning');
            } else {
                showStatus(i18n.t('download_complete'), 'success');
                showSuccessAnimation();
            }

        } catch (error) {
            console.error('Mobile parallel batch error:', error);
            showStatus(i18n.t('dl_error_parallel'), 'error');
            hideProgress();
        } finally {
            setLoading(false);
        }
        return; // Stop here, don't do ZIP logic
    }

    // Multiple songs: use batch download (will be packaged as ZIP)
    try {
        updateProgress(5, i18n.t('initializing'));

        const format = selectedAudioFormat();
        const startResponse = await fetch(`${apiBase()}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, format }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        // Add to visual queue manager for batch download
        const batchInfo = {
            id: download_id,
            title: `Descargando ${total} canciones...`,
            thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
            channel: 'Playlist'
        };
        queueManager.add(download_id, batchInfo);

        // Poll for progress
        const finalProgressData = await streamProgress(download_id, total);

        // Check if download was cancelled - skip everything if so
        if (finalProgressData.cancelled) {
            hideProgress();
            setLoading(false);
            showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
            return; // Exit early, don't download or save to history
        }

        // Download the ZIP file
        updateProgress(100, '¡Descarga completada!');

        setTimeout(() => {
            window.location.href = `${apiBase()}/api/download/${download_id}`;

            showSuccessAnimation();
            setTimeout(() => {
                hideProgress();
                showStatus(i18n.t('zip_complete', { n: total }), 'success');
            }, 1000);
        }, 300);

        // Add all downloaded videos to history
        selectedVideos.forEach(video => {
            addToHistory({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                channel: video.channel,
                url: video.url,
                duration: video.duration
            });
        });

    } catch (error) {
        console.error('Batch download error:', error);
        hideProgress();
        showStatus(error.message || 'Error al descargar. Inténtalo de nuevo', 'error');
    } finally {
        setLoading(false);
    }
}

export function initListaYoutube() {
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPlaylistItems);
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllPlaylistItems);
    if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelectedPlaylistVideos);
}
