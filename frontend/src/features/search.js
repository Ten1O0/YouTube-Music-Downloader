/**
 * Búsqueda en YouTube y la lista de resultados.
 */

import { conEsqueleto } from '../ui/skeleton.js';
import { estadoVacio } from '../ui/empty-states.js';
import { html } from '../core/html.js';
import { apiBase } from '../config/env.js';
import { extractVideoId, formatDuration } from '../core/utils.js';
import { downloadFromUrl, urlInput } from './download/download.js';
import { FavoritesModule } from './favorites/store.js';
import { precargarVistaPrevia, stopPreview, togglePreview } from './preview.js';
import { i18n } from '../i18n/language-manager.js';
import { mensajeDelServidor } from './download/progress.js';
import { hideProgress, setLoading, showProgress, showStatus, updateProgress } from '../ui/status.js';

const searchResults = document.getElementById('searchResults');

const resultsList = document.getElementById('resultsList');

// Search Pagination
let currentSearchResults = [];

let currentSearchPage = 0;

const RESULTS_PER_PAGE = 5;

function showSearchResults() {
    searchResults.classList.remove('hidden');
}

export function hideSearchResults() {
    searchResults.classList.add('hidden');
    resultsList.innerHTML = '';
}

export async function searchAndShowResults(query) {
    setLoading(true);
    showProgress();
    updateProgress(30, i18n.t('searching'));

    try {
        // Resultados con forma mientras llegan (plan 10, T8)
        const response = await conEsqueleto(resultsList, 'resultado', 5, fetch(`${apiBase()}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        }), { alMostrar: () => { resultsList.replaceChildren(); showSearchResults(); } });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(mensajeDelServidor(errorData, i18n.t('error_search')));
        }

        const { results } = await response.json();
        hideProgress();
        renderSearchResults(results);

    } catch (error) {
        console.error('Search error:', error);
        hideProgress();
        const msg = error.message || i18n.t('error_search');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderSearchResults(results) {
    // Initialize new search
    currentSearchResults = results;
    currentSearchPage = 0;
    resultsList.innerHTML = '';

    if (!results?.length) {
        resultsList.replaceChildren(estadoVacio({
            ilustracion: 'busqueda', titulo: 'empty_search_t', texto: 'empty_search_d',
            accion: { clave: 'act_try_link', alPulsar: () => { urlInput.focus(); urlInput.select(); } },
        }));
        showSearchResults();
        return;
    }

    showNextPage();
    showSearchResults();
}

function showNextPage() {
    // Remove existing "Load More" button if present
    const existingBtn = document.getElementById('loadMoreContainer');
    if (existingBtn) existingBtn.remove();

    const start = currentSearchPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    const pageItems = currentSearchResults.slice(start, end);
    if (pageItems.length) precargarVistaPrevia();

    pageItems.forEach(video => {
        const item = document.createElement('div');
        item.className = 'result-item';

        // Extract video ID from URL
        const videoId = extractVideoId(video.url);

        const isFav = FavoritesModule.isFavorite(videoId);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = html`
            <button class="preview-btn" data-video-id="${videoId}" title="${i18n.t('t_preview')}">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${videoId}" title="${i18n.t(isFav ? 't_fav_remove' : 't_fav_add')}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="result-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="result-info">
                <div class="result-title">${video.title}</div>
                <div class="result-meta">
                    <span class="result-channel">${video.channel}</span>
                    ${video.duration ? html`<span class="result-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Con sus datos: si YouTube no deja incrustarla, se baja a la caché (plan 24)
            togglePreview(videoId, previewBtn, { title: video.title, channel: video.channel, thumbnail: video.thumbnail, duration: video.duration });
        });

        // Favorite click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(video, favBtn);
        });

        // Download click handler (on rest of the item)
        const thumbnail = item.querySelector('.result-thumbnail');
        const infoArea = item.querySelector('.result-info');

        const startDownload = () => {
            stopPreview();
            // Do NOT hide search results to allow multiple downloads
            // hideSearchResults();

            // Pass the item element for visual feedback (background mode)
            downloadFromUrl(video.url, video, { item });
        };

        thumbnail.style.cursor = 'pointer';
        thumbnail.addEventListener('click', startDownload);
        infoArea.style.cursor = 'pointer';
        infoArea.addEventListener('click', startDownload);

        resultsList.appendChild(item);
    });

    currentSearchPage++;

    // Add Load More button if there are more results
    if (end < currentSearchResults.length) {
        const btnContainer = document.createElement('div');
        btnContainer.id = 'loadMoreContainer';
        btnContainer.className = 'load-more-container';
        btnContainer.innerHTML = html`<button class="load-more-btn">Cargar más resultados (${currentSearchResults.length - end} restantes)...</button>`;

        btnContainer.querySelector('button').addEventListener('click', showNextPage);
        resultsList.appendChild(btnContainer);
    }
}
