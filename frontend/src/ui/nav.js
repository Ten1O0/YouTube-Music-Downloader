/**
 * Navegación (plan 09, T18).
 *
 * - Pestañas: el contenido cambia al instante, como en iOS; lo que se mueve es
 *   una píldora detrás de la pestaña activa, con el muelle ágil, y el icono
 *   pulsado rebota con el muelle vivo.
 * - Entrar en un detalle es un «push»: la vista nueva entra desde la derecha
 *   y la de detrás se aparta a −25 % y se oscurece. Volver lo invierte. Se hace
 *   con View Transitions: las dos vistas son fotografías, así que no hace
 *   falta mantener ambas en el DOM ni tocar cómo se muestran.
 * - La cabecera móvil gana su fondo cuando hay contenido desplazado y muestra
 *   el título de la vista cuando el título grande ha salido de la pantalla.
 */

import { prefersReducedMotion, springTiming } from './motion/spring.js';

/** Posición y tamaño de la píldora para un botón, dentro de su barra. */
export function geometriaPildora(boton, margen = 0) {
    return {
        x: boton.offsetLeft + margen,
        y: boton.offsetTop + margen,
        ancho: Math.max(0, boton.offsetWidth - 2 * margen),
        alto: Math.max(0, boton.offsetHeight - 2 * margen),
    };
}

/** La píldora de una barra de pestañas. */
export function createTabPill(nav, { margen = 0 } = {}) {
    const pildora = document.createElement('span');
    pildora.className = 'nav-pildora';
    pildora.setAttribute('aria-hidden', 'true');
    nav.prepend(pildora);
    let actual = null;
    let colocada = false;

    function colocar(boton, animar) {
        actual = boton;
        if (!boton || !boton.offsetWidth) {
            pildora.style.opacity = '0';
            colocada = false;
            return;
        }
        const g = geometriaPildora(boton, margen);
        // La primera vez, o al cambiar de tamaño, aparece ya en su sitio
        if (!animar || !colocada) pildora.style.transition = 'none';
        pildora.style.width = `${g.ancho}px`;
        pildora.style.height = `${g.alto}px`;
        pildora.style.transform = `translate(${g.x}px, ${g.y}px)`;
        pildora.style.opacity = '1';
        if (pildora.style.transition) {
            void pildora.offsetWidth;
            pildora.style.transition = '';
        }
        colocada = true;
    }

    // Cambios de tamaño (y la barra lateral, que en el móvil no se ve)
    if (globalThis.ResizeObserver) new ResizeObserver(() => colocar(actual, false)).observe(nav);

    return { mover: boton => colocar(boton, true) };
}

/** El icono pulsado rebota de 0,9 a 1 con el muelle vivo. */
export function rebotarIcono(boton) {
    const icono = boton?.querySelector('svg, .material-symbols-outlined, .nav-profile-wrapper');
    if (!icono?.animate || prefersReducedMotion()) return;
    const { easing, durationMs } = springTiming('bouncy');
    try {
        icono.animate([{ scale: 0.9 }, { scale: 1 }], { duration: durationMs, easing });
    } catch {
        // Un navegador que no acepte linear() en animaciones: sin rebote
    }
}

/**
 * Qué transición corresponde a un cambio de vista: 'push' al entrar en un
 * detalle, 'pop' al volver de él a su padre, null entre pestañas.
 */
export function direccionDeNavegacion(desde, hacia, padres) {
    if (padres[hacia] && padres[hacia] === desde) return 'push';
    if (padres[desde] && padres[desde] === hacia) return 'pop';
    return null;
}

/**
 * Aplica un cambio de vista con la transición de `direccion`. Sin View
 * Transitions, con «Reducir movimiento» o sin dirección, el cambio es
 * inmediato, como antes.
 */
export function transicionDeVista(direccion, aplicar) {
    const raiz = document.documentElement;
    if (!direccion || !document.startViewTransition || prefersReducedMotion()) {
        aplicar();
        return null;
    }
    raiz.dataset.navegacion = direccion;
    const transicion = document.startViewTransition(aplicar);
    transicion.finished.finally(() => {
        if (raiz.dataset.navegacion === direccion) delete raiz.dataset.navegacion;
    });
    return transicion;
}

/**
 * Cabecera móvil que reacciona al scroll: `data-borde` cuando hay contenido
 * desplazado y `data-compacta` (con el título de la vista) cuando el título
 * grande ya no se ve.
 */
export function initCabeceraCompacta({ cabecera, scroller, vistaActiva }) {
    if (!cabecera || !scroller || !globalThis.IntersectionObserver) return { actualizar() {} };

    const centinela = document.createElement('div');
    centinela.className = 'centinela-scroll';
    centinela.setAttribute('aria-hidden', 'true');
    scroller.prepend(centinela);

    const titulo = document.createElement('span');
    titulo.className = 'mobile-header-titulo';
    titulo.setAttribute('aria-hidden', 'true');
    cabecera.append(titulo);

    // Con contenido desplazado, un degradado separa la cabecera de la lista
    new IntersectionObserver(([e]) => {
        if (e.isIntersecting) delete cabecera.dataset.borde;
        else cabecera.dataset.borde = 'con-contenido';
    }, { root: scroller }).observe(centinela);

    const fuera = new Set();
    const observador = new IntersectionObserver((entradas) => {
        for (const e of entradas) {
            // Solo cuenta si ha salido por arriba, no si está oculto o por debajo
            const porArriba = !e.isIntersecting && e.boundingClientRect.height > 0
                && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0);
            if (porArriba) fuera.add(e.target); else fuera.delete(e.target);
        }
        actualizar();
    }, { root: scroller });
    document.querySelectorAll('.app-view .view-title').forEach(t => observador.observe(t));

    function actualizar() {
        const grande = document.getElementById(vistaActiva())?.querySelector('.view-title');
        if (grande && fuera.has(grande)) {
            titulo.textContent = grande.textContent.trim();
            cabecera.dataset.compacta = '';
        } else {
            delete cabecera.dataset.compacta;
        }
    }

    return { actualizar };
}
