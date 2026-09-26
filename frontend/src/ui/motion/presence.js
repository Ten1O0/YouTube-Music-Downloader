/**
 * Entradas y salidas animables (plan 09, T3).
 *
 * Mostrar una pieza ya no es quitarle `hidden` de golpe: pasa por un estado
 * explícito en `data-presence` donde el CSS pone las poses.
 *
 *            show()                      (fin de las transiciones)
 *   oculto ─────────► entering ─► shown
 *     ▲                                │ hide()
 *     └──── (fin) ───── leaving ◄──────┘
 *
 * El CSS define la pose de entrada/salida en [data-presence="entering"] y
 * [data-presence="leaving"], y la de reposo en [data-presence="shown"]. Este
 * módulo gestiona `hidden`, el estado y las interrupciones, y devuelve una
 * promesa que se resuelve cuando la pieza ha llegado.
 *
 * Los 13 modales no lo necesitan: entran y salen con @starting-style y
 * `transition-behavior: allow-discrete`, sin JavaScript. Esto es para las
 * piezas que otro código tiene que esperar (isla, banners, vista de detalle,
 * hojas que se arrastran).
 */

const TIMEOUT_MS = 1200;
const turnos = new WeakMap();

/** Espera a que terminen todas las transiciones que arranquen en `el` o dentro. */
function esperarTransiciones(el, timeout) {
    return new Promise(resolve => {
        let activas = 0, arrancada = false, hecho = false;
        const fin = () => {
            if (hecho) return;
            hecho = true;
            el.removeEventListener('transitionrun', alArrancar);
            el.removeEventListener('transitionend', alAcabar);
            el.removeEventListener('transitioncancel', alAcabar);
            clearTimeout(reloj);
            resolve();
        };
        const alArrancar = () => { activas++; arrancada = true; };
        const alAcabar = () => { activas = Math.max(0, activas - 1); if (activas === 0) fin(); };
        el.addEventListener('transitionrun', alArrancar);
        el.addEventListener('transitionend', alAcabar);
        el.addEventListener('transitioncancel', alAcabar);
        const reloj = setTimeout(fin, timeout);
        // Si en dos fotogramas no ha arrancado nada, no hay nada que esperar
        // (sin transición definida, o «Reducir movimiento» sin cambios visibles).
        const raf = globalThis.requestAnimationFrame ?? (cb => setTimeout(cb, 16));
        raf(() => raf(() => { if (!arrancada) fin(); }));
    });
}

/** Muestra `el` pasando por `entering`. */
export async function show(el, { timeout = TIMEOUT_MS } = {}) {
    const turno = (turnos.get(el) ?? 0) + 1;
    turnos.set(el, turno);
    el.hidden = false;
    el.dataset.presence = 'entering';
    void el.offsetWidth; // aplica la pose de entrada antes de pedir el reposo
    el.dataset.presence = 'shown';
    await esperarTransiciones(el, timeout);
}

/** Oculta `el` pasando por `leaving`; al final queda con `hidden`. */
export async function hide(el, { timeout = TIMEOUT_MS } = {}) {
    if (el.hidden) return;
    const turno = (turnos.get(el) ?? 0) + 1;
    turnos.set(el, turno);
    el.dataset.presence = 'leaving';
    await esperarTransiciones(el, timeout);
    // Si mientras salía alguien lo volvió a mostrar, ese turno manda.
    if (turnos.get(el) !== turno) return;
    el.hidden = true;
    delete el.dataset.presence;
}

/** Visible y sin estar saliendo. */
export function isShown(el) {
    return !el.hidden && el.dataset.presence !== 'leaving';
}
