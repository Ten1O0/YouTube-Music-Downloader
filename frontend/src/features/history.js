/**
 * Historial de descargas: local sin sesión, de la cuenta con ella.
 */

import { estadoVacio } from '../ui/empty-states.js';
import { html } from '../core/html.js';
import { apiBase } from '../config/env.js';
import { StorageModule } from '../core/storage.js';
import { i18n } from '../i18n/language-manager.js';
import { showStatus } from '../ui/status.js';
import { extractVideoId, origenDescarga, urlYoutubeDe } from '../core/utils.js';
import { auth } from './auth.js';
import { downloadFromUrl, urlInput } from './download/download.js';
import { FavoritesModule } from './favorites/store.js';

// History Elements
export const historyToggle = document.getElementById('historyToggle');

const historyContent = document.getElementById('historyContent');

const historyList = document.getElementById('historyList');

const historyCount = document.getElementById('historyCount');

export const clearHistoryBtn = document.getElementById('clearHistoryBtn');

export const HISTORY_MAX_ITEMS = 1000;

export const HISTORY_STORAGE_KEY = 'downloadHistory';

// ========================================
// Download History
// ========================================

/** Historial guardado en este dispositivo, con o sin sesión. */
export async function getLocalHistory() {
    try {
        return await StorageModule.get(HISTORY_STORAGE_KEY) || [];
    } catch (e) {
        console.error('Error reading history:', e);
        return [];
    }
}

/**
 * Historial que se muestra: el del servidor si hay sesión y ya se cargó, el
 * local en cualquier otro caso. Solo sirve para leer; para escribir hay que
 * tocar cada copia por separado, o el historial del servidor acaba volcado
 * en el almacenamiento local.
 */
export async function getDownloadHistory() {
    if (auth.isLoggedIn() && auth._serverHistoryCache) {
        return auth._serverHistoryCache;
    }
    return getLocalHistory();
}

/** Pone `entry` la primera, sin duplicados y respetando el tope. */
function prependHistoryEntry(history, entry) {
    return [entry, ...history.filter(item => item.id !== entry.id)].slice(0, HISTORY_MAX_ITEMS);
}

async function saveDownloadHistory(history) {
    try {
        await StorageModule.set(HISTORY_STORAGE_KEY, history);
    } catch (e) {
        console.error('Error saving history:', e);
    }
}

export async function addToHistory(video) {
    const entry = {
        id: video.id || extractVideoId(video.url),
        title: video.title,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id || extractVideoId(video.url)}/mqdefault.jpg`,
        channel: video.channel || 'Desconocido',
        // Solo una URL de YouTube; sin ella, se vuelve a descargar por el título
        url: urlYoutubeDe(video),
        downloadedAt: new Date().toISOString()
    };

    // La copia local se guarda siempre: es la que queda al cerrar sesión y la
    // única que existe sin conexión. Se lee directamente de local, no con
    // getDownloadHistory(), que con sesión devolvería la del servidor.
    await saveDownloadHistory(prependHistoryEntry(await getLocalHistory(), entry));

    if (auth.isLoggedIn()) {
        // La caché se actualiza ya, para que la vista no espere a la red; el
        // servidor se entera por detrás. Antes se pedía el historial entero
        // de nuevo tras cada descarga solo para ver aparecer una fila.
        if (auth._serverHistoryCache) {
            auth._serverHistoryCache = prependHistoryEntry(auth._serverHistoryCache, entry);
        }
        fetch(`${apiBase()}/api/user/history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...auth.getAuthHeaders()
            },
            body: JSON.stringify(entry)
        }).catch(e => console.error('Server history save error:', e));
    }

    await renderHistory();
}

export async function updateHistoryItem(videoId, newData) {
    const aplicar = (history) => {
        const item = history.find(h => h.id === videoId);
        if (!item) return false;
        if (newData.title) item.title = newData.title;
        if (newData.thumbnail) item.thumbnail = newData.thumbnail;
        return true;
    };

    // Cada copia por su lado: mezclarlas guardaba el historial del servidor
    // en el almacenamiento local.
    const local = await getLocalHistory();
    const cambioLocal = aplicar(local);
    if (cambioLocal) await saveDownloadHistory(local);

    const cache = auth.isLoggedIn() ? auth._serverHistoryCache : null;
    const cambioCache = cache ? aplicar(cache) : false;

    if (cambioLocal || cambioCache) await renderHistory();
}

export async function clearHistory() {
    if (confirm('¿Estás seguro de que quieres limpiar el historial?')) {
        await StorageModule.remove(HISTORY_STORAGE_KEY);

        if (auth.isLoggedIn()) {
            // Se vacía la caché antes de la respuesta: si no, la vista vuelve a
            // pintar el historial del servidor y parece que no se borró nada.
            if (auth._serverHistoryCache) auth._serverHistoryCache = [];
            fetch(`${apiBase()}/api/user/history`, {
                method: 'DELETE',
                headers: auth.getAuthHeaders()
            }).catch(e => console.error('Server history clear error:', e));
        }

        await renderHistory();
    }
}

export async function renderHistory() {
    const history = await getDownloadHistory();
    if (historyCount) historyCount.textContent = history.length;

    if (history.length === 0) {
        historyList.replaceChildren(estadoVacio({ ilustracion: 'historial', titulo: 'empty_hist_t', compacto: true }));
        return;
    }

    historyList.innerHTML = '';

    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const date = new Date(item.downloadedAt);
        const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        const isFav = FavoritesModule.isFavorite(item.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        div.innerHTML = html`
            <button class="favorite-btn ${heartClass}" data-id="${item.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                    <span class="history-date">${dateStr}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar de nuevo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Favorite button click handler
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            FavoritesModule.toggleFavorite(item, favBtn);
        });

        // Re-download button click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const origen = origenDescarga(item);
            if (!origen) return showStatus(i18n.t('dl_no_source'), 'error');
            urlInput.value = origen;
            downloadFromUrl(origen);
        });

        // Click on item to fill URL
        div.addEventListener('click', () => {
            urlInput.value = origenDescarga(item) ?? '';
            urlInput.focus();
        });

        historyList.appendChild(div);
    });
}

export function toggleHistory() {
    historyToggle.classList.toggle('open');
    historyContent.classList.toggle('hidden');
}

export function initHistorial() {
    if (historyToggle) historyToggle.addEventListener('click', toggleHistory);
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);
}
