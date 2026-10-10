/**
 * La ventana «Añadir a playlist» (plan 23, T2).
 *
 * Cada lista con su portada, cuántas canciones tiene y cuánto dura, y una
 * marca si ya tiene la canción. Tocar una la añade o la quita al momento. Las
 * usadas hace poco salen arriba y, con muchas listas, aparece un buscador. La
 * lista nueva se crea aquí mismo: antes se abría otra ventana encima.
 */

import { duracionTotal, segundosDe } from '../../core/duracion.js';
import { nombreDe } from '../../core/titles.js';
import { html, seguro } from '../../core/html.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { errorDeCampo, portadaDeLista } from './crear.js';
import { PlaylistModule } from './playlists.js';
import { getPlaylists } from './store.js';

const CLAVE_USADAS = 'ytdl_listas_usadas';
/** A partir de cuántas listas aparece el buscador. */
const CON_BUSCADOR = 6;
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Las listas cuyo nombre contiene todas las palabras buscadas. */
function filtrarListas(listas, consulta) {
    const palabras = sinTildes(consulta).trim().split(/\s+/).filter(Boolean);
    return listas.filter((pl) => palabras.every((p) => sinTildes(pl.name).includes(p)));
}

const ICONO_CHECK = seguro('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4L18.5 7.5"/></svg>');

function usadas() {
    try { return JSON.parse(localStorage.getItem(CLAVE_USADAS)) || {}; } catch { return {}; }
}

function apuntarUso(id) {
    try { localStorage.setItem(CLAVE_USADAS, JSON.stringify({ ...usadas(), [id]: Date.now() })); } catch { /* sin almacenamiento: solo se pierde el orden */ }
}

/** Las listas, las usadas hace poco primero; las demás, en su orden. */
export function ordenarPorUso(listas, uso) {
    return listas.map((pl, i) => ({ pl, i })).sort((a, b) => (uso[b.pl.id] || 0) - (uso[a.pl.id] || 0) || a.i - b.i).map((x) => x.pl);
}

/** «12 canciones · 47 min». */
export function resumenDeLista(pl) {
    const total = duracionTotal(pl.songs.reduce((s, c) => s + segundosDe(c), 0));
    return total ? `${contarCanciones(pl.songs.length)} · ${total}` : contarCanciones(pl.songs.length);
}

export function createHojaAnadir({ createPlaylist }) {
    const modal = document.getElementById('addToPlaylistModal');
    const contenedor = document.getElementById('addToPlaylistList');
    const subtitulo = document.getElementById('addToPlaylistSongName');
    const nueva = document.getElementById('addToPlaylistCreateNewBtn');
    const form = document.getElementById('addToPlaylistNewForm');
    const nombre = document.getElementById('newPlaylistNameInput');
    const cancelar = document.getElementById('cancelCreateNewPlaylistBtn');
    const buscar = document.getElementById('addToPlaylistBuscar');
    const buscarEntrada = document.getElementById('addToPlaylistBuscarInput');
    const errorNombre = document.getElementById('newPlaylistNameError');

    let cancion = null;
    let listas = [];

    const fila = (pl) => {
        const tiene = pl.songs.some((s) => s.src === cancion.src);
        return html`<button type="button" class="anadir-lista${tiene ? ' elegida' : ''}" data-id="${pl.id}" aria-pressed="${tiene}">
            <span class="anadir-portada">${portadaDeLista(pl.songs)}</span>
            <span class="anadir-textos"><span class="anadir-nombre">${pl.name}</span><span class="anadir-meta">${resumenDeLista(pl)}</span></span>
            <span class="selector-marca">${ICONO_CHECK}</span>
        </button>`;
    };

    function pintar() {
        const consulta = buscarEntrada?.value ?? '';
        const visibles = filtrarListas(listas, consulta);
        if (!listas.length) {
            contenedor.innerHTML = html`<p class="selector-vacio">${i18n.t('atp_empty')}</p>`;
        } else if (!visibles.length) {
            contenedor.innerHTML = html`<p class="selector-vacio">${i18n.t('sel_empty_q', { q: consulta.trim() })}</p>`;
        } else {
            contenedor.innerHTML = html`${visibles.map(fila)}`;
        }
        if (buscar) buscar.hidden = listas.length <= CON_BUSCADOR;
    }

    async function recargar() {
        listas = ordenarPorUso(await getPlaylists(), usadas());
        pintar();
    }

    function mostrarFormulario(visible) {
        form.hidden = !visible;
        nueva.hidden = visible;
        errorDeCampo(nombre, errorNombre);
        if (visible) { nombre.value = ''; setTimeout(() => nombre.focus(), 50); }
    }

    contenedor.addEventListener('click', async (e) => {
        const boton = e.target.closest('.anadir-lista');
        if (!boton || !cancion) return;
        const pl = listas.find((l) => l.id === boton.dataset.id);
        if (!pl) return;
        const anadir = !boton.classList.contains('elegida');
        // Se ve al momento; el guardado va detrás
        boton.classList.toggle('elegida', anadir);
        boton.setAttribute('aria-pressed', String(anadir));
        if (anadir) {
            await PlaylistModule.addSongToPlaylist(pl.id, cancion);
            apuntarUso(pl.id);
            showStatus(i18n.t('atp_added', { name: pl.name }), 'success');
        } else {
            await PlaylistModule.removeSongFromPlaylist(pl.id, cancion.src);
            showStatus(i18n.t('atp_removed', { name: pl.name }), 'info');
        }
        // El recuento y la duración de esa fila, ya con el cambio
        const actualizada = (await getPlaylists()).find((l) => l.id === pl.id);
        if (actualizada) {
            listas = listas.map((l) => (l.id === pl.id ? actualizada : l));
            const meta = boton.querySelector('.anadir-meta');
            if (meta) meta.textContent = resumenDeLista(actualizada);
        }
    });

    nueva?.addEventListener('click', () => mostrarFormulario(true));
    cancelar?.addEventListener('click', () => mostrarFormulario(false));
    buscarEntrada?.addEventListener('input', pintar);
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const texto = nombre.value.trim();
        if (!texto) { errorDeCampo(nombre, errorNombre, i18n.t('pl_name_required')); return; }
        const r = await createPlaylist(texto, [cancion]);
        if (!r.success) { errorDeCampo(nombre, errorNombre, r.error); return; }
        if (r.id) apuntarUso(r.id);
        showStatus(i18n.t('pl_created_with_song', { name: texto }), 'success');
        mostrarFormulario(false);
        await recargar();
    });

    async function showAddToPlaylist(song) {
        if (!modal || !contenedor) return;
        cancion = song;
        if (subtitulo) subtitulo.textContent = nombreDe(song).titulo;
        if (buscarEntrada) buscarEntrada.value = '';
        mostrarFormulario(false);
        await recargar();
        if (modal.classList.contains('hidden')) {
            modal.classList.remove('hidden');
            NavigationModule.pushOverlayState('addToPlaylistModal');
        }
        // La X y el fondo la cierran por el historial (crear.js). Ocultarla aquí
        // al instante dejaba el «atrás» sin hoja y cerraba la de debajo (plan 21, T5)
    }

    return { showAddToPlaylist };
}
