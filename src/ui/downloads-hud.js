/**
 * Avisos de descarga: isla en el móvil, banners en el escritorio (plan 09, T13).
 *
 * QueueManager (app.js) guarda el estado de las descargas; aquí solo se
 * pintan. Las dos vistas cumplen la misma interfaz:
 *
 *     add(item) · update(item) · complete(item) · fail(item) · remove(id)
 *     retener() → true mientras no conviene retirar nada (ratón encima)
 *     dwell     → cuánto se deja ver un aviso terminado antes de irse
 *     destroy()
 *
 * `item` es el objeto del gestor: { id, info: { title, thumbnail }, status,
 * percent, message }. Las vistas lo leen, nunca lo modifican.
 */

import { Spring } from './motion/spring.js';

const LONGITUD_ANILLO = 2 * Math.PI * 15;
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const terminado = (i) => i.status === 'complete' || i.status === 'error';

/** Recuento y progreso medio: lo que dice la isla cuando hay varias. */
export function resumenDescargas(items) {
    const activos = items.filter(i => !terminado(i));
    const base = activos.length ? activos : items;
    const percent = base.length ? base.reduce((s, i) => s + (i.percent || 0), 0) / base.length : 0;
    return { total: items.length, activos: activos.length, percent: Math.max(0, Math.min(100, percent)) };
}

/** Posición vertical de cada banner, del más nuevo al más antiguo; null si no cabe. */
export function posicionesPila(alturas, hueco = 10, max = 3) {
    let y = 0;
    return alturas.map((h, i) => {
        if (i >= max) return null;
        const actual = y;
        y += h + hueco;
        return actual;
    });
}

/** Espera al final de una transición, con tope por si no llega. */
function tras(el, ms) {
    return new Promise(resolve => {
        const fin = () => { el.removeEventListener('transitionend', fin); clearTimeout(reloj); resolve(); };
        el.addEventListener('transitionend', fin);
        const reloj = setTimeout(fin, ms);
    });
}

function anilloSVG() {
    return `<svg class="dl-anillo" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="dl-anillo-fondo" cx="18" cy="18" r="15"/>
        <circle class="dl-anillo-prog" cx="18" cy="18" r="15"/>
        <path class="dl-anillo-check" d="M11.5 18.5l4.2 4.2 8.8-9.2"/>
        <path class="dl-anillo-error" d="M18 11v8.5M18 24.2v.4"/>
    </svg>`;
}

// ============================================================
// Isla (móvil)
// ============================================================

const PILDORA = { w: 96, h: 30 };
const ALTO_RESUMEN = 64;
const ALTO_FILA = 52;
const MAX_FILAS = 4;

/** Texto al terminar: «Descargada», o el que traiga la tarea («12 importadas»). */
function textoHecho(item, t) {
    return item?.info?.textoHecho || t('hud_done');
}

export function createIslandView({ root, t, onCancel, onHaptic = () => {} }) {
    const el = document.createElement('div');
    el.className = 'dl-island';
    el.hidden = true;
    el.innerHTML = `
        <button class="dl-island-resumen" type="button" aria-expanded="false">
            <span class="dl-island-artes"></span>
            <span class="dl-island-texto"><b class="dl-island-titulo"></b><span class="dl-island-estado"></span></span>
            ${anilloSVG()}
        </button>
        <ul class="dl-island-lista"></ul>`;
    root.appendChild(el);

    const resumen = el.querySelector('.dl-island-resumen');
    const artes = el.querySelector('.dl-island-artes');
    const titulo = el.querySelector('.dl-island-titulo');
    const estado = el.querySelector('.dl-island-estado');
    const prog = el.querySelector('.dl-anillo-prog');
    const lista = el.querySelector('.dl-island-lista');
    prog.style.strokeDasharray = String(LONGITUD_ANILLO);
    prog.style.strokeDashoffset = String(LONGITUD_ANILLO);

    let ancho = PILDORA.w, alto = PILDORA.h;
    const pintarTamano = () => {
        el.style.width = `${ancho}px`;
        el.style.height = `${alto}px`;
        el.style.borderRadius = `${Math.min(alto / 2, 32)}px`;
        el.toggleAttribute('data-compacta', ancho < 200);
    };
    const muelleAncho = new Spring({ value: PILDORA.w, preset: 'bouncy', precision: 0.3, onUpdate: v => { ancho = v; pintarTamano(); } });
    const muelleAlto = new Spring({ value: PILDORA.h, preset: 'bouncy', precision: 0.3, onUpdate: v => { alto = v; pintarTamano(); } });

    let items = [];
    let desplegada = false;
    let turnoCierre = 0;

    function destino() {
        if (!items.length) return PILDORA;
        const disponible = (root.clientWidth || globalThis.innerWidth || 390) - 20;
        const filas = desplegada ? Math.min(items.length, MAX_FILAS) : 0;
        return { w: Math.min(disponible, 420), h: ALTO_RESUMEN + (filas ? filas * ALTO_FILA + 8 : 0) };
    }

    function redimensionar(preset = 'bouncy') {
        const d = destino();
        muelleAncho.to(d.w, { preset });
        muelleAlto.to(d.h, { preset });
    }

    function pintar() {
        const r = resumenDescargas(items);
        const unica = items.length === 1 ? items[0] : null;
        const hayError = items.some(i => i.status === 'error');
        el.dataset.state = !items.length ? 'vacia'
            : items.every(terminado) ? (hayError && unica ? 'error' : 'hecha')
            : 'activa';

        titulo.textContent = unica ? (unica.info?.title || t('initializing')) : t('hud_count', { n: items.length });
        // Una tarea que no es una descarga (una importación) trae su propio verbo
        const descargando = unica?.info?.verbo || t('downloading').replace(/[.…]+$/, '');
        estado.textContent = el.dataset.state === 'hecha' ? textoHecho(unica, t)
            : el.dataset.state === 'error' ? t('hud_failed')
            : unica?.status === 'cancelling' ? t('cancelling')
            : `${descargando} · ${Math.round(r.percent)} %`;

        artes.innerHTML = items.slice(0, 3).map(i =>
            `<img src="${escapar(i.info?.thumbnail || 'favicon.png')}" alt="" onerror="this.src='favicon.png'">`).join('');
        prog.style.strokeDashoffset = String(LONGITUD_ANILLO * (1 - r.percent / 100));

        lista.innerHTML = desplegada ? items.slice(0, MAX_FILAS).map(i => `
            <li data-id="${escapar(i.id)}">
                <img src="${escapar(i.info?.thumbnail || 'favicon.png')}" alt="" onerror="this.src='favicon.png'">
                <span class="dl-fila-texto"><b>${escapar(i.info?.title || t('initializing'))}</b>
                <span>${terminado(i) ? escapar(i.status === 'error' ? t('hud_failed') : textoHecho(i, t)) : `${Math.round(i.percent || 0)} %`}</span></span>
                ${terminado(i) ? '' : `<button type="button" class="dl-cancelar" data-cancel="${escapar(i.id)}" aria-label="${escapar(t('cancel_download'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>`}
            </li>`).join('') : '';
        resumen.setAttribute('aria-expanded', String(desplegada));
    }

    async function cerrar() {
        const turno = ++turnoCierre;
        desplegada = false;
        muelleAncho.to(PILDORA.w, { preset: 'smooth' });
        await muelleAlto.to(PILDORA.h, { preset: 'smooth' });
        if (turno !== turnoCierre) return;
        el.dataset.fase = 'saliendo';
        await tras(el, 300);
        if (turno !== turnoCierre) return;
        el.hidden = true;
        delete el.dataset.fase;
    }

    // Tocar la isla despliega la lista con la X de cada descarga
    resumen.addEventListener('click', () => {
        if (!items.length) return;
        desplegada = !desplegada;
        pintar();
        redimensionar(desplegada ? 'bouncy' : 'smooth');
    });
    lista.addEventListener('click', (e) => {
        const boton = e.target.closest('[data-cancel]');
        if (boton) onCancel(boton.dataset.cancel);
    });
    // Tocar fuera la recoge
    const fuera = (e) => {
        if (desplegada && !el.contains(e.target)) { desplegada = false; pintar(); redimensionar('smooth'); }
    };
    document.addEventListener('pointerdown', fuera);

    return {
        dwell: { complete: 1300, error: 1800 },
        retener: () => false,
        add(item) {
            ++turnoCierre;
            items.push(item);
            if (el.hidden) {
                el.hidden = false;
                delete el.dataset.fase;
                muelleAncho.jump(PILDORA.w);
                muelleAlto.jump(PILDORA.h);
            }
            pintar();
            redimensionar('bouncy');
        },
        update() { pintar(); },
        complete() {
            pintar();
            if (items.every(terminado)) onHaptic('success');
        },
        fail() {
            pintar();
            onHaptic('error');
        },
        remove(id) {
            items = items.filter(i => i.id !== id);
            if (!items.length) { cerrar(); return; }
            pintar();
            redimensionar('smooth');
        },
        destroy() {
            document.removeEventListener('pointerdown', fuera);
            el.remove();
        },
    };
}

// ============================================================
// Banners (escritorio)
// ============================================================

const FUERA = 360;
const MAX_VISIBLES = 3;

export function createBannerView({ root, t, onCancel, onHaptic = () => {} }) {
    const pila = document.createElement('div');
    pila.className = 'dl-banners';
    root.appendChild(pila);
    const mas = document.createElement('div');
    mas.className = 'dl-banners-mas';
    mas.hidden = true;
    pila.appendChild(mas);

    const banners = new Map(); // id -> { el, x, y, alto }
    let orden = [];            // del más nuevo al más antiguo
    let raton = false;
    pila.addEventListener('mouseenter', () => { raton = true; });
    pila.addEventListener('mouseleave', () => { raton = false; });

    function recolocar() {
        const alturas = orden.map(id => banners.get(id).alto);
        const pos = posicionesPila(alturas, 10, MAX_VISIBLES);
        let fondo = 0;
        orden.forEach((id, i) => {
            const b = banners.get(id);
            const oculto = pos[i] === null;
            b.el.classList.toggle('dl-oculto', oculto);
            if (!oculto) {
                b.y.to(pos[i], { preset: 'snappy' });
                fondo = pos[i] + b.alto + 10;
            }
        });
        const ocultos = pos.filter(p => p === null).length;
        mas.hidden = ocultos === 0;
        mas.textContent = t('hud_more', { n: ocultos });
        mas.style.transform = `translateY(${fondo}px)`;
    }

    function pintar(b, item) {
        b.el.querySelector('.dl-banner-titulo').textContent = item.info?.title || t('initializing');
        const img = b.el.querySelector('.dl-banner-arte');
        const src = item.info?.thumbnail || 'favicon.png';
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        b.el.querySelector('.dl-banner-estado').textContent =
            item.status === 'complete' ? textoHecho(item, t)
            : item.status === 'error' ? t('hud_failed')
            : item.status === 'cancelling' ? t('cancelling')
            : (item.message || `${Math.round(item.percent || 0)} %`);
        b.el.querySelector('.dl-banner-barra i').style.width = `${Math.max(0, Math.min(100, item.percent || 0))}%`;
        b.el.dataset.state = item.status;
    }

    return {
        dwell: { complete: 1800, error: 2600 },
        retener: () => raton,
        add(item) {
            const el = document.createElement('div');
            el.className = 'dl-banner glass-thick';
            el.innerHTML = `
                <img class="dl-banner-arte" alt="" onerror="this.src='favicon.png'">
                <div class="dl-banner-texto">
                    <b class="dl-banner-titulo"></b>
                    <span class="dl-banner-estado"></span>
                    <div class="dl-banner-barra"><i></i></div>
                </div>
                <div class="dl-banner-icono">${anilloSVG()}</div>
                <button type="button" class="dl-cancelar" aria-label="${escapar(t('cancel_download'))}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>
                </button>`;
            pila.appendChild(el);
            el.querySelector('.dl-cancelar').addEventListener('click', () => onCancel(item.id));

            let x = FUERA, y = 0;
            const mover = () => { el.style.transform = `translate(${x}px, ${y}px)`; };
            const b = {
                el,
                alto: 0,
                x: new Spring({ value: FUERA, preset: 'snappy', precision: 0.3, onUpdate: v => { x = v; mover(); } }),
                y: new Spring({ value: 0, preset: 'snappy', precision: 0.3, onUpdate: v => { y = v; mover(); } }),
            };
            banners.set(item.id, b);
            pintar(b, item);
            mover();
            b.alto = el.offsetHeight || 64;
            orden.unshift(item.id);
            recolocar();
            b.x.to(0, { preset: 'snappy' });
        },
        update(item) {
            const b = banners.get(item.id);
            if (b) pintar(b, item);
        },
        complete(item) {
            const b = banners.get(item.id);
            if (!b) return;
            pintar(b, item);
            // El check aparece con el muelle vivo
            const icono = b.el.querySelector('.dl-banner-icono');
            const escala = new Spring({ value: 0.5, preset: 'bouncy', precision: 0.001, onUpdate: v => { icono.style.scale = String(v); } });
            escala.to(1);
            onHaptic('success');
        },
        fail(item) {
            const b = banners.get(item.id);
            if (b) pintar(b, item);
            onHaptic('error');
        },
        async remove(id) {
            const b = banners.get(id);
            if (!b) return;
            banners.delete(id);
            orden = orden.filter(i => i !== id);
            recolocar();
            await b.x.to(FUERA, { preset: 'smooth' });
            b.el.remove();
        },
        destroy() { pila.remove(); },
    };
}
