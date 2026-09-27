/**
 * La hoja «Añadir a playlist»: elegir listas para una canción o crear una
 * nueva con ella.
 */

import { html } from '../../core/html.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { handlePlaylistCheckboxChange } from './helpers.js';
import { getPlaylists } from './store.js';

export function createHojaAnadir({ createPlaylist }) {
    async function showAddToPlaylist(song) {
        const modal = document.getElementById('addToPlaylistModal');
        const list = document.getElementById('addToPlaylistList');
        const songName = document.getElementById('addToPlaylistSongName');
        const createNewBtn = document.getElementById('addToPlaylistCreateNewBtn');
        if (!modal || !list) return;

        const isAlreadyOpen = !modal.classList.contains('hidden');
        modal.classList.remove('hidden');
        if (!isAlreadyOpen) {
            NavigationModule.pushOverlayState('addToPlaylistModal');
        }

        if (songName) songName.textContent = song.title || '';

        // Wire up quick creation button
        if (createNewBtn) {
            createNewBtn.onclick = () => {
                const createPlModal = document.getElementById('createNewPlaylistModal');
                const nameInput = document.getElementById('newPlaylistNameInput');
                const confirmBtn = document.getElementById('confirmCreateNewPlaylistBtn');
                const cancelBtn = document.getElementById('cancelCreateNewPlaylistBtn');
                const closeBtn = document.getElementById('closeCreateNewPlaylistModal');
                const backdrop = document.getElementById('backdropCreateNewPlaylist');

                if (!createPlModal || !nameInput || !confirmBtn) return;

                // Open custom modal
                createPlModal.classList.remove('hidden');
                nameInput.value = '';
                nameInput.focus();

                const closeModal = () => {
                    createPlModal.classList.add('hidden');
                };

                cancelBtn.onclick = closeModal;
                closeBtn.onclick = closeModal;
                if (backdrop) backdrop.onclick = closeModal;
                if (closeBtn) closeBtn.onclick = closeModal;

                const submitCreation = async () => {
                    const plName = nameInput.value.trim();
                    if (!plName) {
                        showStatus(i18n.t('pl_name_required'), 'error');
                        return;
                    }

                    closeModal();

                    const result = await createPlaylist(plName, [song]);
                    if (result.success) {
                        showStatus(i18n.t('pl_created_with_song', { name: plName }), 'success');
                        // Refresh current modal checklist
                        await showAddToPlaylist(song);
                    } else {
                        showStatus(result.error, 'error');
                    }
                };

                confirmBtn.onclick = submitCreation;

                // Also listen for Enter key inside input
                nameInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitCreation();
                    }
                };
            };
        }

        const playlists = await getPlaylists();
        if (playlists.length === 0) {
            list.innerHTML = '<p style="padding:1.5rem;color:var(--text-muted);text-align:center;font-size:0.85rem;">Crea una playlist primero</p>';
        } else {
            list.innerHTML = playlists.map(pl => {
                const hasSong = pl.songs.some(s => s.src === song.src);
                return html`
                <label class="add-playlist-option" data-id="${pl.id}">
                    <input type="checkbox" class="playlist-checkbox" ${hasSong ? 'checked' : ''}>
                    <span>${pl.name}</span>
                    <span class="pl-count-indicator">${contarCanciones(pl.songs.length)}</span>
                </label>
                `;
            }).join('');
            list.querySelectorAll('.add-playlist-option').forEach(lbl => {
                const checkbox = lbl.querySelector('.playlist-checkbox');
                checkbox.addEventListener('change', async (e) => {
                    await handlePlaylistCheckboxChange(e, lbl, song);
                });
            });        }

        modal.classList.remove('hidden');
        
        // Also enable closing Add to Playlist modal when clicking backdrop
        const modalBackdrop = document.getElementById('backdropAddToPlaylist');
        const modalCloseBtn = document.getElementById('closeAddToPlaylistModal');
        if (modalBackdrop) {
            modalBackdrop.onclick = () => {
                modal.classList.add('hidden');
            };
        }
        if (modalCloseBtn) {
            modalCloseBtn.onclick = () => {
                modal.classList.add('hidden');
            };
        }
    }

    return { showAddToPlaylist };
}
