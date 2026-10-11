/**
 * Selección múltiple (plan 24, P8), en la biblioteca y en una lista.
 *
 * Se entra con una pulsación larga en el móvil, con Cmd/Ctrl o Mayús + clic en
 * el ordenador (entrada.js) o desde «Seleccionar» en el menú ⋮ de una lista.
 * Mientras dura, tocar una fila la marca en vez de reproducirla, con Mayús se
 * marca un tramo, y una barra abajo dice cuántas hay y qué hacer con ellas:
 * añadir a una playlist o a la cola, descargar las de la nube y quitar (de la
 * lista) o borrar (de la biblioteca), con deshacer (P9).
 *
 * La selección se guarda por `src`: si la lista se repinta (buscar, ordenar,
 * una descarga que termina), las marcas se vuelven a poner solas.
 */

import { html, seguro } from '../../core/html.js';
import { i18n } from '../../i18n/language-manager.js';
import { NavigationModule } from '../../ui/navigation.js';
import { avisar } from '../../ui/toast.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { resolvePlaylistDetails } from '../playlists/helpers.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { esNube } from '../sync/fusion.js';
import './seleccion.css';

export const LISTAS = '#libraryList, #playlistDetailList';

const ICONO_CHECK = seguro('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4L18.5 7.5"/></svg>');
const ICONOS = {
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
    lista: '<path d="M4 6h11M4 12h11M4 18h7"/><path d="M18 14v6M15 17h6"/>',
    cola: '<path d="M4 6h16M4 12h10M4 18h10"/><path d="M17 15l4 3-4 3z"/>',
    descargar: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    quitar: '<path d="M5 12h14"/><circle cx="12" cy="12" r="9"/>',
    borrar: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const icono = (nombre) => html`<svg viewBox="0 0 24 24" aria-hidden="true">${seguro(ICONOS[nombre])}</svg>`;

let estado = null;

const filas = () => [...(estado?.contenedor.querySelectorAll('.library-item[data-src]') ?? [])]
    .filter((f) => !f.classList.contains('library-item-unavailable'));

/** ¿Se puede quitar de esta lista? Favoritos y las automáticas se calculan. */
function editable() {
    return estado.contexto === 'lista' && Boolean(estado.contenedor.querySelector('.pl-remove-btn'));
}

/** Pone la marca y su estado en cada fila; las filas nuevas (repintadas) también. */
function marcar() {
    for (const fila of filas()) {
        const contenido = fila.querySelector('.library-item-content');
        if (contenido && !contenido.querySelector(':scope > .sel-marca')) {
            contenido.insertAdjacentHTML('afterbegin', html`<span class="selector-marca sel-marca" aria-hidden="true">${ICONO_CHECK}</span>`);
        }
        const elegida = estado.elegidas.has(fila.dataset.src);
        fila.classList.toggle('seleccionada', elegida);
        fila.setAttribute('aria-selected', String(elegida));
    }
}

function pintarBarra() {
    const n = estado.elegidas.size;
    const visibles = filas();
    const todas = visibles.length > 0 && visibles.every((f) => estado.elegidas.has(f.dataset.src));
    const hayNube = visibles.some((f) => estado.elegidas.has(f.dataset.src) && f.classList.contains('library-item-nube'));
    const boton = (accion, texto, { peligro = false, oculto = false } = {}) => html`
        <button type="button" class="sel-accion${peligro ? ' sel-accion--peligro' : ''}" data-accion="${accion}" ${oculto ? 'hidden' : ''} ${n === 0 ? 'disabled' : ''}>
            ${icono(accion)}<span>${texto}</span>
        </button>`;
    estado.barra.innerHTML = html`
        <div class="sel-cabeza">
            <button type="button" class="sel-cerrar" data-accion="cerrar" aria-label="${i18n.t('sel_exit')}">${icono('cerrar')}</button>
            <span class="sel-cuenta" aria-live="polite">${n === 0 ? i18n.t('sel_0') : n === 1 ? i18n.t('sel_1') : i18n.t('sel_n', { n })}</span>
            <button type="button" class="sel-todo" data-accion="todo">${i18n.t(todas ? 'sel_none' : 'sel_all')}</button>
        </div>
        <div class="sel-acciones">
            ${boton('lista', i18n.t('t_add_to_playlist'))}
            ${boton('cola', i18n.t('sel_to_queue'))}
            ${boton('descargar', i18n.t('sel_download'), { oculto: !hayNube })}
            ${estado.contexto === 'biblioteca'
                ? boton('borrar', i18n.t('t_delete'), { peligro: true })
                : boton('quitar', i18n.t('t_remove'), { peligro: true, oculto: !editable() })}
        </div>`;
}

function actualizar() {
    marcar();
    pintarBarra();
}

function alternar(fila, { tramo = false } = {}) {
    const lista = filas();
    const i = lista.indexOf(fila);
    if (i < 0) return;
    if (tramo && estado.ancla != null) {
        // Mayús + clic: del ancla a esta, todas marcadas
        const desde = Math.min(estado.ancla, i), hasta = Math.max(estado.ancla, i);
        for (const f of lista.slice(desde, hasta + 1)) estado.elegidas.add(f.dataset.src);
    } else {
        const src = fila.dataset.src;
        if (estado.elegidas.has(src)) estado.elegidas.delete(src); else estado.elegidas.add(src);
        estado.ancla = i;
    }
    actualizar();
}

/** Las canciones elegidas, en el orden en que se ven. */
async function elegidas() {
    const orden = filas().map((f) => f.dataset.src).filter((src) => estado.elegidas.has(src));
    const todas = estado.contexto === 'biblioteca'
        ? await LibraryModule.getLibrary()
        : (await resolvePlaylistDetails(estado.playlistId))?.songs ?? [];
    const porSrc = new Map(todas.map((s) => [s.src, s]));
    return orden.map((src) => porSrc.get(src)).filter(Boolean);
}

async function hacer(accion) {
    if (accion === 'cerrar') return salirDeSeleccion();
    if (accion === 'todo') {
        const visibles = filas().map((f) => f.dataset.src);
        const todas = visibles.every((src) => estado.elegidas.has(src));
        for (const src of visibles) {
            if (todas) estado.elegidas.delete(src); else estado.elegidas.add(src);
        }
        return actualizar();
    }
    const canciones = await elegidas();
    if (!canciones.length) return;
    const { contexto, playlistId } = estado;
    if (accion === 'lista') {
        await PlaylistModule.showAddToPlaylist(canciones);
        return;   // la selección sigue: se pueden añadir a más de una
    }
    salirDeSeleccion();
    if (accion === 'cola') {
        for (const song of canciones) PlayerModule.addToNextQueue(song);
        avisar(i18n.t('sel_queued', { n: canciones.length }));
    } else if (accion === 'descargar') {
        // El mismo lote que «Descargar las que faltan» (P3): solo las de la nube
        const { descargarCanciones } = await import('../playlists/detalle/descargar.js');
        await descargarCanciones(canciones.filter(esNube));
    } else if (accion === 'quitar' && contexto === 'lista') {
        const { quitarDeListaConDeshacer } = await import('./acciones.js');
        await quitarDeListaConDeshacer(playlistId, canciones.map((s) => s.src));
    } else if (accion === 'borrar' && contexto === 'biblioteca') {
        const { borrarDeBibliotecaConDeshacer } = await import('./acciones.js');
        await borrarDeBibliotecaConDeshacer(canciones.map((s) => s.src));
    }
}

/** Los clics en las filas marcan en vez de reproducir. Va en captura, antes que la lista. */
function alClicar(e) {
    const fila = e.target.closest('.library-item[data-src]');
    if (!fila || !estado.contenedor.contains(fila)) return;
    e.preventDefault();
    e.stopPropagation();
    alternar(fila, { tramo: e.shiftKey });
}

function alTeclear(e) {
    if (e.key !== 'Escape' || document.querySelector('.auth-modal:not(.hidden)')) return;
    e.preventDefault();
    salirDeSeleccion();
}

/**
 * Entra en la selección de la biblioteca o de la lista abierta. Con `fila`,
 * la marca (o, con `tramo`, marca hasta ella).
 */
export async function entrarEnSeleccion({ contexto, playlistId, fila = null, tramo = false } = {}) {
    const contenedor = fila?.closest(LISTAS)
        ?? document.getElementById(contexto === 'biblioteca' ? 'libraryList' : 'playlistDetailList');
    if (!contenedor) return;
    // Con «Reordenar» activo, las filas son de Sortable
    if (contenedor.querySelector('.library-item.edit-mode')) return;
    if (estado && estado.contenedor !== contenedor) salirDeSeleccion();
    if (!estado) {
        const enLista = contenedor.id === 'playlistDetailList';
        const barra = document.createElement('div');
        barra.className = 'sel-barra glass-thick';
        barra.setAttribute('role', 'toolbar');
        barra.addEventListener('click', (e) => {
            const boton = e.target.closest('[data-accion]');
            if (boton && !boton.disabled) hacer(boton.dataset.accion).catch((err) => console.error('[Selección]', err));
        });
        document.body.append(barra);
        estado = {
            contenedor, barra,
            contexto: enLista ? 'lista' : 'biblioteca',
            playlistId: enLista ? (playlistId ?? PlaylistModule.currentPlaylistId) : null,
            elegidas: new Set(), ancla: null,
            observador: new MutationObserver(() => marcar()),
            soltarCapa: NavigationModule.registrarCapa({ abierta: () => Boolean(estado), cerrar: () => salirDeSeleccion() }),
        };
        estado.observador.observe(contenedor, { childList: true, subtree: true });
        contenedor.classList.add('en-seleccion');
        contenedor.setAttribute('aria-multiselectable', 'true');
        document.documentElement.classList.add('seleccionando');
        document.addEventListener('click', alClicar, true);
        document.addEventListener('keydown', alTeclear);
        document.addEventListener('vista-cambiada', salirDeSeleccion, { once: true });
    }
    if (fila) alternar(fila, { tramo });
    else actualizar();
}

export function salirDeSeleccion() {
    if (!estado) return;
    const { contenedor, barra, observador, soltarCapa } = estado;
    estado = null;
    observador.disconnect();
    soltarCapa();
    document.removeEventListener('click', alClicar, true);
    document.removeEventListener('keydown', alTeclear);
    document.removeEventListener('vista-cambiada', salirDeSeleccion);
    contenedor.classList.remove('en-seleccion');
    contenedor.removeAttribute('aria-multiselectable');
    document.documentElement.classList.remove('seleccionando');
    for (const f of contenedor.querySelectorAll('.library-item')) {
        f.classList.remove('seleccionada');
        f.removeAttribute('aria-selected');
        f.querySelector('.sel-marca')?.remove();
    }
    barra.classList.add('saliendo');
    setTimeout(() => barra.remove(), 200);
}

export const enSeleccion = () => estado !== null;
