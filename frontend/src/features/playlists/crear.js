/**
 * La ventana «Nueva playlist» (plan 23, T2).
 *
 * Nombre, descripción y canciones; solo el nombre es obligatorio, como en
 * Spotify o Apple Music. Las canciones se eligen con el selector común, y la
 * portada se va componiendo mientras se eligen, igual que la tarjeta de la
 * lista.
 */

import { nombreDe } from '../../core/titles.js';
import { html } from '../../core/html.js';
import { caratulaDe, portadaDeListaGenerada } from '../../core/portada-generada.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { showStatus } from '../../ui/status.js';
import { LibraryModule } from '../library/library.js';

/** Una canción de la biblioteca como elemento del selector. */
export const elementoDeCancion = (song) => ({
    clave: song.src,
    titulo: nombreDe(song).titulo,
    artista: nombreDe(song).artista,
    miniatura: caratulaDe(song),
    duracion: song.duration,
});

/**
 * La portada de una lista: hasta cuatro carátulas en mosaico, una sola si no
 * hay más o, sin ninguna, la portada generada de la lista (`id`, plan 27). La
 * usan esta ventana, «Añadir a playlist», la cabecera y «Editar».
 */
export function portadaDeLista(canciones, id = '') {
    const caratulas = [...new Set(canciones.map((s) => s?.thumbnail).filter(Boolean))].slice(0, 4);
    // Sin ninguna carátula, la portada generada de la lista (plan 27): nunca vacía
    const usadas = caratulas.length >= 4 ? caratulas : caratulas.length ? caratulas.slice(0, 1) : [portadaDeListaGenerada(id)];
    return html`<span class="portada-mosaico portada-mosaico--${usadas.length}">${usadas.map((url) =>
        html`<img src="${url}" alt="" loading="lazy" decoding="async" onerror="this.src='favicon.png'">`)}</span>`;
}

/**
 * El error de un campo, dentro de la propia ventana: un aviso con showStatus
 * se pintaba en Inicio, detrás de la ventana, y no se veía (plan 23). Sin
 * texto, lo quita. Se quita solo en cuanto se vuelve a escribir.
 */
export function errorDeCampo(entrada, aviso, texto = '') {
    if (!entrada || !aviso) return;
    aviso.textContent = texto;
    aviso.hidden = !texto;
    entrada.toggleAttribute('aria-invalid', Boolean(texto));
    entrada.classList.toggle('campo-entrada--error', Boolean(texto));
    if (texto) {
        entrada.focus();
        entrada.addEventListener('input', () => errorDeCampo(entrada, aviso), { once: true });
    }
}

export function initCrearLista({ createPlaylist }) {
    const modal = document.getElementById('createPlaylistModal');
    const abrir = document.getElementById('createPlaylistBtn');
    const cerrar = document.getElementById('closePlaylistModal');
    const crear = document.getElementById('savePlaylistBtn');
    const nombre = document.getElementById('playlistNameInput');
    const descripcion = document.getElementById('playlistDescInput');
    const portada = document.getElementById('createPlaylistCover');
    const lista = document.getElementById('playlistCreateSongsList');
    const resumen = document.getElementById('createPlaylistResumen');
    const errorNombre = document.getElementById('playlistNameError');
    if (!modal || !abrir || !crear || !nombre || !lista) return;

    let selector = null;
    let biblioteca = [];
    // El id de la lista se decide al abrir la ventana: la portada generada que se
    // ve mientras se eligen (plan 27) es la que tendrá al crearla
    let idNueva = '';

    const elegidas = () => {
        const claves = new Set(selector?.seleccionadas() ?? []);
        return biblioteca.filter((s) => claves.has(s.src));
    };
    const pintarPortada = () => { if (portada) portada.innerHTML = portadaDeLista(elegidas(), idNueva); };
    const actualizarBoton = () => { crear.disabled = !nombre.value.trim(); };

    abrir.addEventListener('click', async () => {
        idNueva = Date.now().toString();
        nombre.value = '';
        if (descripcion) descripcion.value = '';
        errorDeCampo(nombre, errorNombre);
        biblioteca = (await LibraryModule.getLibrary()).filter((s) => s?.src);
        selector?.destruir();
        // El selector se carga al abrir la primera ventana que lo usa (presupuesto del plan 19)
        const { crearSelectorCanciones } = await import('../../ui/selector.js');
        selector = crearSelectorCanciones({
            contenedor: lista,
            elementos: biblioteca.map(elementoDeCancion),
            pie: resumen,
            alCambiar: pintarPortada,
        });
        pintarPortada();
        actualizarBoton();
        modal.classList.remove('hidden');
        NavigationModule.pushOverlayState('createPlaylistModal');
        setTimeout(() => nombre.focus(), 100);
    });

    async function crearLista() {
        if (crear.disabled) return;
        crear.disabled = true;
        const canciones = elegidas();
        const r = await createPlaylist(nombre.value, canciones, { descripcion: descripcion?.value ?? '', id: idNueva });
        if (r.success) {
            NavigationModule.closeOverlay();
            showStatus(i18n.t('pl_created', { name: nombre.value.trim() }), 'success');
        } else {
            errorDeCampo(nombre, errorNombre, r.error);
            actualizarBoton();
        }
    }

    nombre.addEventListener('input', actualizarBoton);
    nombre.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); crearLista(); }
    });
    crear.addEventListener('click', crearLista);
    cerrar?.addEventListener('click', () => NavigationModule.closeOverlay());
    modal.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());

    // «Añadir a playlist»: su X y su fondo cierran por el historial, como siempre
    const anadir = document.getElementById('addToPlaylistModal');
    document.getElementById('closeAddToPlaylistModal')?.addEventListener('click', () => NavigationModule.closeOverlay());
    anadir?.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());
}
