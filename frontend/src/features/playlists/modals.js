/**
 * Los modales del detalle de una lista: editar su nombre y descripción, y
 * elegir canciones de la biblioteca para añadirlas o quitarlas.
 */

import { i18n } from '../../i18n/language-manager.js';
import { closeOverlayOrHideModal, NavigationModule } from '../../ui/navigation.js';
import { LibraryModule } from '../library/library.js';
import { elementoDeCancion, errorDeCampo, portadaDeLista } from './crear.js';
import { textoDeLista } from './orden.js';
import { getPlaylists, savePlaylists } from './store.js';

export function createModalesLista({ openPlaylistDetail, renderGrid, addSongToPlaylist, removeSongFromPlaylist }) {
    let selectorCanciones = null;

    /**
     * «Editar playlist» (plan 23, D5): la ventana común, con la portada y el
     * resumen de la lista. Guardar se apaga sin nombre, y un nombre que ya
     * tiene otra lista se dice bajo el campo en lugar de guardarse.
     */
    function openEditDetailsModal(pl) {
        const modal = document.getElementById('editPlaylistModal');
        const nameInput = document.getElementById('editPlaylistNameInput');
        const descInput = document.getElementById('editPlaylistDescInput');
        const saveBtn = document.getElementById('confirmEditPlaylistBtn');
        const closeBtn = document.getElementById('closeEditPlaylistModal');
        const portada = document.getElementById('editPlaylistCover');
        const subtitulo = document.getElementById('editPlaylistSubtitulo');
        const aviso = document.getElementById('editPlaylistNameError');

        if (!modal || !nameInput || !descInput || !saveBtn) return;

        nameInput.value = pl.name;
        descInput.value = pl.description || '';
        if (portada) portada.innerHTML = portadaDeLista(pl.songs ?? []);
        if (subtitulo) subtitulo.textContent = textoDeLista(pl.songs);
        const actualizarBoton = () => { saveBtn.disabled = !nameInput.value.trim(); };
        actualizarBoton();
        errorDeCampo(nameInput, aviso);

        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('editPlaylistModal');

        const guardar = async () => {
            const newName = nameInput.value.trim();
            if (!newName || saveBtn.disabled) return;

            const playlists = await getPlaylists();
            const repetida = playlists.some((p) => p.id !== pl.id && p.name.toLowerCase() === newName.toLowerCase());
            if (repetida) {
                // Dentro de la ventana: un aviso de abajo quedaría detrás de ella
                errorDeCampo(nameInput, aviso, i18n.t('pl_name_taken'));
                return;
            }
            const target = playlists.find(p => p.id === pl.id);
            if (target) {
                target.name = newName;
                target.description = descInput.value.trim().slice(0, 200);
                await savePlaylists(playlists);
                await openPlaylistDetail(pl.id); // Refresh
                await renderGrid(); // Update main grid
                NavigationModule.closeOverlay();
            }
        };

        saveBtn.onclick = guardar;
        nameInput.oninput = actualizarBoton;
        nameInput.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); guardar(); }
        };

        const closeEdit = () => closeOverlayOrHideModal(modal);

        if (closeBtn) closeBtn.onclick = closeEdit;
        modal.querySelector('.auth-modal-backdrop').onclick = closeEdit;
        setTimeout(() => nameInput.focus(), 100);
    }

    /**
     * «Añadir canciones» desde el detalle de una lista (plan 23, T2): el
     * selector común con la biblioteca, ya marcado con lo que tiene la lista.
     * Cada marca añade o quita al momento, como antes.
     */
    async function openAddSongsModal(playlistId) {
        const modal = document.getElementById('playlistSearchModal');
        const results = document.getElementById('plSearchResults');
        if (!modal || !results) return;

        const lib = (await LibraryModule.getLibrary()).filter((s) => s?.src);
        const pl = (await getPlaylists()).find((p) => p.id === playlistId);
        const subtitulo = document.getElementById('playlistSearchSubtitulo');
        if (subtitulo) subtitulo.textContent = pl?.name ?? '';

        let dentro = new Set((pl?.songs ?? []).map((s) => s.src));
        selectorCanciones?.destruir();
        const { crearSelectorCanciones } = await import('../../ui/selector.js');
        selectorCanciones = crearSelectorCanciones({
            contenedor: results,
            elementos: lib.map(elementoDeCancion),
            seleccion: [...dentro],
            pie: document.getElementById('playlistSearchResumen'),
            alCambiar: async (claves) => {
                const ahora = new Set(claves);
                const porSrc = new Map(lib.map((s) => [s.src, s]));
                for (const src of ahora) if (!dentro.has(src)) await addSongToPlaylist(playlistId, porSrc.get(src));
                for (const src of dentro) if (!ahora.has(src)) await removeSongFromPlaylist(playlistId, src);
                dentro = ahora;
            },
        });

        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('playlistSearchModal');

        const cerrar = () => closeOverlayOrHideModal(modal);
        document.getElementById('closePlaylistSearchModal').onclick = cerrar;
        document.getElementById('playlistSearchDone').onclick = cerrar;
        modal.querySelector('.auth-modal-backdrop').onclick = cerrar;
    }

    return { openEditDetailsModal, openAddSongsModal };
}
