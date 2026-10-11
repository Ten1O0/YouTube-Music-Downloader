/**
 * Deshacer lo que se borra (plan 24, P9).
 *
 * Tras borrar algo sale un aviso con «Deshacer» durante unos segundos: 5 para
 * una lista entera y 3 para una canción, como pidió el usuario. Lo que se ve
 * cambia al momento (quien llama ya lo ha hecho); lo que no tiene vuelta atrás
 * (borrar el audio del dispositivo) espera en `confirmar` a que el aviso acabe.
 *
 *     conDeshacer({
 *         titulo: 'Verano', texto: 'Playlist eliminada', miniatura,
 *         duracionMs: 5000,
 *         deshacer: () => …,   // vuelve a ponerlo como estaba
 *         confirmar: () => …,  // lo irreversible, si lo hay
 *     });
 *
 * Un solo aviso a la vez: si llega otro borrado, el anterior se da por hecho.
 * También al cerrarlo con su X o deslizándolo, y al cerrar la app o pasarla a
 * segundo plano (en la APK, Android puede matarla sin más aviso). Mientras
 * hay uno pendiente, la sincronización espera ('deshacer-pendiente'): así a la
 * cuenta no llega un borrado que luego se deshace.
 */

import { i18n } from '../i18n/language-manager.js';
import { html, seguro } from '../core/html.js';
import './deshacer.css';

export const DURACION_LISTA = 5_000;
export const DURACION_CANCION = 3_000;
/** Lo que hay que arrastrar el aviso de lado para quitarlo. */
const UMBRAL_DESLIZAR = 80;

const ICONO_CERRAR = seguro('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');

let actual = null;
let aviso = null;

function crear() {
    const el = document.createElement('div');
    el.className = 'deshacer glass-regular';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.body.append(el);

    el.addEventListener('click', (e) => {
        if (e.target.closest('.deshacer-boton')) terminar(false);
        else if (e.target.closest('.deshacer-cerrar')) terminar(true);
    });
    deslizarParaCerrar(el);
    return el;
}

/** Arrastrarlo de lado lo quita, y el borrado queda hecho. */
function deslizarParaCerrar(el) {
    let inicio = null;
    el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        inicio = { x: e.clientX, id: e.pointerId };
        el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
        if (!inicio || e.pointerId !== inicio.id) return;
        const dx = e.clientX - inicio.x;
        el.style.translate = `${dx}px 0`;
        el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 240));
    });
    const soltar = (e) => {
        if (!inicio || e.pointerId !== inicio.id) return;
        const dx = e.clientX - inicio.x;
        inicio = null;
        el.style.translate = '';
        el.style.opacity = '';
        if (Math.abs(dx) > UMBRAL_DESLIZAR) terminar(true);
    };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
}

function avisarPendiente(activo) {
    document.dispatchEvent(new CustomEvent('deshacer-pendiente', { detail: activo }));
}

/**
 * Cierra el aviso en curso. Con `aplicar`, el borrado queda hecho y se llama a
 * `confirmar`; sin él, se deshace.
 */
function terminar(aplicar) {
    const p = actual;
    if (!p) return;
    actual = null;
    clearTimeout(p.reloj);
    if (aviso) {
        aviso.classList.add('saliendo');
        const el = aviso;
        setTimeout(() => { if (!actual) el.hidden = true; }, 220);
    }
    // El foco vuelve a donde estaba, si sigue ahí
    if (aviso?.contains(document.activeElement) && p.foco?.isConnected) p.foco.focus({ preventScroll: true });
    try {
        const r = aplicar ? p.confirmar?.() : p.deshacer?.();
        Promise.resolve(r).catch((e) => console.error('[Deshacer]', e));
    } finally {
        avisarPendiente(false);
    }
}

export function conDeshacer({ titulo = '', texto, miniatura = '', duracionMs = DURACION_CANCION, deshacer, confirmar }) {
    if (!globalThis.document?.body) { confirmar?.(); return; }
    terminar(true);
    aviso ??= crear();

    const foco = document.activeElement;
    aviso.innerHTML = html`
        ${miniatura ? html`<img class="deshacer-arte" src="${miniatura}" alt="" onerror="this.remove()">` : ''}
        <span class="deshacer-texto">
            ${titulo ? html`<span class="deshacer-titulo">${titulo}</span>` : ''}
            <span class="deshacer-estado">${texto}</span>
        </span>
        <button type="button" class="deshacer-boton">${i18n.t('undo')}</button>
        <button type="button" class="deshacer-cerrar" aria-label="${i18n.t('undo_close')}">${ICONO_CERRAR}</button>
        <span class="deshacer-tiempo" aria-hidden="true"><i></i></span>`;
    aviso.style.setProperty('--deshacer-ms', `${duracionMs}ms`);
    aviso.classList.remove('saliendo');
    aviso.hidden = false;
    // Reinicia la barra del tiempo aunque el aviso ya estuviera a la vista
    aviso.classList.remove('contando');
    void aviso.offsetWidth;
    aviso.classList.add('contando');

    actual = { deshacer, confirmar, foco, reloj: setTimeout(() => terminar(true), duracionMs) };
    avisarPendiente(true);
    // Con teclado o lector de pantalla, «Deshacer» está a mano
    aviso.querySelector('.deshacer-boton')?.focus({ preventScroll: true });
}

/** ¿Hay un borrado esperando? */
export const hayPendiente = () => actual !== null;

/** Lo pendiente queda hecho ya (al cerrar la app, o para las pruebas). */
export const aplicarPendiente = () => terminar(true);

if (globalThis.addEventListener) {
    globalThis.addEventListener('pagehide', aplicarPendiente);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') aplicarPendiente();
    });
}
