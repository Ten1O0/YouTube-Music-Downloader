/**
 * Atajos de teclado (plan 10, T4), como en Apple Music y YouTube.
 *
 * | Tecla                    | Acción                                   |
 * |--------------------------|------------------------------------------|
 * | Espacio · K              | Reproducir / pausar                      |
 * | ← / →                    | Retroceder / avanzar 10 s                |
 * | Mayús+← · P / Mayús+→ · N | Canción anterior / siguiente            |
 * | ↑ / ↓                    | Volumen ±5 %                             |
 * | M                        | Silenciar                                |
 * | L                        | Favorito de lo que suena                 |
 * | F                        | Abrir / cerrar el reproductor completo   |
 * | /                        | Ir al buscador                           |
 * | ?                        | Hoja con todos los atajos                |
 *
 * Escape no está aquí: lo lleva ui/sheets.js (modales) y el reproductor.
 */

/** Acciones que solo tienen sentido con una canción cargada. */
const DEL_REPRODUCTOR = new Set([
    'reproducir', 'atras', 'adelante', 'anterior', 'siguiente',
    'volumenMas', 'volumenMenos', 'silencio', 'favorito', 'pantallaCompleta',
]);

const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** ¿El foco está en algo donde se escribe o que ya usa esas teclas? */
export function focoOcupado(elemento, tecla) {
    if (!elemento) return false;
    if (CAMPOS.has(elemento.tagName) || elemento.isContentEditable) return true;
    // Espacio e Intro pulsan el botón o el enlace enfocado: se les deja
    if ((tecla === ' ' || tecla === 'Enter') && (elemento.tagName === 'BUTTON' || elemento.tagName === 'A')) return true;
    // En listas con rol (menús, listas de opciones) las flechas mueven el cursor
    if (tecla.startsWith('Arrow') && elemento.closest?.('[role="listbox"], [role="menu"], [role="slider"], [role="tablist"]')) return true;
    return false;
}

/**
 * Qué acción corresponde a una tecla, o null si no toca hacer nada.
 * @param {KeyboardEvent} e
 * @param {{ enfocado?: Element|null, modalAbierto?: boolean, hayCancion?: boolean }} contexto
 */
export function accionDeTecla(e, { enfocado = null, modalAbierto = false, hayCancion = false } = {}) {
    // Con Ctrl, ⌘ o Alt, la tecla es del navegador o del sistema
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    if (e.isComposing) return null;
    if (modalAbierto) return null;
    if (focoOcupado(enfocado, e.key)) return null;

    let accion = null;
    switch (e.key) {
        case ' ': case 'k': case 'K': accion = 'reproducir'; break;
        case 'ArrowLeft': accion = e.shiftKey ? 'anterior' : 'atras'; break;
        case 'ArrowRight': accion = e.shiftKey ? 'siguiente' : 'adelante'; break;
        case 'p': case 'P': accion = 'anterior'; break;
        case 'n': case 'N': accion = 'siguiente'; break;
        case 'ArrowUp': accion = 'volumenMas'; break;
        case 'ArrowDown': accion = 'volumenMenos'; break;
        case 'm': case 'M': accion = 'silencio'; break;
        case 'l': case 'L': accion = 'favorito'; break;
        case 'f': case 'F': accion = 'pantallaCompleta'; break;
        case '/': accion = 'buscar'; break;
        case '?': accion = 'ayuda'; break;
        default: return null;
    }
    if (DEL_REPRODUCTOR.has(accion) && !hayCancion) return null;
    return accion;
}

/**
 * Escucha el teclado y llama a `acciones[nombre]()`.
 * `contexto()` devuelve { modalAbierto, hayCancion } en el momento de la tecla.
 */
export function initAtajos(acciones, contexto) {
    document.addEventListener('keydown', (e) => {
        const accion = accionDeTecla(e, { enfocado: document.activeElement, ...contexto() });
        if (!accion || !acciones[accion]) return;
        // Solo cuando se usa: así Espacio y las flechas siguen desplazando la
        // página si no hay nada que controlar
        e.preventDefault();
        acciones[accion]();
    });
}
