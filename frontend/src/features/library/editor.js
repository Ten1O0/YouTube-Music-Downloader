/**
 * Editar artista y canción (plan 11, T4).
 *
 * Lo automático acierta casi siempre; para lo que no, esta hoja. Lo editado se
 * marca y ninguna limpieza posterior lo vuelve a tocar. «Restaurar» vuelve a
 * lo deducido del título de YouTube.
 *
 * El cambio llega a todas las copias de la canción: la biblioteca, cada lista
 * que la contiene, la cola del reproductor y, si está sonando, lo que muestran
 * la barra, la pantalla completa y el sistema.
 */

import { editarCancion, nombreDe, restaurarCancion } from '../../core/titles.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { LibraryModule } from './library.js';

let srcActual = null;

/** Aplica una transformación a la canción `src` en la biblioteca, las listas y la cola. */
async function aplicarEnTodo(src, transformar) {
    const biblioteca = await LibraryModule.getLibrary();
    const i = biblioteca.findIndex((s) => s.src === src);
    if (i < 0) return null;
    const nueva = transformar(biblioteca[i]);
    if (!nueva) return null;
    biblioteca[i] = nueva;
    await LibraryModule.saveLibrary(biblioteca);

    const listas = await getPlaylists();
    let tocadas = false;
    for (const pl of listas) {
        pl.songs = (pl.songs || []).map((s) => {
            if (s.src !== src) return s;
            tocadas = true;
            return { ...s, artist: nueva.artist, track: nueva.track, extra: nueva.extra, editado: nueva.editado };
        });
    }
    if (tocadas) await savePlaylists(listas);

    PlayerModule.actualizarCancion(src, { artist: nueva.artist, track: nueva.track, extra: nueva.extra, editado: nueva.editado });
    // Solo esa fila: editar no cambia las tarjetas de las listas (plan 19, T5)
    await LibraryModule.renderFila(src);
    if (PlaylistModule.currentPlaylistId) await PlaylistModule.openPlaylistDetail(PlaylistModule.currentPlaylistId);
    return nueva;
}

export async function abrirEditor(src) {
    const hoja = document.getElementById('editSongSheet');
    if (!hoja || !src) return;
    const cancion = (await LibraryModule.getLibrary()).find((s) => s.src === src);
    if (!cancion) return;

    srcActual = src;
    const nombre = nombreDe(cancion);
    document.getElementById('editSongArtist').value = nombre.artista;
    document.getElementById('editSongTrack').value = nombre.titulo;
    document.getElementById('editSongOriginal').textContent = cancion.title || '';
    document.getElementById('editSongRestore').hidden = !cancion.editado;

    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('editSongSheet');
    setTimeout(() => document.getElementById('editSongArtist')?.focus(), 50);
}

async function guardar() {
    const artista = document.getElementById('editSongArtist').value;
    const cancion = document.getElementById('editSongTrack').value;
    const nueva = await aplicarEnTodo(srcActual, (s) => editarCancion(s, { artista, cancion }));
    if (!nueva) {
        showStatus(i18n.t('edit_song_invalid'), 'error');
        return;
    }
    NavigationModule.closeOverlay();
}

async function restaurar() {
    await aplicarEnTodo(srcActual, restaurarCancion);
    NavigationModule.closeOverlay();
}

export function initEditor() {
    const hoja = document.getElementById('editSongSheet');
    if (!hoja) return;
    document.getElementById('editSongRestore')?.addEventListener('click', restaurar);
    document.getElementById('editSongClose')?.addEventListener('click', () => NavigationModule.closeOverlay());
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());
    // Guardar es el envío del formulario (botón o Intro). No se escucha además el
    // clic del botón: se guardaba dos veces y el segundo «atrás» sacaba de la vista
    hoja.querySelector('form')?.addEventListener('submit', (e) => { e.preventDefault(); guardar(); });
    document.getElementById('fullPlayerEdit')?.addEventListener('click', () => {
        const actual = PlayerModule.cancionActual();
        if (actual?.src) abrirEditor(actual.src);
    });
}
