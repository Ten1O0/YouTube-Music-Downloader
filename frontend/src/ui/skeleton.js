/**
 * Esqueletos de carga (plan 10, T8).
 *
 * Mientras algo carga, bloques con la forma de lo que viene: filas de la
 * biblioteca, resultados de búsqueda, tarjetas de listas, líneas de letra. En
 * lugar de una rueda, que no dice nada de qué va a aparecer.
 *
 * Solo aparecen si la carga pasa de RETRASO_MS: si no, parpadean un instante y
 * es peor que no poner nada.
 */

export const RETRASO_MS = 150;

/** Cómo es cada forma: qué piezas lleva un elemento. */
const FORMAS = {
    fila: ['esq-arte', 'esq-lineas'],
    resultado: ['esq-arte esq-arte-ancho', 'esq-lineas'],
    tarjeta: ['esq-portada', 'esq-linea esq-corta'],
    letra: ['esq-linea'],
};

function crearElemento(forma, i) {
    const el = document.createElement('div');
    el.className = `esqueleto esqueleto-${forma}`;
    for (const pieza of FORMAS[forma]) {
        const p = document.createElement('div');
        p.className = pieza;
        if (pieza === 'esq-lineas') {
            for (const ancho of ['esq-larga', 'esq-corta']) {
                const l = document.createElement('div');
                l.className = `esq-linea ${ancho}`;
                p.append(l);
            }
        }
        el.append(p);
    }
    // Las líneas de letra, de largos distintos, como un texto de verdad
    if (forma === 'letra') el.style.setProperty('--ancho', `${[70, 90, 55, 80, 65, 85, 50, 75][i % 8]}%`);
    return el;
}

/** Pinta n esqueletos al final del contenedor y devuelve el envoltorio. */
export function pintarEsqueletos(contenedor, forma, n) {
    const envoltorio = document.createElement('div');
    envoltorio.className = `esqueletos esqueletos-${forma}`;
    envoltorio.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < n; i++) envoltorio.append(crearElemento(forma, i));
    contenedor.setAttribute('aria-busy', 'true');
    contenedor.append(envoltorio);
    return envoltorio;
}

/**
 * Espera a una promesa y, si tarda más de RETRASO_MS, enseña esqueletos
 * mientras tanto. Los quita al terminar, bien o mal.
 * `alMostrar` se llama justo antes de pintarlos (para hacer visible la sección).
 */
export async function conEsqueleto(contenedor, forma, n, promesa, { retraso = RETRASO_MS, alMostrar } = {}) {
    if (!contenedor) return promesa;
    let puestos = null;
    const reloj = setTimeout(() => {
        alMostrar?.();
        puestos = pintarEsqueletos(contenedor, forma, n);
    }, retraso);
    try {
        return await promesa;
    } finally {
        clearTimeout(reloj);
        puestos?.remove();
        contenedor.removeAttribute('aria-busy');
    }
}
