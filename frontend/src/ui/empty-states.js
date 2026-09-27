/**
 * Estados vacíos con ilustración (plan 10, T7).
 *
 * Una ilustración por situación, con el trazo de los iconos de la app (1,75,
 * extremos redondeados, currentColor) y el dorado de la marca en un acento.
 * Cada estado dice qué pasa y, si tiene sentido, ofrece una acción.
 *
 * Los textos llevan data-i18n: así cambian también al cambiar de idioma, sin
 * volver a pintar la lista.
 */

import { html, seguro } from '../core/html.js';
import { i18n } from '../i18n/language-manager.js';

const svg = (cuerpo) => html`<svg class="estado-vacio-ilustracion" viewBox="0 0 120 96" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${seguro(cuerpo)}</svg>`;

/** Dibujos fijos: no llevan nada de fuera. */
export const ILUSTRACIONES = {
    // Un vinilo con una nota que sale de él
    biblioteca: svg(`
        <circle cx="50" cy="50" r="30"/>
        <circle cx="50" cy="50" r="19" opacity=".45"/>
        <circle cx="50" cy="50" r="6" class="acento"/>
        <path d="M86 26v28" class="acento"/><path d="M86 26l12-4v10l-12 4"/>
        <circle cx="81" cy="56" r="5" class="acento"/>`),
    // Tres portadas apiladas
    listas: svg(`
        <rect x="26" y="30" width="44" height="44" rx="7" opacity=".45"/>
        <rect x="38" y="22" width="44" height="44" rx="7" opacity=".7"/>
        <rect x="50" y="14" width="44" height="44" rx="7"/>
        <path d="M68 44V28l12-3v14" class="acento"/><circle cx="65" cy="45" r="3.5" class="acento"/><circle cx="77" cy="40" r="3.5" class="acento"/>`),
    // Una portada vacía esperando canciones
    lista: svg(`
        <rect x="34" y="16" width="52" height="52" rx="8" stroke-dasharray="5 5"/>
        <path d="M60 32v20M50 42h20" class="acento"/>
        <path d="M30 80h60" opacity=".45"/>`),
    // Una lupa sobre una onda
    busqueda: svg(`
        <path d="M14 58c6 0 6-14 12-14s6 22 12 22 6-30 12-30 6 22 12 22" opacity=".45"/>
        <circle cx="72" cy="40" r="18"/>
        <path d="M85 53l14 14" class="acento"/>`),
    // Una lista con el triángulo de reproducir
    cola: svg(`
        <path d="M30 30l14 9-14 9z" class="acento"/>
        <path d="M56 32h36M56 46h28M30 62h62M30 74h44" opacity=".6"/>`),
    // Un reloj con una flecha de descarga
    historial: svg(`
        <circle cx="54" cy="48" r="28"/>
        <path d="M54 32v16l10 7" opacity=".7"/>
        <path d="M90 34v24M82 50l8 8 8-8" class="acento"/>`),
    // Un corazón con un destello
    favoritos: svg(`
        <path d="M60 78S30 60 30 40a15 15 0 0 1 30-5 15 15 0 0 1 30 5c0 20-30 38-30 38z"/>
        <path d="M92 18v8M88 22h8" class="acento"/>`),
    // Un bocadillo con un pentagrama
    letras: svg(`
        <path d="M22 22h76a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H56l-14 12V66H22a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z"/>
        <path d="M30 36h60M30 44h60M30 52h60" opacity=".45"/>
        <path d="M70 52V34l8-2" class="acento"/><circle cx="67" cy="53" r="3" class="acento"/>`),
};

/**
 * Crea un estado vacío.
 * @param {object} o
 * @param {keyof ILUSTRACIONES} o.ilustracion
 * @param {string} o.titulo  clave de traducción
 * @param {string} [o.texto] clave de traducción
 * @param {{ clave: string, alPulsar: Function }} [o.accion]
 * @param {boolean} [o.compacto] para paneles pequeños (historial, cola)
 */
export function estadoVacio({ ilustracion, titulo, texto, accion, compacto = false }) {
    const caja = document.createElement('div');
    caja.className = `estado-vacio${compacto ? ' estado-vacio-compacto' : ''}`;
    caja.setAttribute('role', 'status');
    caja.innerHTML = ILUSTRACIONES[ilustracion] ?? '';

    const p = document.createElement('p');
    p.className = 'estado-vacio-titulo';
    p.dataset.i18n = titulo;
    p.textContent = i18n.t(titulo);
    caja.append(p);

    if (texto) {
        const span = document.createElement('span');
        span.className = 'estado-vacio-texto';
        span.dataset.i18n = texto;
        span.textContent = i18n.t(texto);
        caja.append(span);
    }

    if (accion) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'estado-vacio-accion';
        boton.dataset.i18n = accion.clave;
        boton.textContent = i18n.t(accion.clave);
        boton.addEventListener('click', accion.alPulsar);
        caja.append(boton);
    }
    return caja;
}

/** Rellena un contenedor que ya existe en index.html (conserva su id y sus clases). */
export function rellenarEstadoVacio(contenedor, opciones) {
    if (!contenedor) return;
    const nuevo = estadoVacio(opciones);
    contenedor.classList.add(...nuevo.classList);
    contenedor.setAttribute('role', 'status');
    contenedor.replaceChildren(...nuevo.childNodes);
}
