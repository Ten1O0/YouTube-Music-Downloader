/**
 * Portadas generadas (plan 27, T1): para que ninguna lista ni canción se quede
 * sin portada.
 *
 * Un degradado con formas abstractas, sin texto, en un SVG pequeño (`data:`)
 * que se ve nítido a cualquier tamaño. Siempre la misma para la misma semilla
 * (hash FNV-1a):
 *
 * - una lista: su id (renombrarla no cambia la portada); y en «Editar» se
 *   puede elegir una de las VARIANTES (`gen:0` … `gen:7`);
 * - una canción: el color sale del artista (las suyas se reconocen entre sí) y
 *   las formas, de la propia canción.
 *
 * Pura y sin DOM. Se carga aparte (presupuesto del plan 19): en el arranque solo
 * está core/portada-generada.js, que la pide la primera vez que falta una.
 */

import { html } from './html.js';

/** Los pares de colores, de la paleta de la app (el dorado y la salvia, entre ellos) y de las portadas de ejemplo del README. */
const PARES = [
    ['#f6a96c', '#c2456e'],
    ['#3fb8af', '#1d3557'],
    ['#e9c46a', '#9b5de5'],
    ['#4cc9f0', '#3a0ca3'],
    ['#90be6d', '#277da1'],
    ['#ff6b6b', '#2d1e2f'],
    ['#e0cead', '#6b4f3a'],
    ['#a3b18a', '#344e41'],
];

/** Cuántas portadas se pueden elegir en una lista. */
export const VARIANTES = PARES.length;

/** Hash FNV-1a de 32 bits de un texto. Pura. */
export function fnv1a(texto) {
    let h = 0x811c9dc5;
    for (const ch of String(texto ?? '')) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

const n = (x) => Math.round(x * 10) / 10;

/** Las formas, en un lienzo de 100×100. `k` mueve y escala cada una sin salirse. */
const DISPOSICIONES = [
    // Un círculo claro y una franja oscura, como las portadas de ejemplo
    (k) => html`<circle cx="${n(25 + (k % 50))}" cy="${n(30 + ((k >>> 6) % 40))}" r="${n(18 + ((k >>> 12) % 16))}" fill="#fff" fill-opacity=".35"/><rect y="${n(62 + ((k >>> 18) % 16))}" width="100" height="${n(10 + ((k >>> 22) % 8))}" fill="#000" fill-opacity=".2"/>`,
    // Dos círculos que se cruzan
    (k) => html`<circle cx="${n(30 + (k % 30))}" cy="${n(35 + ((k >>> 6) % 30))}" r="${n(26 + ((k >>> 12) % 10))}" fill="#fff" fill-opacity=".22"/><circle cx="${n(55 + ((k >>> 16) % 25))}" cy="${n(55 + ((k >>> 20) % 25))}" r="${n(14 + ((k >>> 24) % 10))}" fill="#fff" fill-opacity=".3"/>`,
    // Una banda en diagonal y un punto oscuro
    (k) => html`<polygon points="${`0,${n(55 + (k % 20))} 100,${n(20 + ((k >>> 6) % 20))} 100,${n(45 + ((k >>> 12) % 15))} 0,${n(80 + ((k >>> 16) % 15))}`}" fill="#fff" fill-opacity=".2"/><circle cx="${n(65 + ((k >>> 20) % 20))}" cy="${n(70 + ((k >>> 24) % 15))}" r="${n(8 + ((k >>> 27) % 6))}" fill="#000" fill-opacity=".22"/>`,
    // Anillos
    (k) => {
        const cx = n(35 + (k % 30));
        const cy = n(40 + ((k >>> 6) % 25));
        return html`<circle cx="${cx}" cy="${cy}" r="${n(30 + ((k >>> 12) % 8))}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="6"/><circle cx="${cx}" cy="${cy}" r="${n(14 + ((k >>> 16) % 6))}" fill="#fff" fill-opacity=".25"/>`;
    },
];

/** El SVG de una portada, como `data:`. Pura. */
function svg([c1, c2], disposicion, k) {
    const cuerpo = html`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${DISPOSICIONES[disposicion](k)}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(String(cuerpo))}`;
}

/**
 * La portada de una lista: `{ src, colores }`. Sin `variante`, la automática
 * de su id; con una (0 … VARIANTES - 1), esa, con las formas movidas por el id.
 */
export function portadaGenerada(semilla, variante = null) {
    const h = fnv1a(semilla);
    const v = Number.isInteger(variante) && variante >= 0 && variante < VARIANTES ? variante : h % VARIANTES;
    return { src: svg(PARES[v], v % DISPOSICIONES.length, h), colores: [...PARES[v]] };
}

/** La portada de una canción sin carátula: el color, de su artista; las formas, de la canción. */
export function portadaDeCancion(artista, id) {
    const par = PARES[fnv1a(String(artista ?? '').trim().toLowerCase()) % VARIANTES];
    const h = fnv1a(id);
    return { src: svg(par, h % DISPOSICIONES.length, h >>> 2), colores: [...par] };
}

/** La portada que pide una marca del arranque (core/portada-generada.js). Pura. */
export function desdeMarca(marca) {
    const [tipo, ...resto] = decodeURIComponent(String(marca).split('#gen=')[1] ?? '').split('\n');
    if (tipo === 'c') return portadaDeCancion(resto[0], resto[1]).src;
    const variante = resto[1] === '' ? null : Number(resto[1]);
    return portadaGenerada(resto[0], variante).src;
}
