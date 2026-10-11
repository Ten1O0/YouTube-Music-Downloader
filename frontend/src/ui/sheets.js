/**
 * Hojas, alertas y foco de los modales (plan 09, T17).
 *
 * Los modales se abren y se cierran desde muchos sitios quitando y poniendo
 * `.hidden`. Aquí no se cambia eso: se observa. Con lo observado se lleva una
 * pila de abiertos (el último, arriba), y sobre ella:
 *
 * - El foco entra en el modal al abrirse, no se escapa con Tab y vuelve a
 *   quien lo abrió al cerrarse.
 * - Escape cierra el de arriba.
 * - En el móvil, las hojas se cierran arrastrándolas hacia abajo.
 *
 * Cerrar es siempre «lo que haría el usuario»: pulsar la X de ese modal o, si
 * no tiene, su fondo. Así cada modal ejecuta su propia lógica de cierre
 * (historial, promesas de las alertas…) sin que esto tenga que conocerla.
 */

import { Spring } from './motion/spring.js';
import { rubberBand, shouldDismiss, trackVerticalDrag } from './motion/gesture.js';

export const SELECTOR_MODAL = '.auth-modal, .pq-sheet';
const SELECTOR_PANEL = '.auth-modal-content, .pq-panel';
const ENFOCABLES = [
    'button:not([disabled])', 'a[href]', 'select:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const estaAbierto = modal => !modal.classList.contains('hidden');
export const esAlerta = modal => modal.classList.contains('modal-alerta');
export const panelDe = modal => modal.querySelector(SELECTOR_PANEL);

/** Controles que pueden recibir el foco, en orden y a la vista. */
export function enfocables(panel) {
    if (!panel) return [];
    return [...panel.querySelectorAll(ENFOCABLES)].filter(el => el.getClientRects().length > 0);
}

/** A dónde va el foco con Tab (o Mayús+Tab) sin salir del modal. */
export function siguienteFoco(lista, actual, atras = false) {
    if (!lista.length) return null;
    const i = lista.indexOf(actual);
    if (i === -1) return atras ? lista[lista.length - 1] : lista[0];
    return lista[(i + (atras ? -1 : 1) + lista.length) % lista.length];
}

/**
 * El control que recibe el foco al abrir: el primero que no sea la X. En
 * táctil nunca un campo de texto, que sacaría el teclado sin pedirlo; entonces
 * se devuelve null y el foco va al propio panel.
 */
export function primerControl(lista, { tactil = false } = {}) {
    const candidato = lista.find(el => !el.matches('.auth-modal-close, .pq-close-btn')) ?? lista[0] ?? null;
    if (tactil && candidato?.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"])')) return null;
    return candidato;
}

/**
 * El z-index de un modal que se abre (plan 21, T2): por encima de todos los
 * que ya están abiertos, aunque en el HTML vaya antes. Las hojas comparten
 * z-index, y entonces ganaba la última del HTML: «Cerrar sesión», abierta desde
 * Ajustes, salía detrás. Nunca baja el suyo propio (la alerta lleva 99999).
 */
export function zIndexAlAbrir(propio, abiertos = []) {
    return Math.max(propio, ...abiertos.map((z) => z + 1));
}

/** Cierra como lo haría el usuario: con la X de ese modal o, si no tiene, con su fondo. */
export function cerrarComoUsuario(modal) {
    const boton = modal.querySelector('.auth-modal-close, .pq-close-btn')
        ?? modal.querySelector('.auth-modal-backdrop, .pq-backdrop');
    boton?.click();
}

/**
 * ¿Puede empezar aquí el arrastre para cerrar? Desde el asa, siempre. Desde el
 * contenido, solo si nada de lo que hay entre el dedo y el panel tiene scroll
 * desplazado: si no, el gesto es de ese scroll.
 */
export function puedeArrastrar(objetivo, panel) {
    if (objetivo.closest?.('.hoja-asa, .pq-handle-bar')) return true;
    for (let el = objetivo; el && el !== panel.parentElement; el = el.parentElement) {
        if (el.scrollTop > 0) return false;
        if (el === panel) break;
    }
    return true;
}

export function initModales({
    cerrar = cerrarComoUsuario,
    esMovil = () => globalThis.matchMedia?.('(max-width: 767px)').matches ?? false,
    esTactil = () => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
} = {}) {
    const pila = [];
    const origen = new WeakMap();
    let focoFuera = null;

    // Quién tenía el foco antes de abrir: se apunta en cada cambio de foco
    // fuera de los modales, porque al abrir puede que ya se haya movido dentro.
    document.addEventListener('focusin', (e) => {
        if (!e.target.closest?.(SELECTOR_MODAL)) focoFuera = e.target;
    });

    function prepararAria(modal) {
        const panel = panelDe(modal);
        if (!panel) return;
        if (!panel.hasAttribute('role')) panel.setAttribute('role', esAlerta(modal) ? 'alertdialog' : 'dialog');
        panel.setAttribute('aria-modal', 'true');
        if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
    }

    const zDe = (el) => Number.parseInt(globalThis.getComputedStyle?.(el).zIndex, 10) || 0;

    /** El que se abre, encima de los abiertos. Su z-index en línea, si lo traía, se guarda. */
    function subir(modal) {
        if (!('zOriginal' in modal.dataset)) modal.dataset.zOriginal = modal.style.zIndex;
        modal.style.zIndex = modal.dataset.zOriginal;
        const propio = zDe(modal);
        const z = zIndexAlAbrir(propio, pila.filter((m) => m !== modal).map(zDe));
        if (z !== propio) modal.style.zIndex = String(z);
    }

    function bajar(modal) {
        if (!('zOriginal' in modal.dataset)) return;
        modal.style.zIndex = modal.dataset.zOriginal;
        delete modal.dataset.zOriginal;
    }

    function alAbrir(modal) {
        pila.push(modal);
        subir(modal);
        origen.set(modal, focoFuera ?? document.activeElement);
        const panel = panelDe(modal);
        // Si quien lo abrió ya puso el foco dentro (un campo, p. ej.), se respeta
        if (!panel || panel.contains(document.activeElement)) return;
        const destino = primerControl(enfocables(panel), { tactil: esTactil() }) ?? panel;
        destino.focus({ preventScroll: true });
    }

    function alCerrar(modal) {
        pila.splice(pila.indexOf(modal), 1);
        bajar(modal);
        const panel = panelDe(modal);
        if (panel && modal.dataset.arrastre) {
            // Cerrada arrastrando: sigue hacia abajo desde donde la soltó el dedo
            panel.style.transform = '';
            setTimeout(() => { delete modal.dataset.arrastre; }, 400);
        }
        const activo = document.activeElement;
        const volver = origen.get(modal);
        if ((!activo || activo === document.body || modal.contains(activo)) && volver?.isConnected) {
            volver.focus({ preventScroll: true });
        }
    }

    function prepararArrastre(modal) {
        const panel = panelDe(modal);
        if (!panel || esAlerta(modal)) return;
        if (modal.classList.contains('auth-modal') && !panel.querySelector('.hoja-asa')) {
            const asa = document.createElement('div');
            asa.className = 'hoja-asa';
            asa.setAttribute('aria-hidden', 'true');
            panel.prepend(asa);
        }
        let alto = 0;
        const muelle = new Spring({
            preset: 'snappy', precision: 0.5,
            onUpdate: (y) => { panel.style.transform = Math.abs(y) > 0.5 ? `translateY(${y}px)` : ''; },
        });
        trackVerticalDrag(panel, {
            canStart: e => esMovil() && pila.at(-1) === modal && puedeArrastrar(e.target, panel),
            onStart: () => {
                muelle.stop();
                alto = panel.offsetHeight;
                modal.dataset.arrastre = 'siguiendo';
            },
            // Hacia abajo, uno a uno; hacia arriba, con resistencia
            onMove: dy => muelle.jump(dy < 0 ? -rubberBand(-dy, 60) : dy),
            onEnd: ({ offset, velocity }) => {
                if (offset > 0 && shouldDismiss({ offset, velocity, size: alto })) {
                    modal.dataset.arrastre = 'soltando';
                    cerrar(modal);
                    // Si ese modal no se deja cerrar (p. ej. los permisos), vuelve
                    setTimeout(() => {
                        if (estaAbierto(modal)) volver();
                    }, 350);
                } else {
                    volver(velocity);
                }
            },
        });
        function volver(velocity = 0) {
            modal.dataset.arrastre = 'volviendo';
            muelle.to(0, { velocity: Math.min(0, velocity) }).then(() => {
                if (modal.dataset.arrastre === 'volviendo') delete modal.dataset.arrastre;
            });
        }
    }

    const observador = new MutationObserver((cambios) => {
        for (const { target: modal } of cambios) {
            const abierto = estaAbierto(modal);
            const estaba = pila.includes(modal);
            if (abierto && !estaba) alAbrir(modal);
            else if (!abierto && estaba) alCerrar(modal);
        }
    });

    document.querySelectorAll(SELECTOR_MODAL).forEach((modal) => {
        prepararAria(modal);
        prepararArrastre(modal);
        observador.observe(modal, { attributes: true, attributeFilter: ['class'] });
        if (estaAbierto(modal)) alAbrir(modal);
    });

    document.addEventListener('keydown', (e) => {
        const arriba = pila.at(-1);
        if (!arriba) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            cerrar(arriba);
        } else if (e.key === 'Tab') {
            const destino = siguienteFoco(enfocables(panelDe(arriba)), document.activeElement, e.shiftKey);
            e.preventDefault();
            (destino ?? panelDe(arriba))?.focus();
        }
    });

    return {
        /** El modal de arriba, o null. */
        arriba: () => pila.at(-1) ?? null,
        abiertos: () => [...pila],
    };
}
