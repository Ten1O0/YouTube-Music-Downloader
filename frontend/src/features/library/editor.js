/**
 * Editar artista y canción (plan 11, T4).
 *
 * Lo automático acierta casi siempre; para lo que no, esta hoja. Lo editado se
 * marca y ninguna limpieza posterior lo vuelve a tocar. «Restaurar» vuelve a
 * lo deducido del título de YouTube.
 *
 * La portada también se elige aquí, como en las listas: la suya (su carátula o,
 * sin ella, la generada de su artista) o una de las 8 generadas (`portada`:
 * gen:0 … gen:7). Viaja con la cuenta.
 *
 * El cambio llega a todas las copias de la canción: la biblioteca, cada lista
 * que la contiene, la cola del reproductor y, si está sonando, lo que muestran
 * la barra, la pantalla completa y el sistema.
 */

import { resolveNativeThumbnail } from '../../core/audio-store.js';
import { html } from '../../core/html.js';
import { caratulaDe, portadaDeListaGenerada, varianteDe } from '../../core/portada-generada.js';
import { nombreDe, restaurarCancion } from '../../core/titles.js';
import { i18n } from '../../i18n/language-manager.js';
import '../../ui/portadas.css';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { PlayerModule } from '../player/player.js';
import { updatePlayerUI } from '../player/ui.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { cancionEditada, conPortada } from './editor-modelo.js';
import { LibraryModule } from './library.js';

// Las de las listas (core/portadas-generadas.js), sin cargar el generador para contarlas
const VARIANTES_GENERADAS = 8;

let srcActual = null;
let portadaElegida = '';

/** La rejilla de portadas: la suya y las generadas, con la elegida marcada. */
function pintarPortadas(cancion) {
    const rejilla = document.getElementById('editSongCovers');
    if (!rejilla) return;
    const id = cancion.videoId || cancion.src || cancion.title || '';
    const opcion = (valor, src, nombre) => html`<button type="button" class="portadas-opcion" role="radio"
        aria-checked="${portadaElegida === valor}" aria-label="${nombre}" data-portada="${valor}"><img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.src='favicon.png'"></button>`;
    rejilla.innerHTML = html`${opcion('', caratulaDe(conPortada(cancion, '')), i18n.t('pl_cover_auto'))}${Array.from({ length: VARIANTES_GENERADAS }, (_, i) =>
        opcion(`gen:${i}`, portadaDeListaGenerada(id, i), i18n.t('pl_cover_generated', { n: i + 1 })))}`;
    rejilla.onclick = (e) => {
        const boton = e.target.closest('.portadas-opcion');
        if (!boton) return;
        portadaElegida = boton.dataset.portada;
        for (const b of rejilla.querySelectorAll('.portadas-opcion')) b.setAttribute('aria-checked', String(b === boton));
    };
}

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
            return conPortada({ ...s, artist: nueva.artist, track: nueva.track, extra: nueva.extra, editado: nueva.editado }, nueva.portada);
        });
    }
    if (tocadas) await savePlaylists(listas);

    // En el reproductor, con la carátula ya resuelta: la barra, la pantalla
    // completa y el sistema la enseñan si está sonando
    const { finalThumb, runtimeThumbnailNative } = await resolveNativeThumbnail(nueva);
    PlayerModule.actualizarCancion(src, {
        artist: nueva.artist, track: nueva.track, extra: nueva.extra, editado: nueva.editado, portada: nueva.portada,
        _caratulaPintada: finalThumb, _runtimeThumbnailNative: runtimeThumbnailNative,
    });
    const sonando = PlayerModule.cancionActual();
    if (sonando?.src === src) updatePlayerUI(sonando, finalThumb);
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
    portadaElegida = varianteDe(cancion.portada) === null ? '' : cancion.portada;
    pintarPortadas(cancion);

    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('editSongSheet');
    setTimeout(() => document.getElementById('editSongArtist')?.focus(), 50);
}

async function guardar() {
    const artista = document.getElementById('editSongArtist').value;
    const cancion = document.getElementById('editSongTrack').value;
    const nueva = await aplicarEnTodo(srcActual, (s) => cancionEditada(s, { artista, cancion, portada: portadaElegida }));
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
