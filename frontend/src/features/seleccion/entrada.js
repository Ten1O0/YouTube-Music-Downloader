/**
 * Cómo se entra en la selección múltiple (plan 24, P8): una pulsación larga en
 * una fila (móvil) o Cmd/Ctrl o Mayús + clic (ordenador). Esto va en el
 * arranque y es poco; la selección se carga al entrar en ella.
 */

const LISTAS = '#libraryList, #playlistDetailList';
const PULSACION_LARGA = 500;
/** Lo que se puede mover el dedo sin que deje de ser una pulsación larga. */
const HOLGURA = 10;

const cargar = () => import('./seleccion.js');

function filaDe(objetivo) {
    const fila = objetivo?.closest?.('.library-item[data-src]');
    if (!fila?.closest(LISTAS)) return null;
    if (fila.classList.contains('edit-mode') || fila.classList.contains('library-item-unavailable')) return null;
    return fila;
}

const seleccionando = () => document.documentElement.classList.contains('seleccionando');

// El clic que llega al soltar una pulsación larga no debe desmarcar la fila
function tragarseElClic() {
    const parar = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    globalThis.addEventListener('click', parar, { capture: true, once: true });
    setTimeout(() => globalThis.removeEventListener('click', parar, { capture: true }), 600);
}

export function initEntradaSeleccion() {
    let espera = null;
    const cancelar = () => {
        if (espera) clearTimeout(espera.reloj);
        espera = null;
    };

    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' || !e.isPrimary || seleccionando()) return;
        const fila = filaDe(e.target);
        if (!fila || e.target.closest('button')) return;
        cancelar();
        espera = {
            x: e.clientX, y: e.clientY,
            reloj: setTimeout(() => {
                espera = null;
                tragarseElClic();
                cargar().then((m) => m.entrarEnSeleccion({ fila })).catch((err) => console.error('[Selección]', err));
            }, PULSACION_LARGA),
        };
    });
    document.addEventListener('pointermove', (e) => {
        if (espera && Math.hypot(e.clientX - espera.x, e.clientY - espera.y) > HOLGURA) cancelar();
    });
    document.addEventListener('pointerup', cancelar);
    document.addEventListener('pointercancel', cancelar);
    // En Android, la pulsación larga sobre la carátula abriría el menú del sistema
    document.addEventListener('contextmenu', (e) => {
        if (espera || (seleccionando() && filaDe(e.target))) e.preventDefault();
    });

    // Ordenador: Cmd/Ctrl + clic marca una; Mayús + clic, un tramo
    document.addEventListener('click', (e) => {
        if (seleccionando() || !(e.metaKey || e.ctrlKey || e.shiftKey)) return;
        const fila = filaDe(e.target);
        if (!fila || e.target.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        cargar().then((m) => m.entrarEnSeleccion({ fila })).catch((err) => console.error('[Selección]', err));
    }, true);
}
