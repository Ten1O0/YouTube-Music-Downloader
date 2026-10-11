/**
 * Buscar y ordenar dentro de una lista (plan 24, P5), y sus estados vacíos (P12).
 *
 * - «Ordenar por»: personalizado (el de siempre), título, artista, añadida
 *   recientemente o duración. Se recuerda por lista en este dispositivo y no
 *   cambia el orden guardado. En todos, lo descargado va primero y lo de la
 *   nube después, como en la biblioteca (plan 23).
 * - El buscador, tras la lupa, filtra por título y artista mientras se escribe.
 * - Reproducir y aleatorio siguen lo que se ve: con un filtro, solo lo filtrado.
 *
 * Se carga con la cabecera, al abrir la primera lista.
 */

import { segundosDe } from '../../../core/duracion.js';
import { nombreDe } from '../../../core/titles.js';
import { i18n } from '../../../i18n/language-manager.js';
import { rellenarEstadoVacio } from '../../../ui/empty-states.js';
import { NavigationModule } from '../../../ui/navigation.js';
import { springTiming } from '../../../ui/motion/spring.js';
import { moverEnGrupo, ordenDeVista } from '../orden.js';
import { getPlaylists, savePlaylists } from '../store.js';

const $ = (id) => document.getElementById(id);
const CLAVE_ORDEN = 'ytdl_orden_listas';

export const CRITERIOS = ['personalizado', 'titulo', 'artista', 'recientes', 'duracion'];

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const comparador = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * Las canciones en el orden de ese criterio, con lo descargado primero. Pura.
 * «Añadida recientemente» es el orden guardado al revés: lo último que se
 * añade a una lista va al final.
 */
export function ordenarPor(canciones, criterio) {
    const lista = [...(canciones ?? [])];
    const titulo = (s) => nombreDe(s).titulo;
    const artista = (s) => nombreDe(s).artista;
    if (criterio === 'recientes') lista.reverse();
    else if (criterio === 'titulo') lista.sort((a, b) => comparador.compare(titulo(a), titulo(b)));
    else if (criterio === 'artista') lista.sort((a, b) => comparador.compare(artista(a), artista(b)) || comparador.compare(titulo(a), titulo(b)));
    // De la más corta a la más larga; las que no se sabe cuánto duran, al final
    else if (criterio === 'duracion') lista.sort((a, b) => (segundosDe(a) || Infinity) - (segundosDe(b) || Infinity));
    return ordenDeVista(lista);
}

/** Las canciones cuyo título o artista contienen todas las palabras buscadas, sin tildes ni mayúsculas. Pura. */
export function filtrarCanciones(canciones, consulta) {
    const palabras = sinTildes(consulta).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return canciones;
    return canciones.filter((s) => {
        const { titulo, artista } = nombreDe(s);
        const texto = sinTildes(`${titulo} ${artista}`);
        return palabras.every((p) => texto.includes(p));
    });
}

// ── El criterio de cada lista, en este dispositivo ──

function criterios() {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_ORDEN)) || {};
    } catch {
        return {};
    }
}

export function criterioDe(id) {
    const c = criterios()[id];
    return CRITERIOS.includes(c) ? c : 'personalizado';
}

function guardarCriterio(id, criterio) {
    try {
        const todos = criterios();
        if (criterio === 'personalizado') delete todos[id]; else todos[id] = criterio;
        localStorage.setItem(CLAVE_ORDEN, JSON.stringify(todos));
    } catch { /* sin almacenamiento: dura lo que la sesión en la vista */ }
}

// ── Lo que se ve ──

let busqueda = { id: null, texto: '' };

/** La búsqueda de esa lista ('' si se buscaba en otra). */
export const consultaDe = (id) => (busqueda.id === id ? busqueda.texto : '');

/**
 * Las canciones de la lista en el orden y con el filtro que se ven. Mientras
 * se ordena a mano, el orden de siempre y sin filtro: es el que se guarda.
 */
export function vistaDeLista(pl, { aMano = false } = {}) {
    if (aMano) return ordenDeVista(pl.songs);
    return filtrarCanciones(ordenarPor(pl.songs, criterioDe(pl.id)), consultaDe(pl.id));
}

// ── La interfaz: la lupa, «Ordenar por» y los estados vacíos ──

let actual = null;   // { pl, alCambiar, anadir } de la lista abierta
let lista = null;    // la lista abierta, para «Ordenar por»
let preparada = false;

function mostrarBuscador(si) {
    const fila = $('plBuscarFila');
    const entrada = $('plBuscarInput');
    if (!fila || !entrada) return;
    fila.hidden = !si;
    $('plBuscarBtn')?.setAttribute('aria-expanded', String(si));
    if (si) entrada.focus();
}

/** Borra la búsqueda y repinta. */
function borrarBusqueda({ cerrar = false } = {}) {
    const entrada = $('plBuscarInput');
    if (entrada) entrada.value = '';
    busqueda = { id: actual?.pl.id ?? null, texto: '' };
    if (cerrar) mostrarBuscador(false);
    actual?.alCambiar();
}

/** Cierra «Ordenar por» y espera a que el historial lo haya asentado. */
function cerrarOrden() {
    return new Promise((ok) => {
        const listo = () => { clearTimeout(espera); ok(); };
        const espera = setTimeout(() => { globalThis.removeEventListener('popstate', listo); ok(); }, 400);
        globalThis.addEventListener('popstate', listo, { once: true });
        NavigationModule.closeOverlay();
    });
}

function preparar() {
    if (preparada) return;
    preparada = true;
    // La lista vacía (plan 10; plan 24, P12): qué le pasa y qué se puede hacer
    rellenarEstadoVacio($('playlistDetailEmpty'), {
        ilustracion: 'lista', titulo: 'empty_pl_t', texto: 'empty_pl_d',
        acciones: [
            { clave: 'act_add_songs', id: 'plVaciaAnadir', alPulsar: () => actual?.anadir?.() },
            { clave: 'pl_see_recommended', id: 'plVaciaRecomendadas', secundaria: true },
        ],
    });
    const entrada = $('plBuscarInput');
    $('plBuscarBtn')?.addEventListener('click', () => {
        const abierto = !$('plBuscarFila')?.hidden;
        if (abierto) borrarBusqueda({ cerrar: true }); else mostrarBuscador(true);
    });
    entrada?.addEventListener('input', () => {
        busqueda = { id: actual?.pl.id ?? null, texto: entrada.value };
        actual?.alCambiar();
    });
    entrada?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); borrarBusqueda({ cerrar: true }); }
    });
    $('plSinResultadosBorrar')?.addEventListener('click', () => borrarBusqueda());

    const hoja = $('plOrdenSheet');
    $('plOrdenClose')?.addEventListener('click', () => NavigationModule.closeOverlay());
    hoja?.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());
    hoja?.querySelector('.opciones-lista')?.addEventListener('click', async (e) => {
        const boton = e.target.closest('[data-criterio]');
        if (!boton || !lista) return;
        const { pl, alCambiar, aMano } = lista;
        await cerrarOrden();
        if (boton.dataset.criterio === 'a-mano') {
            // A mano se ordena el orden guardado: se vuelve a él y sin buscar
            guardarCriterio(pl.id, 'personalizado');
            if (consultaDe(pl.id)) borrarBusqueda({ cerrar: true });
            aMano?.();
            return;
        }
        guardarCriterio(pl.id, boton.dataset.criterio);
        alCambiar();
    });

}

/**
 * Al abrir una lista (o al repintarla): se recuerdan cómo repintarla y qué se
 * le puede hacer. La búsqueda se olvida al entrar en ella (`entrando`) o si
 * era de otra; al repintarla por un cambio (editar, sincronizar), se queda.
 * @param {{ alCambiar: () => void, anadir?: (() => void) | null, entrando?: boolean }} o
 */
export function alAbrir(pl, { alCambiar, anadir = null, entrando = false }) {
    preparar();
    actual = { pl, alCambiar, anadir };
    if (entrando || busqueda.id !== pl.id) {
        busqueda = { id: pl.id, texto: '' };
        const entrada = $('plBuscarInput');
        if (entrada) entrada.value = '';
        mostrarBuscador(false);
    }
    const anadirVacia = $('plVaciaAnadir');
    if (anadirVacia) anadirVacia.hidden = !anadir;
}

/** «Ordenar por», con el criterio de la lista marcado. «A mano» solo si se puede. */
export function abrirOrden(pl, { alCambiar, aMano = null }) {
    const hoja = $('plOrdenSheet');
    if (!hoja) return;
    preparar();
    lista = { pl, alCambiar, aMano };
    const criterio = criterioDe(pl.id);
    for (const b of hoja.querySelectorAll('[data-criterio]')) {
        if (b.dataset.criterio === 'a-mano') b.hidden = !aMano;
        else b.setAttribute('aria-checked', String(b.dataset.criterio === criterio));
    }
    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('plOrdenSheet');
}

/**
 * Lo que se enseña cuando no hay filas: la lista vacía (P12) o «nada con
 * "xyz" en esta lista», con un botón para borrar la búsqueda.
 */
export function pintarSinFilas(pl, filas) {
    const sinResultados = $('plSinResultados');
    const consulta = consultaDe(pl.id).trim();
    const nada = pl.songs.length > 0 && filas === 0;
    if (sinResultados) sinResultados.hidden = !nada;
    if (nada) $('plSinResultadosTexto').textContent = i18n.t('pl_search_none', { q: consulta });
}

// ── Mover a mano (Sortable) ──

/**
 * Prepara la lista para moverla a mano. Sortable viene en su propio script
 * (index.html). Cada canción se mueve dentro de su grupo: lo descargado no
 * pasa a la nube ni al revés (plan 23), y se guarda con `moverEnGrupo`.
 */
export function ordenarAMano(lista, pl) {
    if (window.playlistSortable) window.playlistSortable.destroy();
    if (typeof Sortable === 'undefined') return;
    // Las filas se apartan con el muelle ágil (plan 09, T16)
    const muelle = springTiming('snappy');
    window.playlistSortable = new Sortable(lista, {
        handle: '.pl-drag-handle',
        animation: muelle.durationMs,
        easing: muelle.easing,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        forceFallback: true,
        fallbackClass: 'sortable-fallback',
        fallbackOnBody: true,
        fallbackTolerance: 3,
        swapThreshold: 0.55,
        onMove: (evt) => evt.related?.dataset.grupo === evt.dragged?.dataset.grupo,
        onEnd: async (evt) => {
            if (evt.oldIndex === evt.newIndex) return;
            // Solo se guarda: Sortable ya ha movido la fila
            try {
                const listas = await getPlaylists();
                const guardada = listas.find((p) => p.id === pl.id);
                if (!guardada) return;
                // Los índices son los de la vista: se mueve dentro de su grupo
                guardada.songs = moverEnGrupo(guardada.songs, evt.oldIndex, evt.newIndex);
                await savePlaylists(listas);
                // La lista pintada sigue al día para el siguiente arrastre
                pl.songs = guardada.songs;
            } catch (e) {
                console.error('[Listas] No se pudo guardar el nuevo orden:', e);
            }
        },
    });
}

// ── Las recomendadas (P7): se cargan cuando el final de la lista se acerca ──

let cargaRecomendadas = null;
const recomendadas = () => (cargaRecomendadas ??= import('./recomendadas.js').catch((e) => {
    cargaRecomendadas = null;
    throw e;
}));

let pendiente = null;      // la lista cuyas recomendadas se pedirán al verse el final
let recomendadaId = null;  // la lista cuyas recomendadas ya se han pedido
let vigia = null;

function esconderRecomendadas() {
    const seccion = $('plRecomendadas');
    if (seccion) seccion.hidden = true;
    cargaRecomendadas?.then((m) => m.olvidar()).catch(() => {});
}

function vigilarFinal() {
    const centinela = $('plRecomendadasCentinela');
    if (!centinela || typeof IntersectionObserver === 'undefined') return;
    vigia ??= new IntersectionObserver(([e]) => {
        if (!e.isIntersecting || !pendiente) return;
        const pl = pendiente;
        pendiente = null;
        recomendadaId = pl.id;
        recomendadas().then((m) => m.recomendar(pl, { nueva: true })).catch(() => {});
    }, { root: centinela.closest('.main-content'), rootMargin: '0px 0px 300px 0px' });
    // Se vuelve a observar para que avise aunque ya esté a la vista (una lista corta)
    vigia.unobserve(centinela);
    vigia.observe(centinela);
}

/** «Ver recomendadas» de la lista vacía: a partir de lo que suena o de lo más escuchado. */
async function verRecomendadasSinLista() {
    const pl = actual?.pl;
    if (!pl) return;
    pendiente = null;
    recomendadaId = pl.id;
    try {
        const m = await recomendadas();
        await m.recomendar(pl, { semillas: await m.semillasSinLista() });
        $('plRecomendadas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch { /* sin red: la sección no sale */ }
}

/**
 * Decide qué hacer con las recomendadas al abrir o repintar la lista. Solo en
 * las listas propias (en las calculadas no se añade nada). Una lista vacía no
 * las pide sola: las ofrece su estado vacío.
 */
export function vigilarRecomendadas(pl, { propia, entrando }) {
    preparar();
    const vacia = $('plVaciaRecomendadas');
    if (vacia) {
        vacia.hidden = !propia;
        vacia.onclick = verRecomendadasSinLista;
    }
    if (!propia) {
        pendiente = null;
        recomendadaId = null;
        esconderRecomendadas();
        return;
    }
    if (!entrando && recomendadaId === pl.id) {
        // Un repintado (se añadió o quitó algo): las mismas, al día con la lista
        cargaRecomendadas?.then((m) => m.recomendar(pl)).catch(() => {});
        return;
    }
    if (entrando || recomendadaId !== pl.id) {
        recomendadaId = null;
        esconderRecomendadas();
    }
    pendiente = pl.songs.length ? pl : null;
    if (pendiente) vigilarFinal();
}
