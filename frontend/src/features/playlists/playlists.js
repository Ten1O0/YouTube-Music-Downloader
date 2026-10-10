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
import { esAutomatica } from './auto.js';
import { cargarListasAutomaticas, guardarYRepintarLista, handlePlaylistDeletionUI, resolvePlaylistDetails, syncPlaylistDetailHeader, syncPlaylistPlayerStates } from './helpers.js';
import { moverEnGrupo, ordenDeVista, textoDeLista } from './orden.js';
import { initCrearLista } from './crear.js';
import { createModalesLista } from './modals.js';
import { getPlaylists, savePlaylists } from './store.js';
import { esSeguida } from '../seguidas.js';
import { esNube } from '../sync/fusion.js';

// ========================================
// PlaylistModule — Playlists personalizadas
// ========================================
export const PlaylistModule = (() => {
    const LAYOUT_KEY = 'ytdl_playlist_layout';
    const MAX_NOMBRE = 40;
    let currentPlaylistId = null; // track which playlist detail is open
    let layoutMode = 'grid'; // Initial fallback

    /** Crea una lista. Devuelve también su id, para marcarla al crearla desde «Añadir a playlist». */
    async function createPlaylist(name, initialSongs = [], { descripcion = '' } = {}) {
        const trimmed = name.trim();
        if (!trimmed) return { success: false, error: i18n.t('pl_name_required') };
        if (trimmed.length > MAX_NOMBRE) return { success: false, error: i18n.t('pl_name_too_long', { max: MAX_NOMBRE }) };

        const playlists = await getPlaylists();
        const exists = playlists.some(p => p.name.toLowerCase() === trimmed.toLowerCase());
        if (exists) return { success: false, error: i18n.t('pl_name_taken') };

        const id = Date.now().toString();
        playlists.push({
            id,
            name: trimmed,
            description: descripcion.trim().slice(0, 200),
            songs: initialSongs,
            createdAt: new Date().toISOString()
        });
        await savePlaylists(playlists);
        await renderGrid();
        return { success: true, id };
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
            if (countEl) countEl.textContent = textoDeLista(pl.songs);
            renderPlaylistSongs(pl);
        }
    }
    async function removeSongFromPlaylist(playlistId, songSrc) {
        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === playlistId);
        if (pl) {
            // Sin canciones, la lista se queda, vacía (plan 23): se puede crear
            // vacía, así que ya no se borra al quitarle la última
            pl.songs = pl.songs.filter(s => s.src !== songSrc);
            await guardarYRepintarLista(playlistId, playlists, pl);
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

        // La barra de las listas vinculadas a YouTube la pinta follows.js (plan 14)
        document.dispatchEvent(new CustomEvent('lista-abierta', { detail: pl }));

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
        const automatica = esAutomatica(pl.id);
        const isFavPlaylist = pl.id === 'favorites' || automatica;

        // Favoritos y las listas automáticas se calculan: no se editan, ordenan ni borran.
        // A las automáticas tampoco se les añade nada
        if (btnEdit) btnEdit.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnReorder) btnReorder.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnDelete) btnDelete.style.display = isFavPlaylist ? 'none' : 'flex';
        if (btnAdd) btnAdd.style.display = automatica ? 'none' : 'flex';
        const separador = document.querySelector('#playlistDetailView .pl-actions-separator');
        if (separador) separador.style.display = automatica ? 'none' : '';

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

    // La lista que se ve en el detalle: los clics buscan la canción por su src
    // (no por su posición: al reordenar arrastrando, la posición cambia)
    let listaPintada = null;
    let listaDelegada = false;

    function delegarClicsLista(list) {
        if (listaDelegada) return;
        listaDelegada = true;
        list.addEventListener('click', async (e) => {
            const fila = e.target.closest('.library-item');
            const pl = listaPintada;
            if (!fila || !pl || !list.contains(fila)) return;
            // En el orden en que se ve: lo descargado primero (plan 23, T4)
            const vista = ordenDeVista(pl.songs);
            const i = vista.findIndex((s) => s.src === fila.dataset.src);
            const song = vista[i];
            if (!song) return;
            const quitar = e.target.closest('.pl-remove-btn');
            const corazon = e.target.closest('.favorite-btn');
            if (quitar) {
                e.stopPropagation();
                await removeSongFromPlaylist(pl.id, quitar.dataset.src);
            } else if (corazon) {
                e.stopPropagation();
                FavoritesModule.toggleFavorite(song, corazon);
            } else if (!isEditMode && !e.target.closest('.library-item-btn') && !e.target.closest('.pl-drag-handle')) {
                PlayerModule.play(song, vista, i);
            }
        });
    }

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
        // Lo descargado primero y lo de la nube después, como en la biblioteca (plan 23, T4)
        const vista = ordenDeVista(pl.songs);
        list.innerHTML = vista.map((song, i) => {
            return renderLibraryItem(song, i, {
                context: 'playlist',
                isEditMode: isEditMode,
                soloLectura: esAutomatica(pl.id),
            });
        }).join('');
        // El grupo de cada fila, para que al ordenar no se salga del suyo
        list.querySelectorAll('.library-item').forEach((fila, i) => { fila.dataset.grupo = esNube(vista[i]) ? 'nube' : 'local'; });
        animateListChange(list, '.library-item', el => el.dataset.src, antes);

        // Un solo escuchador para la lista (plan 19, T4)
        listaPintada = pl;
        delegarClicsLista(list);

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
                // Cada canción se ordena dentro de su grupo: lo descargado no pasa a la nube ni al revés
                onMove: (evt) => evt.related?.dataset.grupo === evt.dragged?.dataset.grupo,
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
                        // Los índices son los de la vista: se mueve dentro de su grupo
                        currentPl.songs = moverEnGrupo(currentPl.songs, fromIdx, toIdx);
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
    // «Añadir a playlist» se carga al abrirla la primera vez (plan 23; presupuesto del plan 19)
    let hojaAnadir = null;
    const showAddToPlaylist = async (song) => {
        hojaAnadir ??= import('./add-sheet.js').then((m) => m.createHojaAnadir({ createPlaylist }));
        return (await hojaAnadir).showAddToPlaylist(song);
    };

    async function renderGrid() {
        const grid = document.getElementById('playlistsGrid');
        const empty = document.getElementById('playlistsEmpty');
        const gridIcon = document.getElementById('gridIcon');
        const listIcon = document.getElementById('listIcon');

        if (!grid) return;
        // Fuera de la vista no se repinta (plan 19, T5): al entrar en Listas se
        // repinta siempre (ver 'vista-cambiada' más abajo). Antes, un corazón o
        // una descarga rehacían todas las tarjetas y las listas automáticas.
        // Se mira la vista de la navegación y no si está oculta: con la
        // transición, Listas sigue oculta cuando llega 'vista-cambiada', no se
        // repintaba y una lista recién borrada seguía en la rejilla
        if (grid.querySelector('.playlist-card') && NavigationModule.getCurrentView() !== 'playlistsView') return;

        // Apply layout class
        grid.classList.toggle('list-view', layoutMode === 'list');

        // Update icons
        if (gridIcon && listIcon) {
            gridIcon.classList.toggle('hidden', layoutMode === 'list');
            listIcon.classList.toggle('hidden', layoutMode === 'grid');
        }

        // Tarjetas con forma si la primera carga tarda (plan 10, T8)
        const cargar = Promise.all([getPlaylists(), LibraryModule.getLibrary(), cargarListasAutomaticas()]);
        const [rawPlaylists, lib, automaticas] = grid.querySelector('.playlist-card')
            ? await cargar
            : await conEsqueleto(grid, 'tarjeta', 4, cargar, { alMostrar: () => { if (empty) empty.style.display = 'none'; } });
        const favsFromLib = lib.filter(s => FavoritesModule.isFavorite(s.videoId));

        if (rawPlaylists.length === 0 && favsFromLib.length === 0 && automaticas.length === 0) {
            grid.innerHTML = '';
            if (empty) { grid.appendChild(empty); empty.style.display = 'flex'; }
            return;
        }

        if (empty) empty.style.display = 'none';

        // Inject virtual favorites playlist at the top
        const allPlaylists = [
            { id: 'favorites', name: i18n.t('t_favorites'), songs: favsFromLib, isVirtual: true },
            ...automaticas,
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
            } else if (esAutomatica(pl.id)) {
                coverHTML = html`
                <div class="playlist-card-cover-auto">
                    <span class="material-symbols-outlined" aria-hidden="true">${pl.icono}</span>
                </div>`;
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
                <div class="playlist-card ${pl.id === 'favorites' ? 'favorites-card' : ''} ${esAutomatica(pl.id) ? 'auto-card' : ''}" data-id="${pl.id}">
                    <div class="playlist-card-cover">${coverHTML}${esSeguida(pl) ? html`<span class="seguida-distintivo" title="${i18n.t('follow_linked')}"><span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span></span>` : ''}</div>
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

    // Las listas automáticas cambian con cada escucha y cada descarga: se
    // recalculan al volver a Listas
    document.addEventListener('vista-cambiada', (e) => {
        if (e.detail === 'playlistsView') renderGrid();
        // Fuera del detalle no hay lista abierta, se salga como se salga (Atrás del
        // sistema, gesto o pestañas). Si no, los refrescos (sincronizar, editar una
        // canción, un corazón) la volvían a abrir desde otra vista y dejaban un
        // detalle de más en el historial: había que borrar una lista varias veces
        if (e.detail !== 'playlistDetailView') currentPlaylistId = null;
    });

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

    // «Nueva playlist» (plan 23): su ventana vive en crear.js
    initCrearLista({ createPlaylist });

    const layoutToggle = document.getElementById('playlistLayoutToggle');
    if (layoutToggle) {
        layoutToggle.addEventListener('click', async () => {
            layoutMode = (layoutMode === 'grid' ? 'list' : 'grid');
            await StorageModule.set(LAYOUT_KEY, layoutMode);
            await renderGrid();
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
