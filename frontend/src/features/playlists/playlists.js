/**
 * Listas de reproducción propias.
 */

import { conEsqueleto } from '../../ui/skeleton.js';
import { html } from '../../core/html.js';
import { StorageModule } from '../../core/storage.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { avisarHaptico } from '../../ui/haptics.js';
import { animateListChange, measure } from '../../ui/motion/list.js';
import { springTiming } from '../../ui/motion/spring.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule, renderLibraryItem } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { createHojaAnadir } from './add-sheet.js';
import { handleDeleteEmptyPlaylist, handlePlaylistDeletionUI, handleUpdateNonEmptyPlaylist, renderPlaylistCreateSongsList, resolvePlaylistDetails, syncPlaylistDetailHeader, syncPlaylistPlayerStates } from './helpers.js';
import { createModalesLista } from './modals.js';
import { getPlaylists, savePlaylists } from './store.js';

// ========================================
// PlaylistModule — Playlists personalizadas
// ========================================
export const PlaylistModule = (() => {
    const LAYOUT_KEY = 'ytdl_playlist_layout';
    let currentPlaylistId = null; // track which playlist detail is open
    let layoutMode = 'grid'; // Initial fallback

    async function createPlaylist(name, initialSongs = []) {
        const trimmed = name.trim();
        if (!trimmed) return { success: false, error: 'El nombre no puede estar vacío' };
        if (trimmed.length > 40) return { success: false, error: 'El nombre es demasiado largo (máximo 40 caracteres)' };

        const playlists = await getPlaylists();
        const exists = playlists.some(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) return { success: false, error: 'Ya existe una playlist con ese nombre' };

        playlists.push({
            id: Date.now().toString(),
            name: trimmed,
            description: '',
            songs: initialSongs,
            createdAt: new Date().toISOString()
        });
        await savePlaylists(playlists);
        await renderGrid();
        return { success: true };
    }

    async function deletePlaylist(id) {
        const playlists = await getPlaylists();
        const filtered = playlists.filter(p => p.id !== id);
        await savePlaylists(filtered);
        await renderGrid();
    }

    async function addSongToPlaylist(playlistId, song) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl && !pl.songs.some(s => s.src === song.src)) {
            pl.songs.push(song);
            await savePlaylists(playlists);
            await renderGrid();

            // ALWAYS refresh detail view — the user sees it behind the modal
            const countEl = document.getElementById('playlistDetailCount');
            if (countEl) countEl.textContent = contarCanciones(pl.songs.length);
            renderPlaylistSongs(pl);
        }
    }
    async function removeSongFromPlaylist(playlistId, songSrc) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            pl.songs = pl.songs.filter(s => s.src !== songSrc);
            if (pl.songs.length === 0) {
                await handleDeleteEmptyPlaylist(playlistId, pl.name);
            } else {
                await handleUpdateNonEmptyPlaylist(playlistId, playlists, pl);
            }
        }
    }

    async function openPlaylistDetail(playlistId) {
        currentPlaylistId = playlistId;
        isEditMode = false; // Reset edit mode on open
        const btnEdit = document.getElementById('plActionEdit');
        if (btnEdit) btnEdit.classList.remove('active');

        const pl = await resolvePlaylistDetails(playlistId);
        if (!pl) return;

        // Sync header and section displays via helper
        syncPlaylistDetailHeader(pl, playlistId);

        // Sync player states via helper
        syncPlaylistPlayerStates();

        // Bind Action Bar Buttons
        bindActionButtons(pl);

        // Render songs in playlist
        renderPlaylistSongs(pl);

        // Switch to detail view
        NavigationModule.switchView('playlistDetailView');
    }

    function bindActionButtons(pl) {
        const btnAdd = document.getElementById('plActionAdd');
        const btnEdit = document.getElementById('plActionEdit');
        const btnReorder = document.getElementById('plActionReorder');
        const btnDelete = document.getElementById('plActionDelete');
        const btnPlShuffle = document.getElementById('plShuffleBtn');
        const btnPlRepeat = document.getElementById('plRepeatBtn');
        const btnPlPlay = document.getElementById('plPlayBtn');
        const isFavPlaylist = pl.id === 'favorites';

        // Hide edit/reorder/delete for Favorites (it's a virtual read-only playlist)
        if (btnEdit) btnEdit.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnReorder) btnReorder.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnDelete) btnDelete.style.display = isFavPlaylist ? 'none' : 'flex';

        if (btnDelete) {
            btnDelete.onclick = () => {
                if (isFavPlaylist) return;
                handlePlaylistDeletionUI(pl);
            };
        }

        if (btnAdd) btnAdd.onclick = () => openAddSongsModal(pl.id);
        if (btnEdit) btnEdit.onclick = () => openEditDetailsModal(pl);
        if (btnReorder) btnReorder.onclick = () => toggleEditMode();

        if (btnPlPlay) {
            btnPlPlay.onclick = () => {
                if (pl.songs && pl.songs.length > 0) {
                    PlayerModule.play(pl.songs[0], pl.songs, 0);
                } else {
                    showStatus(i18n.t('pl_empty'), 'info');
                }
            };
        }

        if (btnPlShuffle) {
            btnPlShuffle.onclick = () => {
                PlayerModule.toggleShuffle();
            };
        }
        if (btnPlRepeat) {
            btnPlRepeat.onclick = () => {
                PlayerModule.toggleRepeat();
            };
        }
    }
    let isEditMode = false;
    async function toggleEditMode() {
        isEditMode = !isEditMode;
        const btnReorder = document.getElementById('plActionReorder');
        if (btnReorder) btnReorder.classList.toggle('active', isEditMode);

        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === currentPlaylistId);
        if (pl) renderPlaylistSongs(pl);
    }

    // ── Editar y añadir canciones (modals.js) ──
    const { openEditDetailsModal, openAddSongsModal } = createModalesLista({
        openPlaylistDetail, renderGrid, addSongToPlaylist, removeSongFromPlaylist,
    });

    function renderPlaylistSongs(pl) {
        const list = document.getElementById('playlistDetailList');
        const empty = document.getElementById('playlistDetailEmpty');
        if (!list) return;

        if (pl.songs.length === 0) {
            list.innerHTML = '';
            if (empty) { list.appendChild(empty); empty.style.display = 'flex'; }
            if (window.playlistSortable) {
                window.playlistSortable.destroy();
                window.playlistSortable = null;
            }
            return;
        }

        if (empty) empty.style.display = 'none';

        const antes = measure(list, '.library-item', el => el.dataset.src);
        list.innerHTML = pl.songs.map((song, i) => {
            return renderLibraryItem(song, i, {
                context: 'playlist',
                isEditMode: isEditMode
            });
        }).join('');
        animateListChange(list, '.library-item', el => el.dataset.src, antes);

        // Bind events
        list.querySelectorAll('.library-item').forEach((el, i) => {
            el.onclick = (e) => {
                if (isEditMode || e.target.closest('.library-item-btn') || e.target.closest('.pl-drag-handle')) return;
                PlayerModule.play(pl.songs[i], pl.songs, i);
            };

            const favBtn = el.querySelector('.favorite-btn');
            if (favBtn) {
                favBtn.onclick = (e) => {
                    e.stopPropagation();
                    const song = pl.songs[i];

                    // Call unified toggleFavorite
                    if (typeof FavoritesModule.toggleFavorite === 'function') {
                        FavoritesModule.toggleFavorite(song, favBtn);
                    }
                };
            }
        });

        list.querySelectorAll('.pl-remove-btn').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                await removeSongFromPlaylist(pl.id, btn.dataset.src);
            };
        });

        // Initialize or destroy SortableJS based on isEditMode
        if (isEditMode) {
            if (window.playlistSortable) window.playlistSortable.destroy();
            // Las filas se apartan con el muelle ágil (plan 09, T16): antes, una
            // curva que aceleraba al llegar
            const muelle = springTiming('snappy');
            window.playlistSortable = new Sortable(list, {
                handle: '.pl-drag-handle',
                animation: muelle.durationMs,
                easing: muelle.easing,
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                dragClass: 'sortable-drag',
                forceFallback: true,
                fallbackClass: 'sortable-fallback',
                fallbackOnBody: true,
                fallbackTolerance: 3,
                swapThreshold: 0.55,
                onStart: () => avisarHaptico('selection'),
                onEnd: async function (evt) {
                    avisarHaptico('light');
                    const fromIdx = evt.oldIndex;
                    const toIdx = evt.newIndex;
                    if (fromIdx === toIdx) return;
                    // Only persist data — SortableJS already moved the DOM element
                    try {
                        const playlists = await getPlaylists();
                        const currentPl = playlists.find(p => p.id === pl.id);
                        if (!currentPl) return;
                        const [removed] = currentPl.songs.splice(fromIdx, 1);
                        currentPl.songs.splice(toIdx, 0, removed);
                        await savePlaylists(playlists);
                        // Update the local reference so future drags use correct order
                        pl.songs = currentPl.songs;
                    } catch (e) {
                        console.error('Error persisting song move:', e);
                    }
                }
            });
        } else if (window.playlistSortable) {
            window.playlistSortable.destroy();
            window.playlistSortable = null;
        }
    }

    // ── Hoja «Añadir a playlist» (add-sheet.js) ──
    const { showAddToPlaylist } = createHojaAnadir({ createPlaylist });

    async function renderGrid() {
        const grid = document.getElementById('playlistsGrid');
        const empty = document.getElementById('playlistsEmpty');
        const gridIcon = document.getElementById('gridIcon');
        const listIcon = document.getElementById('listIcon');

        if (!grid) return;

        // Apply layout class
        grid.classList.toggle('list-view', layoutMode === 'list');

        // Update icons
        if (gridIcon && listIcon) {
            gridIcon.classList.toggle('hidden', layoutMode === 'list');
            listIcon.classList.toggle('hidden', layoutMode === 'grid');
        }

        // Tarjetas con forma si la primera carga tarda (plan 10, T8)
        const cargar = Promise.all([getPlaylists(), LibraryModule.getLibrary()]);
        const [rawPlaylists, lib] = grid.querySelector('.playlist-card')
            ? await cargar
            : await conEsqueleto(grid, 'tarjeta', 4, cargar, { alMostrar: () => { if (empty) empty.style.display = 'none'; } });
        const favsFromLib = lib.filter(s => FavoritesModule.isFavorite(s.videoId));

        if (rawPlaylists.length === 0 && favsFromLib.length === 0) {
            grid.innerHTML = '';
            if (empty) { grid.appendChild(empty); empty.style.display = 'flex'; }
            return;
        }

        if (empty) empty.style.display = 'none';

        // Inject virtual favorites playlist at the top
        const allPlaylists = [
            { id: 'favorites', name: 'Favoritos', songs: favsFromLib, isVirtual: true },
            ...rawPlaylists
        ];

        grid.innerHTML = allPlaylists.map(pl => {
            let coverHTML = '';
            if (pl.id === 'favorites') {
                coverHTML = html`
                <div class="playlist-card-cover-favorites" style="background: linear-gradient(135deg, rgba(197, 110, 110, 0.4) 0%, rgba(10, 12, 10, 0.6) 100%); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative;">
                    <svg viewBox="0 0 24 24" fill="var(--accent-error)" stroke="var(--accent-error)" stroke-width="1.5" style="width: 48px; height: 48px; filter: drop-shadow(0 0 8px rgba(197, 110, 110, 0.4));">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                    </svg>
                </div>
                `;
            } else {
                const covers = pl.songs.slice(0, 4).map(s => s.thumbnail).filter(Boolean);
                if (covers.length >= 4) {
                    const imgs = covers.map(c => html`<img src="${c}" alt="" style="width:100%; height:100%; object-fit:cover;">`);
                    coverHTML = html`<div class="playlist-card-cover-grid" style="display:grid; grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; width:100%; height:100%; gap:1px; background:rgba(0,0,0,0.1);">${imgs}</div>`;
                } else if (covers.length > 0) {
                    coverHTML = html`<img src="${covers[0]}" style="width:100%;height:100%;object-fit:cover" alt="" onerror="this.src='favicon.png'">`;
                } else {
                    coverHTML = html`
                    <div style="background: var(--bg-raised); border: 1px solid var(--border-subtle); width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-secondary);">
                        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--accent-gold);">music_note</span>
                    </div>
                    `;
                }
            }

            return html`
                <div class="playlist-card ${pl.id === 'favorites' ? 'favorites-card' : ''}" data-id="${pl.id}">
                    <div class="playlist-card-cover">${coverHTML}</div>
                    <div class="playlist-card-info">
                        <div class="playlist-card-name">${pl.name}</div>
                        <div class="playlist-card-count">${contarCanciones(pl.songs.length)}</div>
                    </div>
                </div>
            `;
        }).join('');

        grid.querySelectorAll('.playlist-card').forEach(card => {
            card.onclick = () => openPlaylistDetail(card.dataset.id);
        });
    }

    const playPlaylistBtn = document.getElementById('playPlaylistBtn');
    if (playPlaylistBtn) {
        playPlaylistBtn.addEventListener('click', async () => {
            if (!currentPlaylistId) return;

            let pl;
            if (currentPlaylistId === 'favorites') {
                const lib = await LibraryModule.getLibrary();
                const favs = lib.filter(s => FavoritesModule.isFavorite(s.videoId));
                pl = { songs: favs };
            } else {
                const playlists = await getPlaylists();
                pl = playlists.find(p => p.id === currentPlaylistId);
            }

            if (pl && pl.songs.length > 0) {
                PlayerModule.play(pl.songs[0], pl.songs, 0);
            }
        });
    }

    // Bind: Back button in detail view
    const backBtn = document.getElementById('backToPlaylistsBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentPlaylistId = null;
            NavigationModule.goBack();
        });
    }

    // Create playlist modal
    const createBtn = document.getElementById('createPlaylistBtn');
    const modal = document.getElementById('createPlaylistModal');
    const closeModal = document.getElementById('closePlaylistModal');
    const saveBtn = document.getElementById('savePlaylistBtn');
    const nameInput = document.getElementById('playlistNameInput');

    const getSelectedSongsForCreation = async () => {
        const songsList = document.getElementById('playlistCreateSongsList');
        if (!songsList) return [];
        const checkboxes = songsList.querySelectorAll('.playlist-create-checkbox:checked');
        const lib = await LibraryModule.getLibrary();
        return Array.from(checkboxes).map(cb => lib[Number.parseInt(cb.dataset.index, 10)]);
    };
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            if (modal) {
                if (nameInput) nameInput.value = '';

                // Fetch library songs and render in #playlistCreateSongsList using helper
                const songsList = document.getElementById('playlistCreateSongsList');
                if (songsList) {
                    await renderPlaylistCreateSongsList(songsList, saveBtn);
                }

                if (saveBtn) saveBtn.disabled = true; // start disabled
                modal.classList.remove('hidden');
                NavigationModule.pushOverlayState('createPlaylistModal');
                if (nameInput) setTimeout(() => nameInput.focus(), 100);
            }
        });
    }
    if (closeModal) {
        closeModal.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }
    if (modal) {
        modal.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }

    if (nameInput) {
        nameInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                const selectedSongs = await getSelectedSongsForCreation();
                if (selectedSongs.length === 0) {
                    alert('Debes seleccionar al menos una canción.');
                    return;
                }
                const result = await createPlaylist(nameInput.value, selectedSongs);
                if (result.success) {
                    NavigationModule.closeOverlay();
                } else {
                    alert(result.error);
                }
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const selectedSongs = await getSelectedSongsForCreation();
            if (selectedSongs.length === 0) {
                alert('Debes seleccionar al menos una canción.');
                return;
            }
            const result = await createPlaylist(nameInput.value, selectedSongs);
            if (result.success) {
                NavigationModule.closeOverlay();
            } else {
                alert(result.error);
            }
        });
    }

    const layoutToggle = document.getElementById('playlistLayoutToggle');
    if (layoutToggle) {
        layoutToggle.addEventListener('click', async () => {
            layoutMode = (layoutMode === 'grid' ? 'list' : 'grid');
            await StorageModule.set(LAYOUT_KEY, layoutMode);
            await renderGrid();
        });
    }

    // Close add-to-playlist modal
    const closeAddModal = document.getElementById('closeAddToPlaylistModal');
    const addModal = document.getElementById('addToPlaylistModal');
    if (closeAddModal) {
        closeAddModal.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }
    if (addModal) {
        addModal.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => {
            NavigationModule.closeOverlay();
        });
    }

    return {
        createPlaylist,
        deletePlaylist,
        addSongToPlaylist,
        removeSongFromPlaylist,
        showAddToPlaylist,
        openPlaylistDetail,
        renderGrid,
        getPlaylists,
        savePlaylists,
        renderPlaylistSongs,
        get currentPlaylistId() { return currentPlaylistId; },
        set currentPlaylistId(val) { currentPlaylistId = val; },
        get layoutMode() { return layoutMode; },
        set layoutMode(val) { layoutMode = val; }
    };
})();
