/**
 * Aviso breve y flotante, visible desde cualquier vista.
 *
 * El mensaje de estado de la app vive en la tarjeta de Inicio: lo que pasaba
 * en otra vista (añadir una canción a la cola desde la Biblioteca, p. ej.) no
 * se veía. Este aviso es una píldora de cristal que aparece un momento encima
 * de la barra inferior y se va sola. Un lector de pantalla lo anuncia.
 */

const DURACION_MS = 2200;
let pildora = null;
let reloj = 0;

function crear() {
    const el = document.createElement('div');
    el.className = 'aviso-flotante glass-regular';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.body.append(el);
    return el;
}

/** Muestra `texto`; si ya había un aviso, lo sustituye y reinicia su tiempo. */
export function avisar(texto, { duracion = DURACION_MS } = {}) {
    if (!globalThis.document?.body || !texto) return;
    pildora ??= crear();
    clearTimeout(reloj);
    pildora.textContent = texto;
    pildora.hidden = false;
    pildora.classList.remove('saliendo');
    reloj = setTimeout(() => {
        pildora.classList.add('saliendo');
        reloj = setTimeout(() => { pildora.hidden = true; }, 250);
    }, duracion);
}
