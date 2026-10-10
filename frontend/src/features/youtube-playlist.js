/**
 * Descargar una lista de YouTube: elegir canciones y descargarlas en lote.
 */

import { html, seguro } from '../core/html.js';
import { apiBase, isNative } from '../config/env.js';
import { downloadFromUrl, urlInput } from './download/download.js';
import { descargarLote } from './download/lotes.js';
import { FavoritesModule } from './favorites/store.js';
import { precargarVistaPrevia, togglePreview } from './preview.js';
import { i18n } from '../i18n/language-manager.js';
import { mensajeDelServidor } from './download/progress.js';
import { showSuccessAnimation } from '../ui/celebration.js';
import { hideProgress, setLoading, showProgress, showStatus, updateProgress } from '../ui/status.js';

// Playlist Selector Elements
const playlistSelector = document.getElementById('playlistSelector');

const playlistList = document.getElementById('playlistList');

const playlistCount = document.getElementById('playlistCount');

const selectedCount = document.getElementById('selectedCount');

export const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

// Store playlist videos for selection
let currentPlaylistVideos = [];
// El selector común de canciones (plan 23, D5)
let selector = null;
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
    selector?.destruir();
    selector = null;
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
    updateProgress(30, i18n.t('progress_fetching_playlist'));

    try {
        const response = await fetch(`${apiBase()}/api/playlist-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(mensajeDelServidor(errorData, i18n.t('err_playlist')));
        }

        const { videos, title } = await response.json();
        hideProgress();
        listaActual = { url, titulo: title || '', videos };
        await renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        const msg = error.message || i18n.t('err_playlist');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

const ICONO_NOTA = seguro('<svg class="music-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>');
const ICONO_PAUSA = seguro('<svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');
const RUTA_CORAZON = seguro('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>');

/** Un vídeo de la lista como elemento del selector: la clave es su posición, que puede repetirse un vídeo. */
const elementoDeVideo = (video, i) => ({
    clave: String(i),
    titulo: video.title,
    artista: video.channel,
    miniatura: video.thumbnail,
    duracion: video.duration,
});

/** Escuchar antes y favorito, a la derecha de cada fila. */
function botonesDeVideo(e) {
    const video = currentPlaylistVideos[Number(e.clave)];
    const fav = FavoritesModule.isFavorite(video.id);
    return html`<button type="button" class="preview-btn" data-accion="escuchar" data-indice="${e.clave}" title="${i18n.t('t_preview')}" aria-label="${i18n.t('t_preview')}">${ICONO_NOTA}${ICONO_PAUSA}</button>
        <button type="button" class="favorite-btn${fav ? ' active' : ''}" data-accion="favorito" data-indice="${e.clave}" data-id="${video.id}" title="${i18n.t(fav ? 't_fav_remove' : 't_fav_add')}" aria-label="${i18n.t(fav ? 't_fav_remove' : 't_fav_add')}">
            <svg viewBox="0 0 24 24" stroke="currentColor" fill="${fav ? 'currentColor' : 'none'}" aria-hidden="true">${RUTA_CORAZON}</svg>
        </button>`;
}

/**
 * Las canciones de la lista, con el selector común (plan 23, D5): buscador,
 * «Seleccionar todo / ninguna» y el círculo dorado, como al crear una lista.
 * Empiezan todas marcadas.
 */
async function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistCount.textContent = videos.length;
    if (videos.length) precargarVistaPrevia();

    selector?.destruir();
    // El selector se carga al usarlo (presupuesto del plan 19)
    const { crearSelectorCanciones } = await import('../ui/selector.js');
    const elementos = videos.map(elementoDeVideo);
    selector = crearSelectorCanciones({
        contenedor: playlistList,
        elementos,
        seleccion: elementos.map((e) => e.clave),
        alCambiar: updateSelectedCount,
        extra: botonesDeVideo,
        textoBuscar: 'sel_search_yt_ph',
    });

    updateSelectedCount();
    showPlaylistSelector();
}

function updateSelectedCount() {
    const count = selector?.seleccionadas().length ?? 0;
    selectedCount.textContent = count;
    downloadSelectedBtn.disabled = count === 0;
    const zipBtn = document.getElementById('downloadZipBtn');
    if (zipBtn) zipBtn.disabled = count === 0;
}

/** Los botones de cada fila, por delegación: el selector repinta las filas al buscar. */
function alPulsarBoton(ev) {
    const boton = ev.target.closest('.selector-extra [data-accion]');
    if (!boton) return;
    ev.stopPropagation();
    const video = currentPlaylistVideos[Number(boton.dataset.indice)];
    if (!video) return;
    if (boton.dataset.accion === 'escuchar') togglePreview(video.id, boton);
    else FavoritesModule.toggleFavorite(video, boton);
}

export async function downloadSelectedPlaylistVideos({ zip = false } = {}) {
    const selectedVideos = (selector?.seleccionadas() ?? []).map((clave) => currentPlaylistVideos[Number(clave)]);

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
    playlistList?.addEventListener('click', alPulsarBoton);
    if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', () => downloadSelectedPlaylistVideos());
    // Los ficheros en el disco, sin pasar por la biblioteca: solo en el navegador
    const zipBtn = document.getElementById('downloadZipBtn');
    if (zipBtn && !isNative()) {
        zipBtn.hidden = false;
        zipBtn.addEventListener('click', () => downloadSelectedPlaylistVideos({ zip: true }));
    }
}
