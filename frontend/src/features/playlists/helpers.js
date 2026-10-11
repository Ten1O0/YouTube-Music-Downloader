/**
 * Operaciones auxiliares de las listas propias: borrar, actualizar y la
 * cabecera del detalle. La selección de canciones al crear una lista está en
 * crear.js, con el selector común (plan 23).
 */

import { StorageModule } from '../../core/storage.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { FavoritesModule } from '../favorites/store.js';
import { LibraryModule } from '../library/library.js';
import { CLAVE_CONTADORES } from '../player/listens.js';
import { PlayerModule } from '../player/player.js';
import { syncRepeatButtonState } from '../player/ui.js';
import { esAutomatica, listasAutomaticas, PRESENTACION_AUTO } from './auto.js';
import { textoDeLista } from './orden.js';
import { PlaylistModule } from './playlists.js';

/** Guarda la lista cambiada y la repinta; también vacía, que ya no se borra (plan 23). */
export async function guardarYRepintarLista(playlistId, playlists, pl) {
    await PlaylistModule.savePlaylists(playlists);
    await PlaylistModule.renderGrid();

    // Refresh detail view instantly if it's the current one
    if (PlaylistModule.currentPlaylistId === playlistId) {
        const countEl = document.getElementById('playlistDetailCount');
        if (countEl) countEl.textContent = textoDeLista(pl.songs);
        PlaylistModule.renderPlaylistSongs(pl);
    }
}

/** Las listas automáticas con su nombre traducido (plan 11, T7). */
export async function cargarListasAutomaticas() {
    let contadores = {};
    try { contadores = (await StorageModule.get(CLAVE_CONTADORES)) || {}; } catch { /* sin almacenamiento */ }
    const biblioteca = await LibraryModule.getLibrary();
    return listasAutomaticas(biblioteca, contadores, Date.now()).map((l) => ({
        ...l,
        name: i18n.t(PRESENTACION_AUTO[l.id].nombre),
        icono: PRESENTACION_AUTO[l.id].icono,
        isVirtual: true,
    }));
}

export async function resolvePlaylistDetails(playlistId) {
    if (esAutomatica(playlistId)) {
        // Vacía no se muestra en la rejilla, pero puede quedarse vacía con el detalle abierto
        const presentacion = PRESENTACION_AUTO[playlistId];
        if (!presentacion) return null;
        const lista = (await cargarListasAutomaticas()).find((l) => l.id === playlistId);
        return lista ?? { id: playlistId, name: i18n.t(presentacion.nombre), songs: [], isVirtual: true };
    }
    if (playlistId === 'favorites') {
        const lib = await LibraryModule.getLibrary();
        const favorites = lib.filter(s => FavoritesModule.isFavorite(s.videoId));
        return {
            id: 'favorites',
            name: i18n.t('t_favorites'),
            songs: favorites
        };
    }
    const playlists = await PlaylistModule.getPlaylists();
    return playlists.find(p => p.id === playlistId);
}

export function syncPlaylistDetailHeader(pl, playlistId) {
    const addSection = document.querySelector('.playlist-add-section');
    if (addSection) {
        addSection.style.display = (playlistId === 'favorites' || esAutomatica(playlistId) ? 'none' : 'block');
    }

    const nameEl = document.getElementById('playlistDetailName');
    const descEl = document.getElementById('playlistDetailDescription');
    const countEl = document.getElementById('playlistDetailCount');

    if (nameEl) nameEl.textContent = pl.name;
    if (descEl) {
        descEl.textContent = pl.description || i18n.t('pl_no_description');
        descEl.style.display = (pl.description ? 'block' : 'none');
    }
    // «12 canciones · 47 min · 3 en la nube» (plan 23, T4)
    if (countEl) countEl.textContent = textoDeLista(pl.songs);
}

export function syncPlaylistPlayerStates() {
    const shufVal = PlayerModule.isShuffled();
    const repVal = PlayerModule.getRepeatMode();

    const plShuf = document.getElementById('plShuffleBtn');
    if (plShuf) plShuf.classList.toggle('active', shufVal);

    syncRepeatButtonState(document.getElementById('plRepeatBtn'), repVal);
}

/**
 * Borra una lista sin preguntar (plan 24, P9): se borra, se sale de su detalle
 * y un aviso de 5 s deja deshacerlo. Antes había una ventana de confirmación.
 */
let borrando = false;
export async function handlePlaylistDeletionUI(pl) {
    // Un doble toque no la borra dos veces
    if (borrando) return;
    borrando = true;
    try {
        const { borrarListaConDeshacer } = await import('../seleccion/acciones.js');
        await borrarListaConDeshacer(pl);
        // Atrás por el historial hasta dejar atrás las capas y el detalle de la
        // lista borrada, cuantas entradas sean (plan 23)
        if (NavigationModule.getCurrentView() === 'playlistDetailView') NavigationModule.salirDelDetalle();
    } finally {
        borrando = false;
    }
}
