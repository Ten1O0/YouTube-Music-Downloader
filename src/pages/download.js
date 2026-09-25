/**
 * Página de descarga de la APK (/download).
 *
 * Es la presentación pública de la app: el enlace que se comparte y adonde
 * lleva el aviso de nueva versión. La versión, las novedades y el tamaño se
 * piden al servidor, del mismo fichero que usa ese aviso, para que la página
 * nunca se desfase de la APK que se descarga.
 */

import './download.css';
import { IDIOMAS, NOMBRES_IDIOMA, TEXTOS, elegirIdioma, tamanoLegible } from './download-textos.js';

const CLAVE_IDIOMA = 'download-lang';

function leerIdiomaGuardado() {
    try { return localStorage.getItem(CLAVE_IDIOMA); } catch { return null; }
}

let idioma = elegirIdioma({
    parametro: new URLSearchParams(location.search).get('lang'),
    guardado: leerIdiomaGuardado(),
    navegador: navigator.languages?.length ? navigator.languages : [navigator.language],
});
let version;        // undefined: cargando · null: sin datos · objeto: la del servidor
let bytesApk = 0;

function t(clave, params = {}) {
    let texto = TEXTOS[idioma]?.[clave] ?? TEXTOS.es[clave] ?? clave;
    for (const [k, v] of Object.entries(params)) texto = texto.replace(`{${k}}`, v);
    return texto;
}

function pintarNovedades() {
    const lista = document.getElementById('novedades');
    const cabecera = document.getElementById('novedadesVersion');
    if (!lista || !cabecera) return;
    lista.replaceChildren();
    if (!version) {
        cabecera.textContent = '';
        const aviso = document.createElement('li');
        aviso.className = 'novedades-estado';
        aviso.textContent = t(version === undefined ? 'news_loading' : 'news_error');
        lista.append(aviso);
        return;
    }
    const fecha = version.fecha ? new Intl.DateTimeFormat(idioma, { dateStyle: 'long' }).format(new Date(`${version.fecha}T12:00:00`)) : '';
    cabecera.textContent = [t('meta_version', { v: version.versionName }), fecha].filter(Boolean).join(' · ');
    const textos = version.novedades?.[idioma] ?? version.novedades?.es ?? [];
    for (const texto of textos) {
        const li = document.createElement('li');
        li.textContent = texto;
        lista.append(li);
    }
}

function pintar() {
    document.documentElement.lang = idioma;
    document.title = t('titulo_pagina');
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });

    const meta = [
        version && t('meta_version', { v: version.versionName }),
        tamanoLegible(bytesApk, idioma),
        t('meta_android'),
    ].filter(Boolean).join(' · ');
    document.querySelectorAll('[data-meta]').forEach((el) => { el.textContent = meta; });

    const selector = document.getElementById('idioma');
    if (selector) selector.value = idioma;
    pintarNovedades();
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

async function cargarDatos() {
    try {
        const respuesta = await fetch('/api/app/version', { cache: 'no-store' });
        version = respuesta.ok ? await respuesta.json() : null;
    } catch {
        version = null;
    }
    try {
        const respuesta = await fetch('/ytmusic.apk', { method: 'HEAD', cache: 'no-store' });
        bytesApk = Number(respuesta.headers.get('Content-Length')) || 0;
    } catch {
        bytesApk = 0;
    }
    pintar();
}

montarSelector();
pintar();
cargarDatos();
