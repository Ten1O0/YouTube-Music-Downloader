/**
 * Piezas del reproductor que comparten la barra, la pantalla completa y las
 * letras: botones, carátula, fondo y barra de estado.
 */

import { nombreDe } from '../../core/titles.js';
import { extractVideoId } from '../../core/utils.js';
import { FavoritesModule } from '../favorites/store.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { FALLBACK as PALETA_CASA, paletteFromImage } from '../../ui/palette.js';
import { initBarraEstado } from '../../ui/system-bars.js';

export function toggleHeartButtonState(btn, active) {
    if (!btn) return;
    btn.classList.toggle('active', active);
    const svg = btn.querySelector('svg');
    if (svg) svg.style.fill = active ? 'currentColor' : 'none';
}

export function syncRepeatButtonState(btn, repeatMode) {
    if (!btn) return;
    btn.classList.toggle('active', repeatMode > 0);
    const badge = btn.querySelector('.repeat-one-badge');
    if (badge) badge.style.display = repeatMode === 2 ? 'block' : 'none';
}

export function syncFullPlayerFavoriteButton(song) {
    const fullPlayerFav = document.getElementById('fullPlayerFav');
    if (!song || !fullPlayerFav) return;
    const videoId = song.videoId || song.id || extractVideoId(song.src);
    if (!videoId) return;

    const isFav = FavoritesModule.isFavorite(videoId);
    fullPlayerFav.classList.toggle('active', isFav);
    const svg = fullPlayerFav.querySelector('svg');
    if (svg) svg.style.fill = isFav ? 'currentColor' : 'none';
}

/**
 * Fondo del reproductor con los colores de la carátula (plan 09, T11).
 * Los tres colores son @property de tipo <color>: el CSS los funde de una
 * canción a la siguiente sin necesidad de dos capas.
 */
let ultimaPaleta = PALETA_CASA;

let turnoFondo = 0;

export async function pintarFondoFp(src) {
    const fondo = document.getElementById('fullPlayerBg');
    if (!fondo) return;
    const turno = ++turnoFondo;
    const paleta = (await paletteFromImage(src)) ?? PALETA_CASA;
    // Si mientras tanto cambió la canción, esta respuesta ya no vale
    if (turno !== turnoFondo) return;
    ultimaPaleta = paleta;
    ['--art-c1', '--art-c2', '--art-c3'].forEach((v, i) => fondo.style.setProperty(v, paleta[i]));
    barraEstado.refrescar();
}

// Barra de estado de la APK: del color del reproductor mientras está abierto (T20)
const barraEstado = initBarraEstado({
    reproductor: document.getElementById('fullPlayer'),
    paleta: () => ultimaPaleta,
});

/** Título y artista en la barra y en la pantalla completa (también tras editarlos, plan 11 T4). */
export function pintarNombre(song) {
    const nombre = nombreDe(song);
    for (const id of ['playerTitle', 'fullPlayerTitle']) {
        const el = document.getElementById(id);
        if (el) el.textContent = nombre.titulo;
    }
    for (const id of ['playerArtist', 'fullPlayerArtist']) {
        const el = document.getElementById(id);
        if (el) el.textContent = nombre.artista || '—';
    }
}

export function updatePlayerUI(song, finalThumb) {
    const pThumb = document.getElementById('playerThumb');
    const fpThumb = document.getElementById('fullPlayerThumb');
    const fpBg = document.getElementById('fullPlayerBg');
    const fpSource = document.getElementById('fullPlayerSource');

    pintarNombre(song);
    if (pThumb) pThumb.src = finalThumb || '';
    if (fpThumb) fpThumb.src = finalThumb || '';
    if (fpBg) pintarFondoFp(finalThumb);
    if (fpSource) {
        if (NavigationModule.currentView === 'playlists' || PlaylistModule.currentPlaylistId) {
            fpSource.textContent = PlaylistModule.currentPlaylistName || 'Playlist';
        } else {
            fpSource.textContent = i18n.t('library_title');
        }
    }
}
