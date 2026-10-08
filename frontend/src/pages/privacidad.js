/**
 * La página de la política de privacidad (/privacidad, plan 21, T6).
 *
 * Mismo lenguaje que la página de descarga: sus estilos y su cabecera. Los
 * textos están en privacidad-textos.js y se pintan con textContent.
 */

import './download.css';
import './privacidad.css';
import { IDIOMAS, NOMBRES_IDIOMA, TEXTOS, elegirIdioma } from './privacidad-textos.js';

const CLAVE_IDIOMA = 'download-lang';

function leerIdiomaGuardado() {
    try { return localStorage.getItem(CLAVE_IDIOMA); } catch { return null; }
}

let idioma = elegirIdioma({
    parametro: new URLSearchParams(location.search).get('lang'),
    guardado: leerIdiomaGuardado(),
    navegador: navigator.languages?.length ? navigator.languages : [navigator.language],
});

/** Un párrafo: texto suelto o trozos, alguno con enlace. */
function parrafo(contenido) {
    const p = document.createElement('p');
    for (const trozo of Array.isArray(contenido) ? contenido : [contenido]) {
        if (typeof trozo === 'string') {
            p.append(trozo);
        } else {
            const a = document.createElement('a');
            a.href = trozo.href;
            a.textContent = trozo.texto;
            if (/^https?:/.test(trozo.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
            p.append(a);
        }
    }
    return p;
}

function pintar() {
    const t = TEXTOS[idioma];
    document.documentElement.lang = idioma;
    document.title = t.titulo_pagina;
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t[el.dataset.t]; });

    const cuerpo = document.getElementById('politica');
    cuerpo.replaceChildren(...t.apartados.map(([titulo, parrafos]) => {
        const seccion = document.createElement('section');
        const h2 = document.createElement('h2');
        h2.textContent = titulo;
        seccion.append(h2, ...parrafos.map(parrafo));
        return seccion;
    }));

    const selector = document.getElementById('idioma');
    if (selector) selector.value = idioma;
}

function montarSelector() {
    const selector = document.getElementById('idioma');
    if (!selector) return;
    selector.replaceChildren(...IDIOMAS.map((codigo) => new Option(NOMBRES_IDIOMA[codigo], codigo)));
    selector.addEventListener('change', () => {
        idioma = selector.value;
        try { localStorage.setItem(CLAVE_IDIOMA, idioma); } catch { /* sin almacenamiento */ }
        pintar();
    });
}

montarSelector();
pintar();
