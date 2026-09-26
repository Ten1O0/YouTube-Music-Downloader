/**
 * Los modales del detalle de una lista: editar su nombre y descripción, y
 * buscar canciones de la biblioteca para añadirlas o quitarlas.
 */

import { closeOverlayOrHideModal, NavigationModule } from '../../ui/navigation.js';
import { LibraryModule } from '../library/library.js';
import { getPlaylists, savePlaylists } from './store.js';

export function createModalesLista({ openPlaylistDetail, renderGrid, addSongToPlaylist, removeSongFromPlaylist }) {
    function openEditDetailsModal(pl) {
        const modal = document.getElementById('editPlaylistModal');
        const nameInput = document.getElementById('editPlaylistNameInput');
        const descInput = document.getElementById('editPlaylistDescInput');
        const saveBtn = document.getElementById('confirmEditPlaylistBtn');
        const closeBtn = document.getElementById('closeEditPlaylistModal');

        if (!modal || !nameInput || !descInput) return;

        nameInput.value = pl.name;
        descInput.value = pl.description || '';

        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('editPlaylistModal');

        saveBtn.onclick = async () => {
            const newName = nameInput.value.trim();
            const newDesc = descInput.value.trim();
            if (!newName) return;

            const playlists = await getPlaylists();
            const target = playlists.find(p => p.id === pl.id);
            if (target) {
                target.name = newName;
                target.description = newDesc;
                await savePlaylists(playlists);
                await openPlaylistDetail(pl.id); // Refresh
                await renderGrid(); // Update main grid
                NavigationModule.closeOverlay();
            }
        };

        const closeEdit = () => closeOverlayOrHideModal(modal);

        closeBtn.onclick = closeEdit;
        modal.querySelector('.auth-modal-backdrop').onclick = closeEdit;
    }

    function openAddSongsModal(playlistId) {
        const modal = document.getElementById('playlistSearchModal');
        const input = document.getElementById('plSearchInput');
        const results = document.getElementById('plSearchResults');
        const closeBtn = document.getElementById('closePlaylistSearchModal');

        if (!modal || !results) return;

        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('playlistSearchModal');
        input.value = '';
        renderLibSearchResults('', playlistId);

        input.oninput = () => {
            renderLibSearchResults(input.value.trim(), playlistId);
        };

        const closeAddSongs = () => closeOverlayOrHideModal(modal);

        closeBtn.onclick = closeAddSongs;
        modal.querySelector('.auth-modal-backdrop').onclick = closeAddSongs;
    }

    async function renderLibSearchResults(query, playlistId) {
        const results = document.getElementById('plSearchResults');
        const lib = await LibraryModule.getLibrary();
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);

        const filtered = lib.filter(song =>
            song.title.toLowerCase().includes(query.toLowerCase()) ||
            song.channel.toLowerCase().includes(query.toLowerCase())
        );

        if (filtered.length === 0) {
            results.innerHTML = '<div class="library-empty">No se encontraron canciones</div>';
            return;
        }

        results.innerHTML = filtered.map(song => {
            const alreadyIn = pl?.songs?.some(s => s.src === song.src);
            return `
                <div class="pl-add-song-row ${alreadyIn ? 'added' : ''}" data-video-id="${song.videoId}">
                    <img class="pl-add-song-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
                    <div class="pl-add-song-info">
                        <div class="pl-add-song-title">${song.title}</div>
                        <div class="pl-add-song-artist">${song.channel}</div>
                    </div>
                    <div class="pl-add-song-status">
                        <svg class="pl-add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            ${alreadyIn ? '<polyline points="20 6 9 17 4 12"/>' : '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'}
                        </svg>
                    </div>
                </div>
            `;
        }).join('');

        // Make the ENTIRE row clickable
        results.querySelectorAll('.pl-add-song-row').forEach((row, i) => {
            row.onclick = async () => {
                const song = filtered[i];
                const isAdding = !row.classList.contains('added');
                const icon = row.querySelector('.pl-add-icon');

                if (isAdding) {
                    await addSongToPlaylist(playlistId, song);
                    row.classList.add('added');
                    if (icon) icon.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
                } else {
                    await removeSongFromPlaylist(playlistId, song.src);
                    row.classList.remove('added');
                    if (icon) icon.innerHTML = '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>';
                }
            };
        });
    }

    return { openEditDetailsModal, openAddSongsModal };
}
