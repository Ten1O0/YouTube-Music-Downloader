/**
 * Crear una lista al descargar una lista de YouTube (plan 26).
 *
 * En el selector de una lista de YouTube, el interruptor «Crear una lista con
 * estas canciones», con el nombre de la lista ya puesto. Activado la primera
 * vez; después, la última elección en este dispositivo. No sale si esa lista
 * ya se sigue: ya tiene su lista vinculada (plan 14).
 *
 * Con el interruptor activado, las elegidas pasan por crearListaImportada, como
 * al importar un CSV (plan 15): la lista se crea al momento (lo que ya está en
 * la biblioteca entra tal cual, lo demás «en la nube») y se descarga con el
 * mismo lote de siempre (plan 20). Lo que falle se queda en la lista para
 * bajarlo después.
 *
 * Debajo de «Descargar seleccionadas», «Crear solo la lista, sin descargar»
 * (plan 29, T4): la lista se crea al momento con todo lo que falta en la nube,
 * para escucharlo desde ahí o descargarlo después. También sin cuenta.
 *
 * Se carga aparte, al abrir una lista de YouTube (presupuesto del plan 19).
 */

import { StorageModule } from '../core/storage.js';
import { html } from '../core/html.js';
import { i18n } from '../i18n/language-manager.js';
import { showStatus } from '../ui/status.js';
import { textoTuyo } from './nube/textos-tuyo.js';

const CLAVE = 'yt_crear_lista';
/** Se pulsó «Crear solo la lista, sin descargar»: lo lee la siguiente creación. */
let soloListaPedida = false;
/** Las listas de YouTube que se siguen: la misma clave que follows.js. */
const CLAVE_SEGUIDAS = 'ytdl_seguidas';

/** Las piezas de la pantalla, buscadas al usarlas (así el módulo se prueba sin DOM). */
let piezas = null;
function dom() {
    if (piezas) return piezas;
    const $ = (id) => document.getElementById(id);
    piezas = { caja: $('ytCrearLista'), activa: $('ytCrearListaActiva'), nombre: $('ytCrearListaNombre') };
    piezas.activa?.addEventListener('change', () => {
        try { localStorage.setItem(CLAVE, piezas.activa.checked ? '1' : '0'); } catch { /* sin almacenamiento: solo esta vez */ }
        piezas.nombre.hidden = !piezas.activa.checked;
    });
    piezas.soloLista = botonSoloLista($('downloadSelectedBtn'));
    return piezas;
}

/** «Crear solo la lista, sin descargar», detrás de «Descargar seleccionadas», que le presta su estado. */
function botonSoloLista(descargar) {
    if (!descargar) return null;
    const boton = document.createElement('button');
    boton.id = 'ytSoloLista';
    boton.type = 'button';
    boton.className = 'seguir-btn';
    boton.hidden = true;
    descargar.after(boton);
    const igualar = () => { boton.disabled = descargar.disabled; };
    new MutationObserver(igualar).observe(descargar, { attributes: true, attributeFilter: ['disabled'] });
    igualar();
    // Pasa por «Descargar seleccionadas», que pregunta a eligeLista: esta vez, solo la lista
    boton.addEventListener('click', () => { soloListaPedida = true; descargar.click(); });
    return boton;
}

/** El id de la lista de un enlace de YouTube, o null. Pura. */
export const idDeLista = (url) => /[?&]list=([\w-]+)/.exec(url ?? '')?.[1] ?? null;

/** Lo que se pasa a crearListaImportada: una fila por vídeo, ya elegido. Pura. */
export const filasDeVideos = (videos) => (videos ?? []).filter((v) => v?.id)
    .map((v) => ({ elegida: { id: v.id, title: v.title ?? '', channel: v.channel ?? '', duration: v.duration } }));

function elegidoAntes() {
    try { return localStorage.getItem(CLAVE) !== '0'; } catch { return true; }
}

async function yaSeSigue(url) {
    const id = idDeLista(url);
    if (!id) return false;
    const seguidas = await StorageModule.get(CLAVE_SEGUIDAS).catch(() => null);
    return (seguidas ?? []).some((s) => s?.listId === id);
}

/**
 * Enseña el interruptor para la lista que se acaba de abrir, con su nombre.
 * `actual()`: la lista que se ve ahora (si cambió mientras se comprobaba, no se pinta).
 */
export async function pintarCrearLista(lista, actual) {
    const { caja, activa, nombre, soloLista } = dom();
    if (!caja) return;
    soloListaPedida = false;
    const seguida = lista ? await yaSeSigue(lista.url) : false;
    if (lista !== actual()) return;
    caja.hidden = !lista || seguida;
    if (soloLista) {
        soloLista.hidden = caja.hidden;
        soloLista.innerHTML = html`<span class="material-symbols-outlined" aria-hidden="true">playlist_add</span><span>${textoTuyo('soloLista')}</span>`;
    }
    if (caja.hidden) return;
    activa.checked = elegidoAntes();
    nombre.value = lista.titulo || '';
    nombre.placeholder = i18n.t('import_default_name');
    nombre.hidden = !activa.checked;
}

/**
 * Si se va a crear la lista, con qué nombre: `{ nombre }`, o null. Con
 * «Crear solo la lista, sin descargar» siempre se crea: con el nombre escrito
 * si el interruptor está activado y, si no, el de la lista.
 */
export function eligeLista() {
    const { caja, activa, nombre } = dom();
    if (soloListaPedida) return { nombre: activa?.checked ? nombre.value : '' };
    if (!caja || caja.hidden || !activa.checked) return null;
    return { nombre: nombre.value };
}

/**
 * Crea la lista con los vídeos y los descarga. Devuelve el resultado del lote
 * (o null si no había nada que bajar o no se pudo crear), para el aviso final.
 * Con «Crear solo la lista», no descarga nada: lo que falta se queda en la nube.
 */
export async function descargarComoLista(videos, escrito, porDefecto) {
    const soloLista = soloListaPedida;
    soloListaPedida = false;
    const { crearListaImportada } = await import('./import/import.js');
    const r = await crearListaImportada(filasDeVideos(videos), escrito, { porDefecto: porDefecto || i18n.t('import_default_name'), descargar: !soloLista });
    if (!r) {
        showStatus(i18n.t('dl_select_one'), 'error');
        return null;
    }
    if (soloLista) {
        showStatus(textoTuyo('soloListaHecha', { nombre: r.lista.name }), 'success');
        return null;
    }
    if (!r.pendientes) {
        showStatus(i18n.t('import_created', { name: r.lista.name }), 'success');
        return null;
    }
    showStatus(i18n.t('import_created_downloading', { name: r.lista.name, n: r.pendientes }), 'info');
    return r.descarga;
}
