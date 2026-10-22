/**
 * La cabecera de una lista (plan 24, T2: P1, P2, P4 y P11).
 *
 * - La portada en grande (la elegida en «Editar» o el mosaico) y, detrás, un
 *   degradado con sus colores, como el del reproductor.
 * - «12 canciones · 47 min · 3 en la nube · actualizada hace 2 días».
 * - Al bajar más allá de la portada, una barra fina con el nombre y Reproducir.
 * - El menú ⋮, con el aspecto de «Opciones de la canción»: añadir canciones,
 *   editar, ordenar, compartir y eliminar.
 *
 * Se carga al abrir la primera lista (presupuesto de arranque del plan 19).
 */

import './cabecera.css';
import { html } from '../../../core/html.js';
import { nombreDe } from '../../../core/titles.js';
import { i18n } from '../../../i18n/language-manager.js';
import { NavigationModule } from '../../../ui/navigation.js';
import { paletteFromImage } from '../../../ui/palette.js';
import { avisar } from '../../../ui/toast.js';
import { portadaDeLista } from '../crear.js';
import { caratulaElegida } from '../portada.js';
import { cargarPortadas, portadaDeListaGenerada, varianteDe } from '../../../core/portada-generada.js';
import { descargarCanciones, quePuedenBajarse } from './descargar.js';
import * as vista from './vista.js';

/** Las portadas generadas que se pueden elegir (plan 27): gen:0 … gen:7. */
const VARIANTES_GENERADAS = 8;

/** Buscar, ordenar y los estados vacíos (vista.js), en el mismo trozo que la cabecera. */
export { vista };

const $ = (id) => document.getElementById(id);

const UNIDADES = [['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60]];

/** «hace 2 días», «ayer», «hace un momento». Pura, salvo el idioma que se le pasa. */
export function haceCuanto(fecha, ahora = Date.now(), idioma = 'es') {
    const t = new Date(fecha).getTime();
    if (!Number.isFinite(t)) return '';
    const segundos = Math.max(0, (ahora - t) / 1000);
    const formato = new Intl.RelativeTimeFormat(idioma, { numeric: 'auto' });
    for (const [unidad, s] of UNIDADES) {
        if (segundos >= s) return formato.format(-Math.floor(segundos / s), unidad);
    }
    return formato.format(0, 'minute');
}

/**
 * La lista como texto para compartir: «Artista – Canción», una por línea, que
 * es lo que lee «Importar lista» (plan 15). Sin artista, solo el título. Pura.
 */
export function textoParaCompartir(canciones) {
    return (canciones ?? []).map((s) => {
        const { titulo, artista } = nombreDe(s);
        return artista ? `${artista} – ${titulo}` : titulo;
    }).filter(Boolean).join('\n');
}

let pintada = 0;   // para no pintar los colores de una lista en la siguiente

// ── P3 · «Descargar las que faltan» ──

let bajando = null;   // { id, texto } de la lista que está bajando las suyas

function pintarFaltan(pl, refrescar) {
    const boton = $('plDescargarFaltan');
    const texto = $('plDescargarFaltanTexto');
    if (!boton || !texto) return;
    const n = quePuedenBajarse(pl.songs).length;
    boton.hidden = n === 0;
    boton.disabled = bajando?.id === pl.id;
    texto.textContent = bajando?.id === pl.id ? bajando.texto
        : n === 1 ? i18n.t('pl_download_missing_one') : i18n.t('pl_download_missing', { n });
    boton.onclick = async () => {
        if (bajando) return;
        bajando = { id: pl.id, texto: i18n.t('pl_downloading', { i: 0, n }) };
        pintarFaltan(pl, refrescar);
        try {
            await descargarCanciones(pl.songs, {
                alProgreso: (e) => {
                    bajando.texto = i18n.t('pl_downloading', { i: e.hechas, n: e.total });
                    if (bajando.id === pl.id && !boton.hidden) texto.textContent = bajando.texto;
                },
            });
        } finally {
            bajando = null;
            await refrescar?.();
        }
    };
}

/**
 * Pinta la cabecera de la lista. `virtual`: Favoritos o una automática (sin
 * fecha de cambio). `refrescar`: vuelve a pintar la lista si sigue abierta.
 */
export function pintarCabecera(pl, { virtual = false, refrescar = null } = {}) {
    const turno = ++pintada;
    pintarFaltan(pl, refrescar);
    const elegida = caratulaElegida(pl);
    const portada = $('plPortada');
    if (portada) {
        portada.innerHTML = elegida
            ? html`<img src="${elegida}" alt="" decoding="async" onerror="this.src='favicon.png'">`
            : portadaDeLista(pl.songs ?? [], pl.id);
    }
    const nombreFijo = $('plBarraFijaNombre');
    if (nombreFijo) nombreFijo.textContent = pl.name;

    const actualizada = $('plActualizada');
    const fecha = virtual ? null : (pl.updatedAt ?? pl.createdAt);
    if (actualizada) {
        actualizada.hidden = !fecha;
        actualizada.textContent = fecha ? i18n.t('pl_updated', { cuando: haceCuanto(fecha, Date.now(), i18n.currentLang) }) : '';
    }

    // Los colores de la portada: los de su primera carátula, como en el reproductor
    const cabecera = $('plCabecera');
    cabecera?.style.removeProperty('--lista-color-1');
    if (!cabecera) return;
    // Con una portada generada (elegida, o la automática de una lista sin carátulas),
    // sus colores tal cual, sin analizar la imagen (plan 27)
    const variante = varianteDe(pl.portada);
    const conCaratula = (pl.songs ?? []).some((s) => s?.thumbnail);
    if (variante !== null || (!elegida && !conCaratula)) {
        cargarPortadas().then((m) => {
            if (turno === pintada) cabecera.style.setProperty('--lista-color-1', m.portadaGenerada(pl.id, variante).colores[0]);
        }).catch(() => {});
        return;
    }
    const caratula = elegida ?? (pl.songs ?? []).find((s) => s?.thumbnail)?.thumbnail;
    if (!caratula) return;
    paletteFromImage(caratula).then((paleta) => {
        if (!paleta || turno !== pintada) return;
        cabecera.style.setProperty('--lista-color-1', paleta[0]);
    });
}

// ── La barra fija (P4) ──

let observador = null;

/**
 * La barra va fija sobre todo el área de contenido: se coloca con la caja de
 * .main-content (sin su barra de scroll), que cambia con la ventana y con la
 * barra lateral.
 */
function colocarBarra(barra, contenido) {
    const caja = contenido.getBoundingClientRect();
    barra.style.setProperty('--fija-arriba', `${caja.top}px`);
    barra.style.setProperty('--fija-izq', `${caja.left}px`);
    barra.style.setProperty('--fija-ancho', `${contenido.clientWidth}px`);
}

/** Enseña la barra fija cuando la portada sale por arriba. Una vez. */
export function vigilarBarraFija() {
    const portada = $('plPortada');
    const barra = $('plBarraFija');
    const contenido = portada?.closest('.main-content');
    if (observador || !portada || !barra || !contenido || typeof IntersectionObserver === 'undefined') return;
    const colocar = () => colocarBarra(barra, contenido);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(colocar).observe(contenido);
    else globalThis.addEventListener('resize', colocar);
    // Respecto al contenedor que hace scroll: «fuera» es por encima de su borde de arriba
    observador = new IntersectionObserver(([e]) => {
        const fuera = !e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0) + 1;
        if (fuera) colocar();
        barra.classList.toggle('lista-fija--visible', fuera);
        barra.setAttribute('aria-hidden', String(!fuera));
        $('plBarraFijaPlay')?.setAttribute('tabindex', fuera ? '0' : '-1');
    }, { root: contenido });
    observador.observe(portada);
    $('plBarraFijaPlay')?.addEventListener('click', () => $('plPlayBtn')?.click());
}

// ── El menú ⋮ (P2) ──

let acciones = {};
let menuListo = false;

/** Cierra el menú y espera a que el historial lo haya asentado: así la ventana siguiente se apila bien. */
function cerrarMenu() {
    return new Promise((ok) => {
        const listo = () => { clearTimeout(espera); ok(); };
        const espera = setTimeout(() => { globalThis.removeEventListener('popstate', listo); ok(); }, 400);
        globalThis.addEventListener('popstate', listo, { once: true });
        NavigationModule.closeOverlay();
    });
}

/** Compartir con la hoja del sistema; si no la hay, al portapapeles. */
async function compartir(pl) {
    const texto = textoParaCompartir(pl.songs);
    if (navigator.share) {
        try {
            await navigator.share({ title: pl.name, text: texto });
        } catch { /* cancelado por el usuario */ }
        return;
    }
    try {
        await navigator.clipboard.writeText(texto);
        avisar(i18n.t('pl_share_copied'));
    } catch {
        avisar(i18n.t('link_copy_failed'));
    }
}

const ENTRADAS = { plActionAdd: 'anadir', plActionEdit: 'editar', plActionReorder: 'ordenar', plActionSelect: 'seleccionar', plActionDelete: 'eliminar' };

function prepararMenu() {
    if (menuListo) return;
    menuListo = true;
    const hoja = $('playlistMenuSheet');
    $('playlistMenuClose')?.addEventListener('click', () => NavigationModule.closeOverlay());
    hoja?.querySelector('.auth-modal-backdrop')?.addEventListener('click', () => NavigationModule.closeOverlay());
    for (const [id, accion] of Object.entries(ENTRADAS)) {
        $(id)?.addEventListener('click', async () => {
            const hacer = acciones[accion];
            await cerrarMenu();
            hacer?.();
        });
    }
    // Compartir necesita el toque del usuario: primero se comparte y luego se cierra
    $('plActionShare')?.addEventListener('click', async () => {
        await compartir(acciones.lista);
        if (!hoja?.classList.contains('hidden')) await cerrarMenu();
    });
}

/**
 * Abre el menú ⋮ de la lista. `opciones`: { anadir, editar, ordenar, seleccionar, eliminar },
 * cada una una función o null (y entonces no sale). Compartir sale siempre.
 */
export function abrirMenu(pl, opciones) {
    const hoja = $('playlistMenuSheet');
    if (!hoja) return;
    prepararMenu();
    acciones = { ...opciones, lista: pl };
    $('playlistMenuTitulo').textContent = pl.name;
    for (const [id, accion] of Object.entries(ENTRADAS)) {
        const boton = $(id);
        if (boton) boton.hidden = !opciones[accion];
    }
    hoja.classList.remove('hidden');
    NavigationModule.pushOverlayState('playlistMenuSheet');
}

// ── P11 · Elegir la portada en «Editar» ──

/** Las carátulas que se pueden elegir: una por canción de YouTube con carátula, sin repetir. Pura. */
export function caratulasDeLista(canciones) {
    const vistas = new Map();
    for (const s of canciones ?? []) {
        if (s?.videoId && s.thumbnail && !vistas.has(s.videoId)) vistas.set(s.videoId, s.thumbnail);
    }
    return [...vistas].map(([videoId, thumbnail]) => ({ videoId, thumbnail }));
}

/**
 * Las portadas que se pueden elegir (plan 24, P11): «Automática», cada
 * carátula de la lista y las generadas (plan 27), en todas las listas. Se
 * marca la elegida, como un grupo de opciones.
 */
export function pintarEleccionDePortada(pl, actual, elegir) {
    const seccion = document.getElementById('editPlaylistCoverSection');
    const rejilla = document.getElementById('editPlaylistCovers');
    if (!seccion || !rejilla) return;
    const caratulas = caratulasDeLista(pl.songs);
    seccion.hidden = false;
    const opcion = (valor, contenido, nombre) => html`<button type="button" class="portadas-opcion" role="radio"
        aria-checked="${actual() === valor}" aria-label="${nombre}" data-portada="${valor}">${contenido}</button>`;
    const imagen = (src) => html`<img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.src='favicon.png'">`;
    rejilla.innerHTML = html`${opcion('', portadaDeLista(pl.songs ?? [], pl.id), i18n.t('pl_cover_auto'))}${caratulas.map((c, i) =>
        opcion(c.videoId, imagen(c.thumbnail), i18n.t('pl_cover_n', { n: i + 1 })))}${Array.from({ length: VARIANTES_GENERADAS }, (_, i) =>
        opcion(`gen:${i}`, imagen(portadaDeListaGenerada(pl.id, i)), i18n.t('pl_cover_generated', { n: i + 1 })))}`;
    rejilla.onclick = (e) => {
        const boton = e.target.closest('.portadas-opcion');
        if (!boton) return;
        elegir(boton.dataset.portada);
        for (const b of rejilla.querySelectorAll('.portadas-opcion')) b.setAttribute('aria-checked', String(b === boton));
    };
}
