/**
 * Sortable, solo mientras se mueve a mano.
 *
 * Al cargarse, Sortable pone en todo el documento un `touchmove` que no es
 * pasivo: así la página no se desplaza mientras se arrastra una fila. Con él
 * puesto, cada gesto tiene que pasar por el hilo principal antes de mover la
 * página, y el scroll de toda la app deja de ir por su cuenta. En la APK, donde
 * el WebView da poca prioridad a ese hilo, iba a tirones (traza en el móvil,
 * 2026-10-23). Aquí se carga al empezar a mover, se aparta ese oyente y solo
 * se pone mientras hay filas que arrastrar.
 */

let carga = null;
let oyente = null;
let puesto = false;

/** Carga Sortable una vez y se queda con su `touchmove` del documento en vez de dejarlo puesto. */
export function cargarSortable(doc = document) {
    if (globalThis.Sortable) return Promise.resolve(globalThis.Sortable);
    return (carga ??= new Promise((ok, mal) => {
        const heredado = !Object.hasOwn(doc, 'addEventListener');
        const original = doc.addEventListener;
        const restaurar = () => {
            if (heredado) delete doc.addEventListener;
            else doc.addEventListener = original;
        };
        doc.addEventListener = function (tipo, fn, opciones) {
            if (tipo === 'touchmove' && !oyente && opciones?.passive === false) {
                oyente = fn;
                return undefined;
            }
            return original.call(this, tipo, fn, opciones);
        };
        const script = doc.createElement('script');
        script.src = '/Sortable.min.js';
        script.onload = () => { restaurar(); ok(globalThis.Sortable); };
        script.onerror = () => {
            restaurar();
            carga = null;
            mal(new Error('No se pudo cargar Sortable'));
        };
        doc.head.append(script);
    }));
}

/** Pone o quita el `touchmove` de Sortable en el documento. */
export function arrastreTactil(activo, doc = document) {
    if (!oyente || activo === puesto) return;
    puesto = activo;
    if (activo) doc.addEventListener('touchmove', oyente, { passive: false });
    else doc.removeEventListener('touchmove', oyente, { passive: false });
}
