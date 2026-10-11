/**
 * Filas que entran, salen y se recolocan (plan 09, T14).
 *
 * Las listas de la app se repintan enteras con innerHTML. En vez de cambiar
 * eso, se mide antes y se anima después:
 *
 *     const antes = measure(lista, '.library-item', el => el.dataset.src);
 *     lista.innerHTML = …;
 *     animateListChange(lista, '.library-item', el => el.dataset.src, antes);
 *
 * Las filas con clave nueva abren hueco; las que ya estaban y cambiaron de
 * sitio se deslizan desde donde estaban (FLIP). Solo si la lista está a la
 * vista y cambian pocas: con muchas, se pinta sin animar.
 */

import { Spring, prefersReducedMotion, animarConMuelle } from './spring.js';

/** Hasta dónde se anima: la pantalla y otra más por arriba y por abajo. */
function banda() {
    const alto = globalThis.innerHeight || 800;
    return { desde: -alto, hasta: alto * 2 };
}

/**
 * Rectángulos de las filas por clave. Las que están lejos de la pantalla
 * quedan con `null` (plan 19, T7): se sabe que estaban, pero no se animan;
 * llegan a su sitio sin coste, porque nadie las ve moverse.
 */
export function measure(container, selector, keyOf) {
    const mapa = new Map();
    if (!container) return mapa;
    const { desde, hasta } = banda();
    container.querySelectorAll(selector).forEach(el => {
        const clave = keyOf(el);
        if (!clave) return;
        const r = el.getBoundingClientRect();
        mapa.set(clave, r.bottom < desde || r.top > hasta ? null : r);
    });
    return mapa;
}

/**
 * Qué hacer con cada fila tras repintar: 'enter' (nueva), 'move' (con su
 * desplazamiento) o nada. Pura, para poder probarla.
 */
export function planListChange(antes, despues, { maxChanges = 20 } = {}) {
    const plan = [];
    for (const [clave, rect] of despues) {
        // Lejos de la pantalla, antes o después: ni entra ni se mueve a la vista
        if (!rect) continue;
        if (!antes.has(clave)) plan.push({ clave, tipo: 'enter' });
        else if (antes.get(clave)) {
            const dy = antes.get(clave).top - rect.top;
            if (Math.abs(dy) > 0.5) plan.push({ clave, tipo: 'move', dy });
        }
    }
    return plan.length > maxChanges ? [] : plan;
}

function aLaVista(container) {
    if (!container || !container.isConnected) return false;
    const r = container.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

/** Anima la entrada de una fila: abre hueco (altura y margen) y aparece. */
export function enterRow(el) {
    const estilo = getComputedStyle(el);
    const alto = el.offsetHeight;
    const margen = Number.parseFloat(estilo.marginBottom) || 0;
    el.style.overflow = 'hidden';
    const pintar = (p) => {
        el.style.height = `${alto * p}px`;
        el.style.marginBottom = `${margen * p}px`;
        el.style.opacity = String(Math.min(1, p * 1.4));
        el.style.transform = `translateY(${(1 - p) * -8}px)`;
    };
    pintar(0);
    const muelle = new Spring({ value: 0, preset: 'smooth', precision: 0.002, onUpdate: pintar });
    return muelle.to(1).then(() => {
        el.style.height = el.style.marginBottom = el.style.opacity = el.style.transform = el.style.overflow = '';
    });
}

/**
 * Desliza una fila desde donde estaba (FLIP), en el compositor (plan 19, T9).
 */
function moveRow(el, dy) {
    const anim = animarConMuelle(el, [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }], 'smooth');
    if (anim) return anim.finished.catch(() => {});
    const muelle = new Spring({ value: dy, preset: 'smooth', precision: 0.3, onUpdate: v => { el.style.transform = `translateY(${v}px)`; } });
    return muelle.to(0).then(() => { el.style.transform = ''; });
}

/**
 * La fila que se estaba viendo, para dejarla en el mismo sitio tras repintar la
 * lista entera. Con innerHTML el navegador pierde su ancla de scroll y, si
 * cambia algo por encima (una fila que se va), todo lo de debajo salta.
 * Devuelve la función que la recoloca; sin scroll, no hace nada.
 */
export function anclarScroll(container, selector, keyOf) {
    const scroller = container?.closest('.main-content');
    if (!scroller || scroller.scrollTop === 0) return () => {};
    const tope = scroller.getBoundingClientRect().top;
    const filas = [...container.querySelectorAll(selector)];
    const primera = filas.findIndex((el) => el.getBoundingClientRect().bottom > tope);
    if (primera < 0) return () => {};
    // Unas cuantas, por si la primera es justo la que desaparece
    const anclas = filas.slice(primera, primera + 5).map((el) => [keyOf(el), el.getBoundingClientRect().top]);
    return () => {
        const porClave = new Map([...container.querySelectorAll(selector)].map((el) => [keyOf(el), el]));
        const ancla = anclas.find(([clave]) => porClave.has(clave));
        if (!ancla) return;
        const dy = porClave.get(ancla[0]).getBoundingClientRect().top - ancla[1];
        if (Math.abs(dy) > 0.5) scroller.scrollTop += dy;
    };
}

export function animateListChange(container, selector, keyOf, antes, opciones = {}) {
    if (!antes || !aLaVista(container) || prefersReducedMotion()) return;
    const filas = new Map();
    container.querySelectorAll(selector).forEach(el => { const c = keyOf(el); if (c) filas.set(c, el); });
    const despues = measure(container, selector, keyOf);
    // Si antes no había nada, es el primer pintado: de eso se ocupa staggerIn
    if (antes.size === 0) return;
    for (const paso of planListChange(antes, despues, opciones)) {
        const el = filas.get(paso.clave);
        if (paso.tipo === 'enter') enterRow(el);
        else moveRow(el, paso.dy);
    }
}

/** Pliega una fila y la quita del DOM al asentarse. */
export async function collapseAndRemove(el) {
    if (!el) return;
    if (prefersReducedMotion() || !el.isConnected) {
        el.style.transition = 'opacity 150ms linear';
        el.style.opacity = '0';
        await new Promise(r => setTimeout(r, 160));
        el.remove();
        return;
    }
    const alto = el.offsetHeight;
    const margen = Number.parseFloat(getComputedStyle(el).marginBottom) || 0;
    el.style.overflow = 'hidden';
    el.style.pointerEvents = 'none';
    const pintar = (p) => {
        el.style.height = `${alto * p}px`;
        el.style.marginBottom = `${margen * p}px`;
        el.style.opacity = String(Math.max(0, p * 1.5 - 0.5));
        el.style.transform = `translateX(${(1 - p) * -24}px)`;
    };
    const muelle = new Spring({ value: 1, preset: 'smooth', precision: 0.002, onUpdate: pintar });
    await muelle.to(0);
    el.remove();
}

/**
 * Aparición escalonada la primera vez que se ve una lista: muy corta
 * (25 ms entre filas, como mucho 8 filas) para que se note sin hacer esperar.
 */
export function staggerIn(container, selector, { step = 25, max = 8 } = {}) {
    if (!aLaVista(container) || prefersReducedMotion()) return false;
    [...container.querySelectorAll(selector)].slice(0, max).forEach((el, i) => {
        el.style.animationDelay = `${i * step}ms`;
        el.classList.add('entrada-escalonada');
        el.addEventListener('animationend', () => {
            el.classList.remove('entrada-escalonada');
            el.style.animationDelay = '';
        }, { once: true });
    });
    return true;
}
