/**
 * Panel de favoritos de la pantalla de inicio y su descarga en lote.
 */

import { estadoVacio } from '../../ui/empty-states.js';
import { html } from '../../core/html.js';
import { origenDescarga } from '../../core/utils.js';
import { downloadFromUrl, urlInput } from '../download/download.js';
import { descargarLote } from '../download/lotes.js';
import { FavoritesModule } from './store.js';
import { i18n } from '../../i18n/language-manager.js';
import { showSuccessAnimation } from '../../ui/celebration.js';
import { showStatus } from '../../ui/status.js';

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

    if (selectedVideos.length === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Varias: un lote del servidor, y cada una entra en la biblioteca al
    // terminar (plan 20). Antes, en el ordenador, un ZIP y entradas sin audio
    showStatus(i18n.t('batch_started', { n: selectedVideos.length }), 'info');
    const r = await descargarLote(selectedVideos, { nombre: i18n.t('my_favorites') });
    if (r.error || r.cancelado) return;
    if (r.fallidas.length) {
        showStatus(i18n.t('batch_partial', { count: r.fallidas.length }), 'warning');
    } else {
        showStatus(i18n.t('dl_complete_n', { count: r.hechas }), 'success');
        showSuccessAnimation();
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
