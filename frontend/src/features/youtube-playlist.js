/**
 * Descargar una lista de YouTube: elegir canciones y descargarlas en lote.
 */

import { html } from '../core/html.js';
import { apiBase, isNative } from '../config/env.js';
import { formatDuration } from '../core/utils.js';
import { downloadFromUrl, urlInput } from './download/download.js';
import { descargarLote } from './download/lotes.js';
import { FavoritesModule } from './favorites/store.js';
import { precargarVistaPrevia, togglePreview } from './preview.js';
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
let currentPlaylistVideos = [];
// La lista que se está enseñando, para poder seguirla (plan 14)
let listaActual = null;

/** La lista de YouTube que enseña el selector: { url, titulo, videos }, o null. */
export const listaMostrada = () => listaActual;

function showPlaylistSelector() {
    playlistSelector.classList.remove('hidden');
    document.dispatchEvent(new CustomEvent('lista-yt-mostrada'));
}

export function hidePlaylistSelector() {
    playlistSelector.classList.add('hidden');
    playlistList.innerHTML = '';
    currentPlaylistVideos = [];
    listaActual = null;
    document.dispatchEvent(new CustomEvent('lista-yt-mostrada'));
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

        const { videos, title } = await response.json();
        hideProgress();
        listaActual = { url, titulo: title || '', videos };
        renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        const msg = error.message || 'Error al obtener la playlist';
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistList.innerHTML = '';
    playlistCount.textContent = videos.length;
    if (videos.length) precargarVistaPrevia();

    videos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item selected';
        item.dataset.index = index;

        const isFav = FavoritesModule.isFavorite(video.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = html`
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
                    ${video.duration ? html`<span class="playlist-duration">${formatDuration(video.duration)}</span>` : ''}
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
    const zipBtn = document.getElementById('downloadZipBtn');
    if (zipBtn) zipBtn.disabled = count === 0;
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

export async function downloadSelectedPlaylistVideos({ zip = false } = {}) {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => currentPlaylistVideos[Number.parseInt(cb.dataset.index)]);

    if (selectedVideos.length === 0) {
        showStatus(i18n.t('dl_select_one'), 'error');
        return;
    }

    const nombre = listaActual?.titulo || '';
    hidePlaylistSelector();

    // Una sola: la descarga de siempre
    if (selectedVideos.length === 1 && !zip) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Varias: un lote del servidor, de 3 en 3, y cada canción entra en la
    // biblioteca al terminar (plan 20). Igual en el móvil, la APK y el ordenador
    showStatus(i18n.t('batch_started', { n: selectedVideos.length }), 'info');
    const r = await descargarLote(selectedVideos, { nombre, zip });
    if (r.error || r.cancelado) return;
    if (r.fallidas.length) {
        showStatus(i18n.t('batch_partial', { count: r.fallidas.length }), 'warning');
    } else {
        showStatus(zip ? i18n.t('zip_complete', { n: r.hechas }) : i18n.t('dl_complete_n', { count: r.hechas }), 'success');
        showSuccessAnimation();
    }
}

export function initListaYoutube() {
    if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPlaylistItems);
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllPlaylistItems);
    if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', () => downloadSelectedPlaylistVideos());
    // Los ficheros en el disco, sin pasar por la biblioteca: solo en el navegador
    const zipBtn = document.getElementById('downloadZipBtn');
    if (zipBtn && !isNative()) {
        zipBtn.hidden = false;
        zipBtn.addEventListener('click', () => downloadSelectedPlaylistVideos({ zip: true }));
    }
}
