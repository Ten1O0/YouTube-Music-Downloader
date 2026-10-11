/**
 * El selector de canciones (plan 23, T1).
 *
 * Uno solo para crear una lista, añadir canciones a una lista y elegir de una
 * playlist de YouTube. Antes había tres, cada uno con su estilo (casillas del
 * navegador, círculos con ✓ y casillas otra vez).
 *
 *     const selector = crearSelectorCanciones({
 *         contenedor, elementos: [{ clave, titulo, artista, miniatura, duracion }],
 *         seleccion: ['clave1'], alCambiar: (claves) => …, pie: elementoDelPie,
 *     });
 *     selector.seleccionadas(); // claves, en el orden de los elementos
 *
 * Con teclado: las flechas recorren las filas y el espacio o Enter las marca.
 */

import { duracionCorta, duracionTotal } from '../core/duracion.js';
import { html, seguro } from '../core/html.js';
import { i18n } from '../i18n/language-manager.js';

const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Los elementos cuyo título o artista contienen todas las palabras buscadas (sin tildes ni mayúsculas). */
export function filtrarSelector(elementos, consulta) {
    const palabras = sinTildes(consulta).trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) return elementos;
    return elementos.filter((e) => {
        const texto = sinTildes(`${e.titulo} ${e.artista}`);
        return palabras.every((p) => texto.includes(p));
    });
}

/** «3 seleccionadas · 12 min»: cuántas y cuánto duran. */
export function resumenSeleccion(elementos, claves) {
    const n = claves.size;
    const cuantas = n === 0 ? i18n.t('sel_0') : n === 1 ? i18n.t('sel_1') : i18n.t('sel_n', { n });
    const segundos = elementos.reduce((s, e) => s + (claves.has(e.clave) && e.duracion > 0 ? e.duracion : 0), 0);
    const total = duracionTotal(segundos);
    return total ? `${cuantas} · ${total}` : cuantas;
}

const ICONO_CHECK = seguro('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4L18.5 7.5"/></svg>');
const ICONO_LUPA = seguro('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>');

/**
 * `textoBuscar` es la clave del texto del buscador («Buscar en tu biblioteca…»).
 * `extra(elemento)` (opcional) pinta botones propios en cada fila, a la
 * derecha (escuchar antes y favorito, en la selección de YouTube). Tocarlos no
 * marca la fila: quien los pone los atiende por delegación en el contenedor.
 */
export function crearSelectorCanciones({ contenedor, elementos, seleccion = [], alCambiar = () => {}, buscador = true, pie = null, extra = null, textoBuscar = 'sel_search_ph' }) {
    const elegidas = new Set(seleccion);
    let visibles = elementos;
    let activa = 0; // la fila que recibe el teclado

    contenedor.classList.add('selector');
    contenedor.innerHTML = html`
        ${buscador ? html`<div class="selector-barra">
            <label class="selector-buscar">${ICONO_LUPA}<input type="search" class="selector-buscar-entrada"
                placeholder="${i18n.t(textoBuscar)}" aria-label="${i18n.t(textoBuscar)}"
                autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>
            <button type="button" class="selector-todo"></button>
        </div>` : ''}
        <div class="selector-lista" role="listbox" aria-multiselectable="true"></div>
        <p class="selector-vacio" hidden></p>`;
    const lista = contenedor.querySelector('.selector-lista');
    const vacio = contenedor.querySelector('.selector-vacio');
    const entrada = contenedor.querySelector('.selector-buscar-entrada');
    const todo = contenedor.querySelector('.selector-todo');

    // En una ventana, el cuerpo deja el scroll a la lista (ventana.css)
    const cuerpo = contenedor.closest('.ventana-cuerpo');
    cuerpo?.classList.add('con-selector');

    const fila = (e, i) => html`<div class="selector-fila${elegidas.has(e.clave) ? ' elegida' : ''}${extra ? ' con-extra' : ''}" role="option"
        aria-selected="${elegidas.has(e.clave)}" tabindex="${i === activa ? 0 : -1}" data-clave="${e.clave}">
        <span class="selector-marca">${ICONO_CHECK}</span>
        <img class="selector-miniatura" src="${e.miniatura}" alt="" width="44" height="44" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
        <span class="selector-textos"><span class="selector-titulo">${e.titulo}</span><span class="selector-artista">${e.artista}</span></span>
        ${extra ? html`<span class="selector-extra">${extra(e)}</span>` : ''}
        <span class="selector-duracion">${duracionCorta(e.duracion)}</span>
    </div>`;

    function pintar() {
        activa = Math.min(activa, Math.max(0, visibles.length - 1));
        lista.innerHTML = html`${visibles.map(fila)}`;
        vacio.hidden = visibles.length > 0;
        if (!visibles.length) {
            const consulta = entrada?.value.trim();
            vacio.textContent = consulta ? i18n.t('sel_empty_q', { q: consulta }) : i18n.t('sel_empty_lib');
        }
        actualizarResumen();
    }

    function actualizarResumen() {
        if (todo) {
            const todasVisibles = visibles.length > 0 && visibles.every((e) => elegidas.has(e.clave));
            todo.textContent = i18n.t(todasVisibles ? 'sel_none' : 'sel_all');
            todo.hidden = visibles.length === 0;
        }
        if (pie) pie.textContent = resumenSeleccion(elementos, elegidas);
    }

    function avisar() {
        actualizarResumen();
        alCambiar([...seleccionadas()]);
    }

    function alternar(el) {
        const clave = el.dataset.clave;
        const marcada = !elegidas.has(clave);
        if (marcada) elegidas.add(clave); else elegidas.delete(clave);
        el.classList.toggle('elegida', marcada);
        el.setAttribute('aria-selected', String(marcada));
        avisar();
    }

    function enfocar(i) {
        const filas = lista.querySelectorAll('.selector-fila');
        if (!filas.length) return;
        activa = Math.max(0, Math.min(filas.length - 1, i));
        filas.forEach((f, j) => { f.tabIndex = j === activa ? 0 : -1; });
        filas[activa].focus({ preventScroll: false });
    }

    lista.addEventListener('click', (ev) => {
        if (ev.target.closest('.selector-extra')) return;
        const el = ev.target.closest('.selector-fila');
        if (!el) return;
        activa = [...lista.children].indexOf(el);
        alternar(el);
    });
    lista.addEventListener('keydown', (ev) => {
        if (ev.target.closest('.selector-extra')) return;
        const el = ev.target.closest('.selector-fila');
        if (!el) return;
        if (ev.key === 'ArrowDown') { ev.preventDefault(); enfocar(activa + 1); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); enfocar(activa - 1); }
        else if (ev.key === 'Home') { ev.preventDefault(); enfocar(0); }
        else if (ev.key === 'End') { ev.preventDefault(); enfocar(Infinity); }
        else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); alternar(el); }
    });
    entrada?.addEventListener('input', () => {
        visibles = filtrarSelector(elementos, entrada.value);
        activa = 0;
        pintar();
    });
    // Desde el buscador, la flecha abajo baja a las filas
    entrada?.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); enfocar(0); }
    });
    todo?.addEventListener('click', () => {
        const todasVisibles = visibles.every((e) => elegidas.has(e.clave));
        for (const e of visibles) {
            if (todasVisibles) elegidas.delete(e.clave); else elegidas.add(e.clave);
        }
        pintar();
        avisar();
    });

    /** Las claves elegidas, en el orden de los elementos (no en el de los clics). */
    function seleccionadas() {
        return elementos.filter((e) => elegidas.has(e.clave)).map((e) => e.clave);
    }

    pintar();
    return {
        seleccionadas,
        marcar(claves) {
            elegidas.clear();
            for (const c of claves) elegidas.add(c);
            pintar();
        },
        /** Más elementos al final, marcados, sin perder lo elegido ni lo buscado («Cargar 25 más», plan 25). */
        anadir(nuevos) {
            elementos.push(...nuevos);
            for (const e of nuevos) elegidas.add(e.clave);
            visibles = filtrarSelector(elementos, entrada?.value ?? '');
            pintar();
            avisar();
        },
        enfocarBuscador() { entrada?.focus(); },
        destruir() {
            cuerpo?.classList.remove('con-selector');
            contenedor.replaceChildren();
            contenedor.classList.remove('selector');
        },
    };
}
