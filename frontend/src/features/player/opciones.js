/**
 * «Opciones de la canción»: el botón ⋮ de la pantalla completa (plan 21, T5).
 *
 * Una hoja con lo que tiene sentido para lo que suena: añadirla a una lista,
 * ir a su artista, compartirla, abrirla en YouTube y, si es de la radio,
 * guardarla en la biblioteca. Se carga al primer toque del ⋮ (main.js).
 */

import { nombreDe, normalizarArtista } from '../../core/titles.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { avisar } from '../../ui/toast.js';
import { abrirArtista, hayArtista } from '../library/artists.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { guardarDesdeLaNube } from '../nube/puente.js';
import { esVideoId } from '../sync/validar.js';
import { PlayerModule } from './player.js';

const $ = (id) => document.getElementById(id);

/** El enlace de YouTube de una canción, o null si no viene de YouTube (un fichero importado). */
export const enlaceDe = (song) => (esVideoId(song?.videoId) ? `https://www.youtube.com/watch?v=${song.videoId}` : null);

/**
 * Qué acciones se ofrecen. Pura.
 * - De la radio sin guardar (`song.radio`, como la marca del reproductor):
 *   guardarla, no añadirla a una lista (antes hay que quedársela). Las de la
 *   biblioteca que eligió la radio ya están guardadas.
 * - Ir al artista, solo si tiene vista (canciones descargadas suyas).
 * - Compartir y abrir en YouTube, solo si viene de YouTube.
 */
export function accionesDe(song, { radio = false, artista = false } = {}) {
    const enlace = enlaceDe(song);
    return { guardar: radio, anadir: !radio, artista, compartir: Boolean(enlace), youtube: Boolean(enlace) };
}

let actual = null;

/** Cierra la hoja y espera a que el historial lo haya asentado: así la siguiente se apila bien. */
function cerrar() {
    return new Promise((ok) => {
        const listo = () => { clearTimeout(espera); ok(); };
        const espera = setTimeout(() => { globalThis.removeEventListener('popstate', listo); ok(); }, 400);
        globalThis.addEventListener('popstate', listo, { once: true });
        NavigationModule.closeOverlay();
    });
}

export async function abrirOpciones() {
    const hoja = $('songOptionsSheet');
    const song = PlayerModule.cancionActual();
    if (!hoja || !song) return;
    actual = song;
    const nombre = nombreDe(song);
    const clave = normalizarArtista(nombre.artista);
    // «Guardar», en una de la radio o una que suena desde la nube (plan 29)
    const acciones = accionesDe(song, { radio: song.radio === true || song.desdeNube === true, artista: Boolean(clave) && await hayArtista(clave) });

    $('songOptionsName').textContent = [nombre.titulo, nombre.artista].filter(Boolean).join(' · ');
    $('optRadioSave').hidden = !acciones.guardar;
    $('optAddToPlaylist').hidden = !acciones.anadir;
    $('optArtist').hidden = !acciones.artista;
    $('optShare').hidden = !acciones.compartir;
    $('optYoutube').hidden = !acciones.youtube;
    if (acciones.youtube) $('optYoutube').href = enlaceDe(song);

    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('songOptionsSheet');
}

/** Compartir con la hoja del sistema; si no la hay, el enlace al portapapeles. */
async function compartir(song) {
    const url = enlaceDe(song);
    const { titulo, artista } = nombreDe(song);
    if (navigator.share) {
        try {
            await navigator.share({ title: [titulo, artista].filter(Boolean).join(' · '), url });
        } catch { /* cancelado por el usuario: nada que decir */ }
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        avisar(i18n.t('link_copied'));
    } catch {
        avisar(i18n.t('link_copy_failed'));
    }
}

export function initOpciones() {
    const hoja = $('songOptionsSheet');
    if (!hoja) return;
    $('fullPlayerMore')?.addEventListener('click', abrirOpciones);
    $('songOptionsClose')?.addEventListener('click', () => NavigationModule.closeOverlay());
    hoja.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());

    $('optRadioSave')?.addEventListener('click', async () => {
        const song = actual;
        await cerrar();
        await guardarDesdeLaNube(song);
    });
    $('optAddToPlaylist')?.addEventListener('click', async () => {
        const song = actual;
        await cerrar();
        PlaylistModule.showAddToPlaylist(song);
    });
    $('optArtist')?.addEventListener('click', async () => {
        const clave = normalizarArtista(nombreDe(actual).artista);
        await cerrar();
        PlayerModule.hideFullPlayer();
        await abrirArtista(clave);
    });
    // Compartir necesita el toque del usuario: primero se comparte y luego se cierra
    $('optShare')?.addEventListener('click', async () => {
        await compartir(actual);
        if (!hoja.classList.contains('hidden')) await cerrar();
    });
    // El enlace se abre solo (en la APK, app-shell.js lo manda al navegador del sistema)
    $('optYoutube')?.addEventListener('click', () => { cerrar(); });
}
