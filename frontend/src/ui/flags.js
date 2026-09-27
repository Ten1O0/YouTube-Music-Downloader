/**
 * Banderas del selector de idioma (plan 09, T6).
 *
 * Antes eran PNG de flagcdn.com: una petición a un tercero en cada carga, que
 * además no se veía sin conexión (el service worker no cachea ese dominio a
 * propósito). Ahora son SVG propios, simplificados para su tamaño real
 * (24 × 18 px), servidos como data: URI para que cada imagen sea independiente.
 */

import { html } from '../core/html.js';

const SVG = {
    es: '<rect width="24" height="18" fill="#AA151B"/><rect y="4.5" width="24" height="9" fill="#F1BF00"/>',
    en: '<rect width="24" height="18" fill="#012169"/>'
        + '<path d="M0,0L24,18M24,0L0,18" stroke="#fff" stroke-width="3.6"/>'
        + '<path d="M0,0L24,18M24,0L0,18" stroke="#C8102E" stroke-width="1.2"/>'
        + '<path d="M12,0V18M0,9H24" stroke="#fff" stroke-width="6"/>'
        + '<path d="M12,0V18M0,9H24" stroke="#C8102E" stroke-width="3.6"/>',
    fr: '<rect width="8" height="18" fill="#002395"/><rect x="8" width="8" height="18" fill="#fff"/><rect x="16" width="8" height="18" fill="#ED2939"/>',
    de: '<rect width="24" height="6" fill="#000"/><rect y="6" width="24" height="6" fill="#DD0000"/><rect y="12" width="24" height="6" fill="#FFCE00"/>',
    pt: '<rect width="9.6" height="18" fill="#006600"/><rect x="9.6" width="14.4" height="18" fill="#FF0000"/>'
        + '<circle cx="9.6" cy="9" r="3.4" fill="#FFCC00"/><rect x="8.2" y="7.2" width="2.8" height="3.4" rx="0.6" fill="#FF0000" stroke="#fff" stroke-width="0.5"/>',
    zh: '<rect width="24" height="18" fill="#DE2910"/><g fill="#FFDE00">'
        + '<polygon points="4.00,1.80 4.61,3.67 6.57,3.67 4.98,4.82 5.59,6.68 4.00,5.53 2.41,6.68 3.02,4.82 1.43,3.67 3.39,3.67"/>'
        + '<polygon points="7.25,2.30 7.66,1.79 7.29,1.25 7.91,1.47 8.31,0.95 8.28,1.61 8.90,1.83 8.27,2.01 8.25,2.67 7.88,2.12"/>'
        + '<polygon points="8.71,3.74 9.29,3.44 9.19,2.80 9.65,3.26 10.23,2.96 9.94,3.55 10.40,4.01 9.76,3.91 9.46,4.49 9.36,3.84"/>'
        + '<polygon points="8.73,5.77 9.38,5.73 9.55,5.10 9.79,5.71 10.44,5.68 9.93,6.09 10.17,6.70 9.62,6.34 9.11,6.75 9.28,6.12"/>'
        + '<polygon points="7.31,7.23 7.91,7.47 8.33,6.96 8.29,7.62 8.90,7.86 8.27,8.02 8.22,8.67 7.87,8.12 7.24,8.28 7.66,7.78"/>'
        + '</g>',
};

/** data: URI de la bandera de cada idioma de la app. */
export const FLAGS = Object.fromEntries(Object.entries(SVG).map(([lang, cuerpo]) => [
    lang,
    'data:image/svg+xml,' + encodeURIComponent(
        // No es HTML de la página: es el contenido de un data: URI, y lo que se
        // interpola es el dibujo fijo de cada bandera
        // eslint-disable-next-line no-restricted-syntax
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18" width="24" height="18">${cuerpo}</svg>`),
]));

/** Etiqueta <img> de una bandera, con su texto alternativo. */
export function flagImg(lang, className = 'lang-flag') {
    const src = FLAGS[lang];
    if (!src) return lang.toUpperCase();
    return html`<img src="${src}" class="${className}" alt="${lang.toUpperCase()}" width="24" height="18">`;
}
