/**
 * Listas de reproducción propias.
 */

import { conEsqueleto } from '../../ui/skeleton.js';
import { html } from '../../core/html.js';
import { StorageModule } from '../../core/storage.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { animateListChange, measure } from '../../ui/motion/list.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule, renderLibraryItem } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { esAutomatica } from './auto.js';
import { cargarListasAutomaticas, guardarYRepintarLista, handlePlaylistDeletionUI, resolvePlaylistDetails, syncPlaylistDetailHeader, syncPlaylistPlayerStates } from './helpers.js';
import { ordenDeVista, textoDeLista } from './orden.js';
import { caratulaElegida } from './portada.js';
import { initCrearLista } from './crear.js';
import { getPlaylists, savePlaylists } from './store.js';
import { esSeguida } from '../seguidas.js';
import { esNube } from '../sync/fusion.js';

// ========================================
// PlaylistModule — Playlists personalizadas
// ========================================
/** La cabecera de una lista (plan 24): se carga al abrir la primera. */
let cabeceraCargada = null;
const cargarCabecera = () => (cabeceraCargada ??= import('./detalle/cabecera.js').catch((e) => {
    // Sin ella la lista se abre igual, con su cabecera de texto; se reintenta en la siguiente
    console.warn('[Listas] No se pudo cargar la cabecera:', e);
    cabeceraCargada = null;
    return null;
}));

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
        const hecho = document.getElementById('plReorderDone');
        if (hecho) hecho.hidden = true;

        const pl = await resolvePlaylistDetails(playlistId);
        if (!pl) return;

        // Sync header and section displays via helper
        syncPlaylistDetailHeader(pl, playlistId);
        // La portada, sus colores y el menú ⋮ (plan 24), cargados al abrir la primera lista
        const cabecera = await cargarCabecera();
        cabecera?.pintarCabecera(pl, {
            virtual: playlistId === 'favorites' || esAutomatica(playlistId),
            // Tras «Descargar las que faltan», con sus canciones ya descargadas
            refrescar: () => (currentPlaylistId === playlistId ? openPlaylistDetail(playlistId) : null),
        });
        cabecera?.vigilarBarraFija();
        detalle = cabecera;
        // Buscar, ordenar y la lista vacía (plan 24, P5 y P12)
        const entrando = NavigationModule.getCurrentView() !== 'playlistDetailView';
        // Las recomendadas del final (plan 24, P7), solo en las listas propias
        cabecera?.vista.vigilarRecomendadas(pl, { propia: playlistId !== 'favorites' && !esAutomatica(playlistId), entrando });
        cabecera?.vista.alAbrir(pl, {
            alCambiar: repintarVista,
            entrando,
            anadir: esAutomatica(playlistId) ? null : () => modales().then((m) => m.openAddSongsModal(playlistId)),
        });

        // Sync player states via helper
        syncPlaylistPlayerStates();

        // Bind Action Bar Buttons
        bindActionButtons(pl, cabecera);

        // Render songs in playlist
        renderPlaylistSongs(pl);

        // La barra de las listas vinculadas a YouTube la pinta follows.js (plan 14)
        document.dispatchEvent(new CustomEvent('lista-abierta', { detail: pl }));

        // Switch to detail view
        NavigationModule.switchView('playlistDetailView');
    }

    function bindActionButtons(pl, cabecera) {
        const btnPlShuffle = document.getElementById('plShuffleBtn');
        const btnPlRepeat = document.getElementById('plRepeatBtn');
        const btnPlPlay = document.getElementById('plPlayBtn');
        const automatica = esAutomatica(pl.id);
        const calculada = pl.id === 'favorites' || automatica;

        // El menú ⋮ (plan 24, P2). Favoritos y las automáticas se calculan: no se
        // editan, ordenan ni borran, y a las automáticas tampoco se les añade nada
        const mas = document.getElementById('plMoreBtn');
        if (mas) {
            mas.onclick = () => cabecera?.abrirMenu(pl, {
                anadir: automatica ? null : () => modales().then((m) => m.openAddSongsModal(pl.id)),
                editar: calculada ? null : () => modales().then((m) => m.openEditDetailsModal(pl)),
                // «Ordenar por» (plan 24, P5), también en las calculadas; «Mover a mano», solo en las propias
                ordenar: () => cabecera?.vista.abrirOrden(pl, { alCambiar: repintarVista, aMano: calculada ? null : () => toggleEditMode() }),
                // La selección múltiple (plan 24, P8) es de la sesión A: se carga al usarla
                seleccionar: calculada ? null : () => import('../seleccion/seleccion.js')
                    .then((m) => m.entrarEnSeleccion({ contexto: 'lista', playlistId: pl.id }))
                    .catch((err) => console.warn('[Listas] No se pudo abrir la selección:', err)),
                eliminar: calculada ? null : () => handlePlaylistDeletionUI(pl),
            });
        }
        const hecho = document.getElementById('plReorderDone');
        if (hecho) hecho.onclick = () => toggleEditMode();

        if (btnPlPlay) {
            btnPlPlay.onclick = () => {
                // Lo que se ve: en su orden y, si se busca, solo lo encontrado (plan 24, P5)
                const vista = vistaDe(pl);
                if (vista.length > 0) {
                    PlayerModule.play(vista[0], vista, 0);
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

    // La vista de la lista (plan 24): se carga con la cabecera al abrir la primera
    let detalle = null;
    const vistaDe = (pl) => detalle?.vista.vistaDeLista(pl, { aMano: isEditMode }) ?? ordenDeVista(pl.songs);
    const repintarVista = () => { if (listaPintada) renderPlaylistSongs(listaPintada); };

    async function toggleEditMode() {
        isEditMode = !isEditMode;
        const hecho = document.getElementById('plReorderDone');
        if (hecho) hecho.hidden = !isEditMode;

        const playlists = await getPlaylists();
        const pl = playlists.find(p => p.id === currentPlaylistId);
        if (pl) renderPlaylistSongs(pl);
    }

    // ── Editar y añadir canciones (modals.js): solo desde el menú ⋮, se cargan al usarlos ──
    let cargaModales = null;
    const modales = () => (cargaModales ??= import('./modals.js').then((m) => m.createModalesLista({
        openPlaylistDetail, renderGrid, addSongToPlaylist, removeSongFromPlaylist,
    })).catch((e) => { cargaModales = null; throw e; }));

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
            // En el orden en que se ve (plan 23, T4; plan 24, P5)
            const vista = vistaDe(pl);
            const i = vista.findIndex((s) => s.src === fila.dataset.src);
            const song = vista[i];
            if (!song) return;
            const quitar = e.target.closest('.pl-remove-btn');
            const corazon = e.target.closest('.favorite-btn');
            if (quitar) {
                e.stopPropagation();
                // Con su aviso de «Deshacer» (plan 24, P9)
                const { quitarDeListaConDeshacer } = await import('../seleccion/acciones.js');
                await quitarDeListaConDeshacer(pl.id, [quitar.dataset.src]);
            } else if (corazon) {
                e.stopPropagation();
                FavoritesModule.toggleFavorite(song, corazon);
            } else if (!isEditMode && !e.target.closest('.library-item-btn') && !e.target.closest('.pl-drag-handle')) {
                PlayerModule.play(song, vista, i);
            }
        });
    }

    // El estado vacío vive dentro de la lista: pintar las filas lo saca del
    // documento, así que se guarda para volver a meterlo (con sus botones)
    let vacio = null;

    function renderPlaylistSongs(pl) {
        const list = document.getElementById('playlistDetailList');
        const empty = (vacio ??= document.getElementById('playlistDetailEmpty'));
        if (!list) return;

        if (pl.songs.length === 0) {
            detalle?.vista.pintarSinFilas(pl, 0);
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
        // Lo descargado primero y lo de la nube después (plan 23, T4), en el
        // orden elegido y con lo que se busca (plan 24, P5)
        const vista = vistaDe(pl);
        detalle?.vista.pintarSinFilas(pl, vista.length);
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

        // Mover a mano (Sortable): lo prepara la vista de la lista, cargada al abrirla
        if (isEditMode && detalle) {
            detalle.vista.ordenarAMano(list, pl);
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
            // Los estilos, en listas.css (plan 24: fuera del JS del arranque)
            if (pl.id === 'favorites') {
                coverHTML = html`<div class="playlist-card-cover-favorites"><svg viewBox="0 0 24 24" fill="var(--accent-error)" stroke="var(--accent-error)" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>`;
            } else if (esAutomatica(pl.id)) {
                coverHTML = html`<div class="playlist-card-cover-auto"><span class="material-symbols-outlined" aria-hidden="true">${pl.icono}</span></div>`;
            } else {
                // La elegida a mano en «Editar» (plan 24, P11), o el mosaico
                const elegida = caratulaElegida(pl);
                const covers = elegida ? [elegida] : pl.songs.slice(0, 4).map(s => s.thumbnail).filter(Boolean);
                if (covers.length >= 4) {
                    coverHTML = html`<div class="playlist-card-cover-grid">${covers.map(c => html`<img src="${c}" alt="">`)}</div>`;
                } else if (covers.length > 0) {
                    coverHTML = html`<img src="${covers[0]}" alt="" onerror="this.src='favicon.png'">`;
                } else {
                    coverHTML = html`<div class="playlist-card-cover-vacia"><span class="material-symbols-outlined">music_note</span></div>`;
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
