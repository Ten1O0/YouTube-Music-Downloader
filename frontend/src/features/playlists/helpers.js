/**
 * Operaciones auxiliares de las listas propias: borrar, actualizar y la
 * selección de canciones al crearlas.
 */

import { html } from '../../core/html.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { closeOverlayOrHideModal, NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { syncRepeatButtonState } from '../player/ui.js';
import { PlaylistModule } from './playlists.js';

export async function handleDeleteEmptyPlaylist(playlistId, plName) {
    await PlaylistModule.deletePlaylist(playlistId);
    showStatus(i18n.t('pl_auto_deleted', { name: plName }), 'info');
    if (PlaylistModule.currentPlaylistId === playlistId) {
        PlaylistModule.currentPlaylistId = null;
        NavigationModule.switchView('playlistsView');
    }
}

export async function handleUpdateNonEmptyPlaylist(playlistId, playlists, pl) {
    await PlaylistModule.savePlaylists(playlists);
    await PlaylistModule.renderGrid();

    // Refresh detail view instantly if it's the current one
    if (PlaylistModule.currentPlaylistId === playlistId) {
        const countEl = document.getElementById('playlistDetailCount');
        if (countEl) countEl.textContent = contarCanciones(pl.songs.length);
        PlaylistModule.renderPlaylistSongs(pl);
    }
}

export async function resolvePlaylistDetails(playlistId) {
    if (playlistId === 'favorites') {
        const lib = await LibraryModule.getLibrary();
        const favorites = lib.filter(s => FavoritesModule.isFavorite(s.videoId));
        return {
            id: 'favorites',
            name: 'Favoritos',
            songs: favorites
        };
    }
    const playlists = await PlaylistModule.getPlaylists();
    return playlists.find(p => p.id === playlistId);
}

export function syncPlaylistDetailHeader(pl, playlistId) {
    const addSection = document.querySelector('.playlist-add-section');
    if (addSection) {
        addSection.style.display = (playlistId === 'favorites' ? 'none' : 'block');
    }

    const nameEl = document.getElementById('playlistDetailName');
    const descEl = document.getElementById('playlistDetailDescription');
    const countEl = document.getElementById('playlistDetailCount');

    if (nameEl) nameEl.textContent = pl.name;
    if (descEl) {
        descEl.textContent = pl.description || 'Sin descripción';
        descEl.style.display = (pl.description ? 'block' : 'none');
    }
    if (countEl) countEl.textContent = contarCanciones(pl.songs.length);
}

export function syncPlaylistPlayerStates() {
    const shufVal = PlayerModule.isShuffled();
    const repVal = PlayerModule.getRepeatMode();

    const plShuf = document.getElementById('plShuffleBtn');
    if (plShuf) plShuf.classList.toggle('active', shufVal);

    syncRepeatButtonState(document.getElementById('plRepeatBtn'), repVal);
}

export function handlePlaylistDeletionUI(pl) {
    const deleteModal = document.getElementById('playlistDeleteConfirmModal');
    const deleteName = document.getElementById('plDeleteConfirmName');
    const deleteYes = document.getElementById('plDeleteConfirmYesBtn');
    const deleteNo = document.getElementById('plDeleteConfirmNoBtn');

    if (deleteModal && deleteName && deleteYes && deleteNo) {
        deleteName.textContent = pl.name;
        deleteModal.classList.remove('hidden');
        NavigationModule.pushOverlayState('playlistDeleteConfirmModal');

        deleteYes.onclick = async () => {
            await PlaylistModule.deletePlaylist(pl.id);
            closeOverlayOrHideModal(deleteModal);
            NavigationModule.switchView('playlistsView');
        };

        const closeDelete = () => closeOverlayOrHideModal(deleteModal);

        deleteNo.onclick = closeDelete;
        deleteModal.querySelector('.auth-modal-backdrop').onclick = closeDelete;
    }
}

export async function handlePlaylistCheckboxChange(e, lbl, song) {
    const plId = lbl.dataset.id;
    if (e.target.checked) {
        await PlaylistModule.addSongToPlaylist(plId, song);
    } else {
        await PlaylistModule.removeSongFromPlaylist(plId, song.src);
    }
    // Actualizar el contador dinámicamente sin cerrar el modal
    const updatedPls = await PlaylistModule.getPlaylists();
    const pl = updatedPls.find(p => p.id === plId);
    if (pl) {
        lbl.querySelector('.pl-count-indicator').textContent = contarCanciones(pl.songs.length);
    }
}

export async function renderPlaylistCreateSongsList(songsList, saveBtn) {
    if (!songsList) return;
    const lib = await LibraryModule.getLibrary();
    if (lib.length === 0) {
        songsList.innerHTML = '<p style="padding:1rem;color:var(--text-muted);text-align:center;font-size:0.8rem;">No tienes canciones en tu biblioteca. ¡Descarga canciones primero!</p>';
        return;
    }

    songsList.innerHTML = lib.map((song, i) => {
        return html`
        <label class="playlist-create-song-row" style="display:flex; align-items:center; padding:6px; cursor:pointer; gap:10px; border-bottom:1px solid rgba(255,255,255,0.02);">
            <input type="checkbox" class="playlist-create-checkbox" data-index="${i}" style="transform:scale(1.1); accent-color:var(--accent-gold);">
            <img src="${song.thumbnail || 'favicon.png'}" style="width:32px; height:32px; object-fit:cover; border-radius:var(--radius-xs);" alt="" onerror="this.src='favicon.png'">
            <div style="flex:1; min-width:0; display:flex; flex-direction:column;">
                <div style="font-size:0.75rem; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${song.title}</div>
                <div style="font-size:0.65rem; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${song.channel}</div>
            </div>
        </label>
        `;
    }).join('');

    // Listener to enable/disable button
    const checkboxes = songsList.querySelectorAll('.playlist-create-checkbox');
    const updateCreateBtnState = () => {
        const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
        if (saveBtn) saveBtn.disabled = selectedCount === 0;
    };

    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateCreateBtnState);
    });
}
