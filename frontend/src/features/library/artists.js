/**
 * La biblioteca por artistas (plan 11, T6).
 *
 * Un selector «Canciones · Artistas» en la Biblioteca (el agrupado, en
 * artist-groups.js). Cada artista abre su propia vista, integrada en la
 * navegación y en el botón atrás.
 */

import { html } from '../../core/html.js';
import { StorageModule } from '../../core/storage.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { PlayerModule } from '../player/player.js';
import { CLAVE_CONTADORES } from '../player/listens.js';
import { agruparPorArtista } from './artist-groups.js';
import { LibraryModule, renderLibraryItem } from './library.js';

const CLAVE_MODO = 'ytdl_library_view';
let modo = 'canciones';
let artistaAbierto = null;

async function artistas() {
    const [biblioteca, contadores] = await Promise.all([LibraryModule.getLibrary(), StorageModule.get(CLAVE_CONTADORES)]);
    return agruparPorArtista(biblioteca, contadores || {}, i18n.currentLang || 'es');
}

/** Pinta la lista de artistas si es el modo elegido. La llama la biblioteca al repintarse. */
export async function refrescarArtistas() {
    const lista = document.getElementById('artistsList');
    const canciones = document.getElementById('libraryList');
    if (!lista || !canciones) return;
    const grupos = modo === 'artistas' ? await artistas() : [];

    // Sin canciones, el estado vacío de la biblioteca sirve para los dos modos
    const verArtistas = modo === 'artistas' && grupos.length > 0;
    lista.classList.toggle('hidden', !verArtistas);
    canciones.classList.toggle('hidden', verArtistas);
    if (!verArtistas) return;

    lista.innerHTML = grupos.map((g) => html`
        <button type="button" class="artista-fila" data-clave="${g.clave}">
            <img class="artista-foto" src="${g.portada || 'favicon.png'}" alt="" onerror="this.src='favicon.png'">
            <span class="artista-texto">
                <span class="artista-nombre">${g.nombre}</span>
                <span class="artista-cuenta">${contarCanciones(g.canciones.length)}</span>
            </span>
            <svg class="artista-flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
        </button>`).join('');
    lista.querySelectorAll('.artista-fila').forEach((fila) => {
        fila.addEventListener('click', () => abrirArtista(fila.dataset.clave));
    });
}

export async function abrirArtista(clave) {
    const grupo = (await artistas()).find((g) => g.clave === clave);
    if (!grupo) return;
    artistaAbierto = grupo;

    document.getElementById('artistDetailName').textContent = grupo.nombre;
    document.getElementById('artistDetailCount').textContent = contarCanciones(grupo.canciones.length);
    const foto = document.getElementById('artistDetailPhoto');
    if (foto) foto.src = grupo.portada || 'favicon.png';

    const lista = document.getElementById('artistDetailList');
    lista.innerHTML = grupo.canciones.map((s, i) => renderLibraryItem(s, i, { context: 'artista' })).join('');
    lista.querySelectorAll('.library-item').forEach((el, i) => {
        el.addEventListener('click', () => PlayerModule.play(grupo.canciones[i], [...grupo.canciones], i));
    });
    NavigationModule.switchView('artistDetailView');
}

function reproducirArtista(aleatorio) {
    const canciones = artistaAbierto?.canciones;
    if (!canciones?.length) return;
    if (aleatorio !== PlayerModule.isShuffled()) PlayerModule.toggleShuffle();
    const inicio = aleatorio ? Math.floor(Math.random() * canciones.length) : 0;
    PlayerModule.play(canciones[inicio], [...canciones], inicio);
}

function pintarSelector() {
    document.querySelectorAll('#libraryModo [data-modo]').forEach((b) => {
        b.setAttribute('aria-selected', String(b.dataset.modo === modo));
    });
}

export async function initArtistas() {
    try { modo = (await StorageModule.get(CLAVE_MODO)) === 'artistas' ? 'artistas' : 'canciones'; } catch { /* sin almacenamiento */ }
    pintarSelector();
    document.querySelectorAll('#libraryModo [data-modo]').forEach((b) => {
        b.addEventListener('click', async () => {
            if (modo === b.dataset.modo) return;
            modo = b.dataset.modo;
            pintarSelector();
            StorageModule.set(CLAVE_MODO, modo).catch(() => {});
            await refrescarArtistas();
        });
    });
    document.getElementById('artistPlayBtn')?.addEventListener('click', () => reproducirArtista(false));
    document.getElementById('artistShuffleBtn')?.addEventListener('click', () => reproducirArtista(true));
    document.getElementById('backToLibraryBtn')?.addEventListener('click', () => NavigationModule.goBack());
    await refrescarArtistas();
}
